import { createHash } from 'node:crypto';
import {
  ContractError,
  CONTEXT_PACK_READ_ERROR_BYTES,
  contextPackReadHashJson,
  isSyncIdentifier,
  parseContextPackReadEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
} from '@planemem/contracts';
import type { CommandResult, CommandRouter, RequestContext } from '../router.js';
import type { McpResourceDirectory } from './resource-directory.js';
import { canReadContextTool } from './context-history.js';

const maximum = 1024 * 1024;
const activeReads = new WeakMap<CommandRouter, { active: number }>();
const messages = {
  INVALID_INPUT:
    'Supply a current resource cursor or restart from the first page with the intended identity',
  DENIED: 'Use a verified unexpired client with actual context.read and complete identity',
  UNAUTHENTICATED: 'Renew the intended session before listing resources',
  MCP_STORAGE_UNAVAILABLE: 'Resource directory storage is unavailable',
  MCP_RESOURCE_INVALID: 'The complete resource directory or saved pack could not be validated',
  MCP_RESOURCE_DIRECTORY_BUSY: 'MCP resource directory read capacity is occupied',
  MCP_RESOURCE_DIRECTORY_TIMEOUT:
    'Stopped waiting for the resource directory; underlying work may still be running',
  CONTEXT_PACK_NOT_FOUND: 'The candidate context pack is unavailable in this project',
  CONTEXT_PACK_EXPIRED: 'The candidate context pack expired',
  CONTEXT_PACK_STALE: 'The candidate context pack sources changed',
  CONTEXT_PACK_INVALID: 'The candidate context pack is invalid',
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Context pack storage is unavailable',
  CONTEXT_SOURCE_LIMIT: 'Candidate context pack source checks exceeded their limit',
  CONTEXT_PACK_INTEGRITY_UNAVAILABLE: 'Context pack integrity checking is unavailable',
  CONTEXT_PACK_HASH_MISMATCH: 'The candidate context pack differs from its saved hash',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The resource directory read audit could not be persisted',
} as const;
type ErrorCode = keyof typeof messages;
function fail(code: ErrorCode, trace: string) {
  return new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}
function checkedFailure(error: unknown, trace: string): ContractError {
  if (error instanceof ContractError) {
    try {
      const envelope = validateErrorEnvelope(
        JSON.parse(syncJsonSnapshot(error.envelope, CONTEXT_PACK_READ_ERROR_BYTES)),
      );
      if (envelope.trace_id === trace && Object.hasOwn(messages, envelope.code))
        return fail(envelope.code as ErrorCode, trace);
    } catch {
      /* Never expose oversized or malformed errors or their original prose. */
    }
  }
  return fail('MCP_RESOURCE_INVALID', trace);
}

/** Outer catalog authorization precedes this budget; metadata and all pack checks share it. */
export async function executeResourceDirectory(
  router: CommandRouter,
  directory: McpResourceDirectory,
  raw: unknown,
  original: RequestContext,
): Promise<CommandResult> {
  const deadline = performance.now() + 30_000;
  const trace = isSyncIdentifier(original.trace_id) ? original.trace_id : 'trace_unknown';
  let context: RequestContext;
  try {
    context = structuredClone(original);
    if (
      !Array.isArray(context.capability) ||
      !context.capability.every(isSyncIdentifier) ||
      (context.roles !== undefined &&
        (!Array.isArray(context.roles) || !context.roles.every(isSyncIdentifier)))
    )
      throw new TypeError();
  } catch {
    throw fail('DENIED', trace);
  }
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_RESOURCE_DIRECTORY_TIMEOUT', trace);
    if (!canReadContextTool(context)) throw fail('DENIED', trace);
  };
  active();
  let cursor: string | undefined;
  try {
    const row: unknown = JSON.parse(syncJsonSnapshot(raw, 8192));
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).some((key) => !['kind', 'cursor'].includes(key)) ||
      !('kind' in row) ||
      row.kind !== 'resources'
    )
      throw new TypeError();
    if ('cursor' in row) {
      if (typeof row.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(row.cursor))
        throw new TypeError();
      cursor = row.cursor;
    }
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  active();
  let gate = activeReads.get(router);
  if (!gate) {
    gate = { active: 0 };
    activeReads.set(router, gate);
  }
  if (gate.active >= 2) throw fail('MCP_RESOURCE_DIRECTORY_BUSY', trace);
  const lease = gate;
  lease.active++;
  const work = (async (): Promise<CommandResult> => {
    try {
      const data = await directory.list(
        context,
        cursor,
        async (packId) => {
          active();
          try {
            const query = { pack_id: packId, format: 'json' as const };
            const response = await router.execute(
              {
                operation: 'context.pack.read',
                input: query,
                context: structuredClone(context),
              },
              async (run) => {
                active();
                return run();
              },
            );
            active();
            const document = parseContextPackReadEnvelope(response, query, context, trace);
            if (
              !context.capability.includes('data.restricted.read') &&
              document.data.pack.items.some((item) => item.sensitivity === 'restricted')
            )
              throw fail('DENIED', trace);
            const snapshot = contextPackReadHashJson(document.data.pack);
            active();
            let hash: string;
            try {
              hash = 'sha256:' + createHash('sha256').update(snapshot, 'utf8').digest('hex');
            } catch {
              throw fail('CONTEXT_PACK_INTEGRITY_UNAVAILABLE', trace);
            }
            if (hash !== document.data.pack.pack_hash)
              throw fail('CONTEXT_PACK_HASH_MISMATCH', trace);
            active();
          } catch (error) {
            active();
            // The directory may skip unavailable candidates only after this exact trace/size check.
            throw checkedFailure(error, trace);
          }
        },
        active,
      );
      active();
      const result: CommandResult = {
        schema_version: 1,
        trace_id: trace,
        source_refs: [{ type: 'mcp', id: 'catalog' }],
        data,
      };
      const detached = JSON.parse(syncJsonSnapshot(result, maximum)) as CommandResult;
      active();
      return detached;
    } catch (error) {
      active();
      throw checkedFailure(error, trace);
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
          () => reject(fail('MCP_RESOURCE_DIRECTORY_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
