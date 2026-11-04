import { readSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  ContractError,
  isUlid,
  isSyncIdentifier,
  CONTEXT_HISTORY_RESPONSE_BYTES,
  CONTEXT_REVISION_RESPONSE_BYTES,
  CONTEXT_ITEM_READ_RESPONSE_BYTES,
  CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES,
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  CONTEXT_PACK_DIRECTORY_RESPONSE_BYTES,
  CONTEXT_PACK_SAVE_CONTEXT_BYTES,
  parseContextPackSaveContextEnvelope,
  parseContextPackDirectoryEnvelope,
  parseContextPackDirectoryQuery,
  parseContextPackReadEnvelope,
  parseContextPackReadQuery,
  parseContextPackComparisonQuery,
  parseContextItemDirectoryEnvelope,
  parseContextItemDirectoryQuery,
  parseContextItemReadEnvelope,
  parseContextItemReadQuery,
  parseContextComparisonQuery,
  parseContextHistoryReadEnvelope,
  parseContextHistoryReadQuery,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  validateRequestContext,
  type ContextComparisonQuery,
  type ContextHistoryReadQuery,
  type ContextItemReadQuery,
  type ContextItemDirectoryQuery,
  type ContextPackReadQuery,
  type ContextPackComparisonQuery,
  type ContextPackDirectoryQuery,
  type ContextPackDirectoryEnvelope,
} from '@planemem/contracts';
import { FetchWcpTransport, WcpClient, type WcpRequest, type WcpTransport } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';

type Scope = { tenant_id: string; workspace_id: string; project_id: string };
type Expected = { actor_id: string; client_id: string };
type DirectoryQuery = { kind: 'list'; query: ContextItemDirectoryQuery };
type PackQuery = { kind: 'pack'; query: ContextPackReadQuery };
type PackDirectoryQuery = { kind: 'pack-list'; query: ContextPackDirectoryQuery };
type ReadQuery =
  | ContextHistoryReadQuery
  | ContextItemReadQuery
  | DirectoryQuery
  | PackQuery
  | PackDirectoryQuery
  | { kind: 'save-identity' };
type Target = (
  | ReadQuery
  | { kind: 'compare'; query: ContextComparisonQuery }
  | { kind: 'compare-packs'; query: ContextPackComparisonQuery }
) & {
  expected?: Expected;
};
interface Options {
  base: string;
  token: string;
  trace: string;
  scope: Scope;
  key?: string | undefined;
  timeout_ms?: number;
}
function isDetailQuery(query: Target): query is ContextItemReadQuery & { expected?: Expected } {
  return query.kind === 'current' || query.kind === 'archived';
}
function inputLimit(command: string) {
  return command === 'context list' ? 8192 : 4096;
}
const activeReads = new WeakMap<CommandRouter, { active: number }>();

export function isContextReadCommand(command: string) {
  return [
    'context save-identity',
    'context get',
    'context list-packs',
    'context list',
    'context read',
    'context read-archived',
    'context history',
    'context version',
    'context compare',
    'context compare-packs',
  ].includes(command);
}
function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use context save-identity/get/list-packs/list/read/read-archived/history/version/compare/compare-packs with --json or --json-file and optional --timeout-ms (1..2147483647). Save-identity accepts at most one input (4 KiB), defaults to {}, and accepts only optional paired expected_actor_id/expected_client_id; it reads current authority without saving or replacing original requests. Get accepts at most one input (4 KiB), defaults to {}, and accepts optional pack_id/format (json/markdown/mcp). List-packs accepts at most one input (4 KiB), defaults to {}, and accepts optional pack_id/limit/cursor for saved metadata only. List accepts at most one input (8 KiB), defaults to {}, and preserves filters/view/limit/cursor for explicit continuation. Other reads require exactly one input (4 KiB): details accept item_id; history adds optional before_version/limit, version requires version, compare requires item_id and distinct from_version/to_version; compare-packs requires distinct from_pack_id/to_pack_id. Optional expected_actor_id/expected_client_id must be paired; both comparison commands require them. No --key, --output, write fields, repeated or unknown options.',
    { trace_id: trace, retryable: false },
  );
}
function timeout(value: unknown, trace: string) {
  const result = value === undefined ? 30_000 : value;
  if (
    typeof result !== 'number' ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > 2_147_483_647
  )
    throw invalid(trace);
  return result;
}
function prepare(command: string, input: unknown, scope: Scope, trace: string): Target {
  try {
    if (!isContextReadCommand(command)) throw new TypeError();
    const raw: unknown = JSON.parse(syncJsonSnapshot(input, inputLimit(command)));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError();
    const row = raw as Record<string, unknown>;
    let expected: Expected | undefined;
    if (
      command === 'context compare' ||
      command === 'context compare-packs' ||
      Object.hasOwn(row, 'expected_actor_id') ||
      Object.hasOwn(row, 'expected_client_id')
    ) {
      const identity = parseSyncCommandIdentity({
        ...scope,
        actor_id: row.expected_actor_id,
        client_id: row.expected_client_id,
      });
      validateRequestContext({ ...identity, trace_id: trace });
      expected = { actor_id: identity.actor_id, client_id: identity.client_id };
    }
    const { expected_actor_id: _actor, expected_client_id: _client, ...query } = row;
    if (command === 'context save-identity') {
      if (
        Object.keys(query).length ||
        (expected && (!isUlid(expected.actor_id) || !isSyncIdentifier(expected.client_id)))
      )
        throw new TypeError();
      return { kind: 'save-identity', ...(expected ? { expected } : {}) };
    }
    if (command === 'context compare-packs')
      return {
        kind: 'compare-packs',
        query: parseContextPackComparisonQuery(query),
        expected: expected!,
      };
    if (command === 'context get')
      return {
        kind: 'pack',
        query: parseContextPackReadQuery(query),
        ...(expected ? { expected } : {}),
      };
    if (command === 'context list-packs')
      return {
        kind: 'pack-list',
        query: parseContextPackDirectoryQuery(query),
        ...(expected ? { expected } : {}),
      };
    if (command === 'context list')
      return {
        kind: 'list',
        query: parseContextItemDirectoryQuery(query),
        ...(expected ? { expected } : {}),
      };
    if (Object.hasOwn(query, 'kind')) throw new TypeError();
    const target =
      command === 'context read' || command === 'context read-archived'
        ? parseContextItemReadQuery({
            ...query,
            kind: command === 'context read' ? 'current' : 'archived',
          })
        : command === 'context compare'
          ? { kind: 'compare' as const, query: parseContextComparisonQuery(query) }
          : parseContextHistoryReadQuery({
              ...query,
              kind: command === 'context history' ? 'history' : 'version',
            });
    return { ...target, ...(expected ? { expected } : {}) };
  } catch {
    throw invalid(trace);
  }
}

// File/stdin capture precedes the SDK deadline; waiting for EOF is not cancelable.
function readStdin(inputBytes: number) {
  const bytes = new Uint8Array(inputBytes + 1);
  let used = 0;
  while (used < bytes.length) {
    const count = readSync(0, bytes, used, bytes.length - used, null);
    if (count === 0) break;
    used += count;
  }
  if (used > inputBytes) throw new TypeError();
  return bytes.subarray(0, used);
}
async function argumentsFor(argv: string[], scope: Scope, trace: string, allowStdin: boolean) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        json: { type: 'string' },
        'json-file': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const command = args.positionals.join(' ');
    const inputBytes = inputLimit(command);
    const raw = args.values.json;
    const file = args.values['json-file'];
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    if (
      args.positionals.length !== 2 ||
      !isContextReadCommand(command) ||
      (raw !== undefined && file !== undefined) ||
      (!['context list', 'context get', 'context list-packs', 'context save-identity'].includes(
        command,
      ) &&
        raw === undefined &&
        file === undefined) ||
      (file !== undefined && (!file.trim() || file === '-' || /[\u0000-\u001f]/.test(file))) ||
      (raw === '-' && !allowStdin) ||
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout)
    )
      throw new TypeError();
    const timeout_ms = timeout(Number(rawTimeout), trace);
    let text: string;
    if (file !== undefined || raw === '-') {
      const bytes =
        file === undefined
          ? readStdin(inputBytes)
          : await readBoundedArtifactFile(file, inputBytes, trace);
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } else {
      text = raw ?? '{}';
      if (Buffer.byteLength(text, 'utf8') > inputBytes) throw new TypeError();
    }
    return { target: prepare(command, JSON.parse(text), scope, trace), timeout_ms };
  } catch {
    throw invalid(trace);
  }
}
function execute(client: WcpClient, target: Target, timeout_ms: number) {
  if (target.kind === 'save-identity') return client.getContextPackSaveContext({ timeout_ms });
  if (target.kind === 'compare-packs')
    return client.compareContextPacks(target.query, { timeout_ms });
  if (target.kind === 'pack') return client.getContextPack(target.query, { timeout_ms });
  if (target.kind === 'pack-list') return client.listContextPacks(target.query, { timeout_ms });
  if (target.kind === 'list') return client.listContextItems(target.query, { timeout_ms });
  if (isDetailQuery(target))
    return target.kind === 'current'
      ? client.getContextItem(target.item_id, { timeout_ms })
      : client.getArchivedContextItem(target.item_id, { timeout_ms });
  if (target.kind === 'compare')
    return client.compareContextItemVersions(target.query, { timeout_ms });
  if (target.kind === 'version')
    return client.getContextItemVersion(target.item_id, target.version, { timeout_ms });
  return client.listContextItemHistory(
    target.item_id,
    {
      limit: target.limit,
      ...(target.before_version === undefined ? {} : { before_version: target.before_version }),
    },
    { timeout_ms },
  );
}
function networkClient(options: Options, expected?: Expected) {
  try {
    if (options.key !== undefined) throw new TypeError();
    const base = new URL(options.base);
    const token = options.token.trim();
    if (base.search || base.hash || !token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    return new WcpClient(
      new FetchWcpTransport({
        base_url: base.href,
        access_token: () => token,
        timeout_ms: timeout(options.timeout_ms, options.trace),
      }),
      validateRequestContext({ ...options.scope, ...expected, trace_id: options.trace }),
    );
  } catch {
    throw invalid(options.trace);
  }
}
export async function callContextRead(command: string, input: unknown, options: Options) {
  const saved = structuredClone(options);
  const target = prepare(command, input, saved.scope, saved.trace);
  return execute(
    networkClient(saved, target.expected),
    target,
    timeout(saved.timeout_ms, saved.trace),
  );
}
export async function callContextReadArguments(argv: string[], options: Options) {
  const saved = structuredClone(options);
  networkClient(saved);
  const { target, timeout_ms } = await argumentsFor(argv, saved.scope, saved.trace, true);
  return execute(networkClient({ ...saved, timeout_ms }, target.expected), target, timeout_ms);
}

function readPath(query: ReadQuery) {
  if (query.kind === 'save-identity') return '/v1/context-pack/save-context';
  if (query.kind === 'pack-list') {
    const params = new URLSearchParams({ limit: String(query.query.limit) });
    if (query.query.pack_id !== undefined) params.set('pack_id', query.query.pack_id);
    if (query.query.cursor !== undefined) params.set('cursor', query.query.cursor);
    return '/v1/context-packs?' + params.toString();
  }
  if (query.kind === 'pack') {
    const params = new URLSearchParams();
    if (query.query.pack_id !== undefined) params.set('pack_id', query.query.pack_id);
    if (query.query.format !== undefined) params.set('format', query.query.format);
    return '/v1/context-pack' + (params.size ? '?' + params.toString() : '');
  }
  if (query.kind === 'list') return '/v1/workbench/query';
  const root = '/v1/context-items/' + encodeURIComponent(query.item_id);
  if (isDetailQuery(query)) return root + (query.kind === 'archived' ? '/archived' : '');
  if (query.kind === 'version') return root + '/versions/' + query.version;
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.before_version !== undefined)
    params.set('before_version', String(query.before_version));
  return root + '/history?' + params.toString();
}

function responseLimit(query: ReadQuery) {
  if (query.kind === 'save-identity') return CONTEXT_PACK_SAVE_CONTEXT_BYTES;
  if (query.kind === 'pack-list') return CONTEXT_PACK_DIRECTORY_RESPONSE_BYTES;
  if (query.kind === 'pack') return CONTEXT_PACK_READ_RESPONSE_BYTES;
  if (query.kind === 'list') return CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES;
  if (query.kind === 'history') return CONTEXT_HISTORY_RESPONSE_BYTES;
  if (query.kind === 'version') return CONTEXT_REVISION_RESPONSE_BYTES;
  return CONTEXT_ITEM_READ_RESPONSE_BYTES;
}
export async function runContextRead(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = structuredClone(original);
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  const trace = context.trace_id;
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  const authority = () => {
    const expires = Date.parse(context.token_expires_at ?? '');
    if (
      context.authenticated_client !== true ||
      !Number.isFinite(expires) ||
      expires <= Date.now() ||
      !Array.isArray(context.capability) ||
      !context.capability.includes('context.read')
    )
      throw new ContractError(
        'DENIED',
        'Use a verified unexpired client with context.read capability',
        { trace_id: trace, retryable: false },
      );
  };
  authority();
  const { target, timeout_ms } = await argumentsFor(argv, scope, trace, false);
  if (
    target.expected &&
    (target.expected.actor_id !== context.actor_id ||
      target.expected.client_id !== context.client_id)
  )
    throw new ContractError(
      'DENIED',
      'The selected account or client differs from the verified reader',
      { trace_id: trace, retryable: false },
    );
  const headers: Record<string, string> = {
    'x-trace-id': trace,
    'x-tenant-id': scope.tenant_id,
    'x-workspace-id': scope.workspace_id,
    'x-project-id': scope.project_id,
    'x-expected-actor-id': context.actor_id,
    'x-expected-client-id': context.client_id,
  };
  const queries: ReadQuery[] =
    target.kind === 'compare'
      ? [target.query.from_version, target.query.to_version].map((version) => ({
          kind: 'version',
          item_id: target.query.item_id,
          version,
        }))
      : target.kind === 'compare-packs'
        ? [target.query.from_pack_id, target.query.to_pack_id].map(
            (pack_id): PackQuery => ({
              kind: 'pack',
              query: { pack_id, format: 'json' },
            }),
          )
        : [
            target.kind === 'save-identity'
              ? { kind: 'save-identity' }
              : target.kind === 'pack'
                ? { kind: 'pack', query: parseContextPackReadQuery(target.query) }
                : target.kind === 'pack-list'
                  ? { kind: 'pack-list', query: parseContextPackDirectoryQuery(target.query) }
                  : target.kind === 'list'
                    ? { kind: 'list', query: parseContextItemDirectoryQuery(target.query) }
                    : isDetailQuery(target)
                      ? parseContextItemReadQuery({ kind: target.kind, item_id: target.item_id })
                      : parseContextHistoryReadQuery(
                          target.kind === 'history'
                            ? {
                                kind: 'history',
                                item_id: target.item_id,
                                limit: target.limit,
                                ...(target.before_version === undefined
                                  ? {}
                                  : { before_version: target.before_version }),
                              }
                            : { kind: 'version', item_id: target.item_id, version: target.version },
                        ),
          ];
  let step = 0;
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      const active = () => {
        if (request.signal?.aborted)
          throw new ContractError(
            'GATEWAY_REQUEST_CANCELED',
            'Stopped waiting for the context read',
            { trace_id: trace, retryable: false },
          );
        authority();
      };
      active();
      const query = queries[step];
      if (
        !query ||
        request.method !== (query.kind === 'list' ? 'POST' : 'GET') ||
        request.path !== readPath(query) ||
        request.response_type !== 'bounded-json' ||
        (query.kind === 'list'
          ? syncJsonSnapshot(request.body, 8192) !==
            syncJsonSnapshot({ ...query.query, operation: 'context' }, 8192)
          : request.body !== undefined) ||
        request.max_response_bytes !== responseLimit(query) ||
        Object.keys(request.headers).length !== Object.keys(headers).length ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value)
      )
        throw invalid(trace);
      let gate = activeReads.get(router);
      if (!gate) {
        gate = { active: 0 };
        activeReads.set(router, gate);
      }
      if (gate.active >= 2)
        throw new ContractError('RATE_LIMITED', 'Embedded context read capacity is occupied', {
          trace_id: trace,
          retryable: false,
        });
      const lease = gate;
      lease.active++;
      step++;
      try {
        let raw;
        if (query.kind === 'list') {
          raw = await router.execute({
            operation: 'workbench.query',
            input: { ...query.query, operation: 'context' },
            context: structuredClone(context),
          });
        } else if (
          query.kind === 'save-identity' ||
          query.kind === 'pack' ||
          query.kind === 'pack-list'
        ) {
          raw = await router.execute(
            {
              operation:
                query.kind === 'save-identity'
                  ? 'context.pack.save-context'
                  : query.kind === 'pack'
                    ? 'context.pack.read'
                    : 'context.pack.list',
              input: query.kind === 'save-identity' ? {} : { ...query.query },
              context: structuredClone(context),
            },
            async (run) => {
              active();
              return run();
            },
          );
        } else {
          const { kind, ...input } = query;
          raw = await router.execute({
            operation: {
              current: 'context.item.read',
              archived: 'context.item.archived.read',
              history: 'context.item.history',
              version: 'context.item.version.read',
            }[kind],
            input,
            context: structuredClone(context),
          });
        }
        active();
        if (query.kind === 'save-identity') {
          try {
            const result = parseContextPackSaveContextEnvelope(raw, context, trace);
            if (
              Date.parse(result.data.expires_at) !== Date.parse(context.token_expires_at!) ||
              Date.parse(result.data.expires_at) <= Date.now() ||
              result.data.permissions.read_restricted !==
                context.capability.includes('data.restricted.read')
            )
              throw new TypeError();
            active();
            return result as unknown as T;
          } catch {
            active();
            throw new ContractError(
              'GATEWAY_RESPONSE_INVALID',
              'The complete save identity differs from the verified reader',
              {
                trace_id: trace,
                retryable: false,
              },
            );
          }
        }
        if (query.kind === 'pack-list') {
          let page: ContextPackDirectoryEnvelope;
          try {
            page = parseContextPackDirectoryEnvelope(raw, query.query, scope, trace);
          } catch {
            active();
            throw new ContractError(
              'GATEWAY_RESPONSE_INVALID',
              'The complete saved pack metadata page could not be validated',
              { trace_id: trace, retryable: false },
            );
          }
          // Metadata has no per-record classification. The trusted list handler must apply
          // current parent-project and saved read_restricted filtering before returning it.
          active();
          return page as unknown as T;
        }
        let result;
        try {
          result =
            query.kind === 'pack'
              ? parseContextPackReadEnvelope(raw, query.query, scope, trace)
              : query.kind === 'list'
                ? parseContextItemDirectoryEnvelope(raw, query.query, scope, trace)
                : isDetailQuery(query)
                  ? parseContextItemReadEnvelope(raw, query, scope, trace)
                  : parseContextHistoryReadEnvelope(raw, query, scope, trace);
        } catch {
          throw new ContractError(
            'GATEWAY_RESPONSE_INVALID',
            'The complete context response could not be validated',
            { trace_id: trace, retryable: false },
          );
        }
        const records = Array.isArray(result.data)
          ? result.data
          : 'pack' in result.data
            ? result.data.pack.items.map((item) => ({ classification: item.sensitivity }))
            : 'versions' in result.data
              ? result.data.versions
              : [result.data];
        if (
          !context.capability.includes('data.restricted.read') &&
          records.some((record) => record.classification === 'restricted')
        )
          throw new ContractError(
            'DENIED',
            'Restricted context records are unavailable to this reader',
            { trace_id: trace, retryable: false },
          );
        active();
        return result as unknown as T;
      } finally {
        // SDK timeout stops waiting; the slot remains occupied until the router actually settles.
        lease.active--;
      }
    },
  };
  let client: WcpClient;
  try {
    client = new WcpClient(
      transport,
      validateRequestContext({
        ...scope,
        trace_id: trace,
        actor_id: context.actor_id,
        client_id: context.client_id,
      }),
    );
  } catch {
    throw invalid(trace);
  }
  const result = await execute(client, target, timeout_ms);
  authority();
  return result;
}
