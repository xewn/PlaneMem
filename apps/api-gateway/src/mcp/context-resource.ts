import { createHash } from 'node:crypto';
import {
  ContractError,
  CONTEXT_ITEM_READ_ERROR_BYTES,
  CONTEXT_ITEM_READ_RESPONSE_BYTES,
  CONTEXT_PACK_READ_ERROR_BYTES,
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  contextPackReadHashJson,
  parseContextPackReadEnvelope,
  parseContextPackReadQuery,
  isSyncIdentifier,
  parseContextItemReadEnvelope,
  parseContextItemReadQuery,
  syncJsonSnapshot,
  validateErrorEnvelope,
} from '@planemem/contracts';
import type { CommandResult, CommandRouter, RequestContext } from '../router.js';
import { canReadContextTool } from './context-history.js';
import type { McpResourceDirectory } from './resource-directory.js';

// The JSON text can double when escaped; the outer resource also repeats its sources.
const resourceBytes =
  3 * Math.max(CONTEXT_ITEM_READ_RESPONSE_BYTES, CONTEXT_PACK_READ_RESPONSE_BYTES) + 8192;
const activeReads = new WeakMap<CommandRouter, { active: number }>();
const messages = {
  INVALID_INPUT: 'Supply only one context item or saved pack resource URI within 4 KiB',
  DENIED: 'Use a verified unexpired client with actual context.read and record visibility',
  UNAUTHENTICATED: 'Renew the intended session before reading this context resource',
  MCP_RESOURCE_NOT_FOUND: 'The context resource is unavailable in this project',
  MCP_RESOURCE_INVALID: 'The complete context resource did not match this read or its size limit',
  MCP_STORAGE_UNAVAILABLE: 'Resource project visibility storage is unavailable',
  CONTEXT_ITEM_NOT_FOUND: 'The current context item is unavailable in this project',
  CONTEXT_ITEM_INVALID: 'The stored context item could not be validated',
  CONTEXT_ITEM_STORAGE_UNAVAILABLE: 'Context item storage is unavailable',
  CONTEXT_PACK_NOT_FOUND: 'The saved context pack is unavailable in this project and selection',
  CONTEXT_PACK_STALE:
    'The saved pack sources changed; review current knowledge and prepare a fresh pack',
  CONTEXT_PACK_EXPIRED: 'The saved context pack expired; prepare a fresh pack',
  CONTEXT_PACK_INVALID: 'The saved context pack could not be validated',
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Context pack storage is unavailable',
  CONTEXT_SOURCE_LIMIT: 'The saved context pack source checks exceeded their limit',
  CONTEXT_PACK_INTEGRITY_UNAVAILABLE:
    'Context pack integrity checking is unavailable; no unchecked pack was returned',
  CONTEXT_PACK_HASH_MISMATCH: 'The complete context pack differs from its saved hash',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context resource read audit could not be persisted',
  MCP_CONTEXT_RESOURCE_BUSY: 'MCP context resource read capacity is occupied',
  MCP_CONTEXT_RESOURCE_TIMEOUT:
    'Stopped waiting for the context resource; the underlying read may still be running',
} as const;
type ErrorCode = keyof typeof messages;
function fail(code: ErrorCode, trace: string) {
  return new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}

/** Include malformed item suffixes so they cannot enter the generic resource reader. */
export function isContextItemResourceUri(uri: unknown): uri is string {
  return typeof uri === 'string' && /^work:\/\/project\/[^/?#]+\/context-item(?:[/?#]|$)/.test(uri);
}

/** Capture malformed pack suffixes too; none may fall through to generic resource reading. */
export function isContextPackResourceUri(uri: unknown): uri is string {
  return typeof uri === 'string' && /^work:\/\/project\/[^/?#]+\/context-pack(?:[/?#]|$)/.test(uri);
}

function captureQuery(raw: unknown, context: RequestContext, kind: 'item' | 'pack') {
  let uri: string;
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(raw, 4096));
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'uri') ||
      !('uri' in value) ||
      typeof value.uri !== 'string'
    )
      throw new TypeError();
    uri = value.uri;
  } catch {
    throw fail('INVALID_INPUT', context.trace_id);
  }
  try {
    if (kind === 'pack') {
      const match = /^work:\/\/project\/([^/?#]+)\/context-pack\/([^/?#]+)$/.exec(uri);
      if (!match || decodeURIComponent(match[1]!) !== context.project_id) throw new TypeError();
      const id = decodeURIComponent(match[2]!);
      return {
        kind: 'pack' as const,
        uri,
        query: parseContextPackReadQuery(id === 'latest' ? {} : { pack_id: id }),
      };
    }
    const match = /^work:\/\/project\/([^/?#]+)\/context-item\/([^/?#]+)$/.exec(uri);
    if (!match || decodeURIComponent(match[1]!) !== context.project_id) throw new TypeError();
    const query = parseContextItemReadQuery({
      kind: 'current',
      item_id: decodeURIComponent(match[2]!),
    });
    return { kind: 'item' as const, uri, query };
  } catch {
    throw fail('MCP_RESOURCE_NOT_FOUND', context.trace_id);
  }
}

/** The outer mcp.resource authorization precedes this budget; nested reads retain policy/audit. */
async function executeContextResource(
  router: CommandRouter,
  directory: McpResourceDirectory,
  raw: unknown,
  original: RequestContext,
  kind: 'item' | 'pack',
): Promise<CommandResult> {
  const deadline = performance.now() + 30_000;
  const trace = isSyncIdentifier(original.trace_id) ? original.trace_id : 'trace_unknown';
  let context: RequestContext;
  try {
    context = structuredClone(original);
  } catch {
    throw fail('DENIED', trace);
  }
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_CONTEXT_RESOURCE_TIMEOUT', trace);
    if (!canReadContextTool(context)) throw fail('DENIED', trace);
  };
  active();
  const selected = captureQuery(raw, context, kind);
  const { uri } = selected;
  const maximum =
    selected.kind === 'pack' ? CONTEXT_PACK_READ_RESPONSE_BYTES : CONTEXT_ITEM_READ_RESPONSE_BYTES;
  const errorBytes =
    selected.kind === 'pack' ? CONTEXT_PACK_READ_ERROR_BYTES : CONTEXT_ITEM_READ_ERROR_BYTES;
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  active();
  let gate = activeReads.get(router);
  if (!gate) {
    gate = { active: 0 };
    activeReads.set(router, gate);
  }
  if (gate.active >= 2) throw fail('MCP_CONTEXT_RESOURCE_BUSY', trace);
  const lease = gate;
  lease.active++;
  const work = (async (): Promise<CommandResult> => {
    try {
      await directory.requireProject(structuredClone(context));
      active();
      const response = await router.execute(
        {
          operation: selected.kind === 'pack' ? 'context.pack.read' : 'context.item.read',
          context: structuredClone(context),
          input:
            selected.kind === 'pack' ? { ...selected.query } : { item_id: selected.query.item_id },
        },
        async (run) => {
          // A slow policy/audit decision must not start a read after the budget expires.
          active();
          return run();
        },
      );
      active();
      const document =
        selected.kind === 'pack'
          ? parseContextPackReadEnvelope(response, selected.query, context, trace)
          : parseContextItemReadEnvelope(response, selected.query, context, trace);
      const restricted =
        'pack' in document.data
          ? document.data.pack.items.some((item) => item.sensitivity === 'restricted')
          : document.data.classification === 'restricted';
      if (restricted && !context.capability.includes('data.restricted.read'))
        throw fail('DENIED', trace);
      active();
      if ('pack' in document.data) {
        const snapshot = contextPackReadHashJson(document.data.pack);
        active();
        let hash: string;
        try {
          hash = 'sha256:' + createHash('sha256').update(snapshot, 'utf8').digest('hex');
        } catch {
          throw fail('CONTEXT_PACK_INTEGRITY_UNAVAILABLE', trace);
        }
        if (hash !== document.data.pack.pack_hash) throw fail('CONTEXT_PACK_HASH_MISMATCH', trace);
        active();
      }
      const text = syncJsonSnapshot(document, maximum);
      const result: CommandResult = {
        schema_version: 1,
        trace_id: trace,
        source_refs: document.source_refs,
        data: { contents: [{ uri, mimeType: 'application/json', text }] },
      };
      syncJsonSnapshot(result, resourceBytes);
      active();
      return result;
    } catch (error) {
      // Expiry/deadline take precedence even if the underlying operation failed late.
      active();
      let code: ErrorCode = 'MCP_RESOURCE_INVALID';
      if (error instanceof ContractError) {
        try {
          const envelope = validateErrorEnvelope(
            JSON.parse(syncJsonSnapshot(error.envelope, errorBytes)),
          );
          if (envelope.trace_id === trace && Object.hasOwn(messages, envelope.code))
            code = envelope.code as ErrorCode;
        } catch {
          // Oversized or malformed errors never expose their original prose or details.
        }
      }
      active();
      throw fail(code, trace);
    } finally {
      lease.active--;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(fail('MCP_CONTEXT_RESOURCE_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function executeContextItemResource(
  router: CommandRouter,
  directory: McpResourceDirectory,
  raw: unknown,
  context: RequestContext,
): Promise<CommandResult> {
  return executeContextResource(router, directory, raw, context, 'item');
}

export function executeContextPackResource(
  router: CommandRouter,
  directory: McpResourceDirectory,
  raw: unknown,
  context: RequestContext,
): Promise<CommandResult> {
  return executeContextResource(router, directory, raw, context, 'pack');
}
