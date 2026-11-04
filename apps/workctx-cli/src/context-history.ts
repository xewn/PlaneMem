import { readSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  ContractError,
  CONTEXT_HISTORY_RESPONSE_BYTES,
  CONTEXT_REVISION_RESPONSE_BYTES,
  parseContextComparisonQuery,
  parseContextHistoryReadEnvelope,
  parseContextHistoryReadQuery,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  validateRequestContext,
  type ContextComparisonQuery,
  type ContextHistoryReadQuery,
} from '@planemem/contracts';
import { FetchWcpTransport, WcpClient, type WcpRequest, type WcpTransport } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';

type Scope = { tenant_id: string; workspace_id: string; project_id: string };
type Expected = { actor_id: string; client_id: string };
type Target = (ContextHistoryReadQuery | { kind: 'compare'; query: ContextComparisonQuery }) & {
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
const inputBytes = 4096;
const activeReads = new WeakMap<CommandRouter, { active: number }>();

export function isContextHistoryCommand(command: string) {
  return ['context history', 'context version', 'context compare'].includes(command);
}
function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use context history/version/compare with exactly one --json or --json-file (4 KiB) and optional --timeout-ms (1..2147483647). Supply item_id and history before_version/limit, version, or distinct from_version/to_version. Optional expected_actor_id/expected_client_id must be paired; compare requires both. No --key, --output, write fields, repeated or unknown options.',
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
    if (!isContextHistoryCommand(command)) throw new TypeError();
    const raw: unknown = JSON.parse(syncJsonSnapshot(input, inputBytes));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError();
    const row = raw as Record<string, unknown>;
    let expected: Expected | undefined;
    if (
      command === 'context compare' ||
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
    if (Object.hasOwn(query, 'kind')) throw new TypeError();
    const target =
      command === 'context compare'
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
function readStdin() {
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
    const raw = args.values.json;
    const file = args.values['json-file'];
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    if (
      args.positionals.length !== 2 ||
      !isContextHistoryCommand(command) ||
      (raw === undefined) === (file === undefined) ||
      (file !== undefined && (!file.trim() || file === '-' || /[\u0000-\u001f]/.test(file))) ||
      (raw === '-' && !allowStdin) ||
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout)
    )
      throw new TypeError();
    const timeout_ms = timeout(Number(rawTimeout), trace);
    let text: string;
    if (file !== undefined || raw === '-') {
      const bytes =
        file === undefined ? readStdin() : await readBoundedArtifactFile(file, inputBytes, trace);
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } else {
      if (raw === undefined || Buffer.byteLength(raw, 'utf8') > inputBytes) throw new TypeError();
      text = raw;
    }
    return { target: prepare(command, JSON.parse(text), scope, trace), timeout_ms };
  } catch {
    throw invalid(trace);
  }
}
function execute(client: WcpClient, target: Target, timeout_ms: number) {
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
export async function callContextHistory(command: string, input: unknown, options: Options) {
  const saved = structuredClone(options);
  const target = prepare(command, input, saved.scope, saved.trace);
  return execute(
    networkClient(saved, target.expected),
    target,
    timeout(saved.timeout_ms, saved.trace),
  );
}
export async function callContextHistoryArguments(argv: string[], options: Options) {
  const saved = structuredClone(options);
  networkClient(saved);
  const { target, timeout_ms } = await argumentsFor(argv, saved.scope, saved.trace, true);
  return execute(networkClient({ ...saved, timeout_ms }, target.expected), target, timeout_ms);
}

function readPath(query: ContextHistoryReadQuery) {
  const root = '/v1/context-items/' + encodeURIComponent(query.item_id);
  if (query.kind === 'version') return root + '/versions/' + query.version;
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.before_version !== undefined)
    params.set('before_version', String(query.before_version));
  return root + '/history?' + params.toString();
}
export async function runContextHistory(
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
  const queries: ContextHistoryReadQuery[] =
    target.kind === 'compare'
      ? [target.query.from_version, target.query.to_version].map((version) => ({
          kind: 'version',
          item_id: target.query.item_id,
          version,
        }))
      : [
          parseContextHistoryReadQuery(
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
            'Stopped waiting for context history',
            { trace_id: trace, retryable: false },
          );
        authority();
      };
      active();
      const query = queries[step];
      if (
        !query ||
        request.method !== 'GET' ||
        request.path !== readPath(query) ||
        request.response_type !== 'bounded-json' ||
        request.body !== undefined ||
        request.max_response_bytes !==
          (query.kind === 'history'
            ? CONTEXT_HISTORY_RESPONSE_BYTES
            : CONTEXT_REVISION_RESPONSE_BYTES) ||
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
        throw new ContractError(
          'RATE_LIMITED',
          'Embedded context history read capacity is occupied',
          { trace_id: trace, retryable: false },
        );
      const lease = gate;
      lease.active++;
      step++;
      try {
        const { kind, ...input } = query;
        const raw = await router.execute({
          operation: kind === 'history' ? 'context.item.history' : 'context.item.version.read',
          input,
          context: structuredClone(context),
        });
        active();
        let result;
        try {
          result = parseContextHistoryReadEnvelope(raw, query, scope, trace);
        } catch {
          throw new ContractError(
            'GATEWAY_RESPONSE_INVALID',
            'Context history response could not be validated',
            { trace_id: trace, retryable: false },
          );
        }
        const records = 'versions' in result.data ? result.data.versions : [result.data];
        if (
          !context.capability.includes('data.restricted.read') &&
          records.some((record) => record.classification === 'restricted')
        )
          throw new ContractError(
            'DENIED',
            'Restricted context history is unavailable to this reader',
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
