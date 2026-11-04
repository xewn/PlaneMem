import { readSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  ContractError,
  parseSyncCommandIdentity,
  parseWorkItemListQuery,
  parseWorkItemProjectionQuery,
  syncJsonSnapshot,
  validateRequestContext,
  type WorkItemListQuery,
} from '@planemem/contracts';
import { FetchWcpTransport, WcpClient, type WcpRequest, type WcpTransport } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';

type Scope = { tenant_id: string; workspace_id: string; project_id: string };
type Expected = { actor_id: string; client_id: string };
type Target = (
  | { kind: 'list'; query: WorkItemListQuery }
  | { kind: 'get'; query: { item_id: string } }
) & { expected?: Expected };
interface Options {
  base: string;
  token: string;
  trace: string;
  scope: Scope;
  key?: string | undefined;
  timeout_ms?: number;
}
const inputBytes = 8192;
const responseBytes = 2 * 1024 * 1024;
const activeReads = new WeakMap<CommandRouter, { active: number }>();

export function isWorkItemReadCommand(command: string) {
  return command === 'work-items list' || command === 'work-items get';
}
function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use work-items list/get with at most one --json or --json-file and optional --timeout-ms (1..2147483647). JSON is limited to 8 KiB; list may omit it, get requires item_id. Optional expected_actor_id/expected_client_id must be supplied together. No --key, --output, write fields, repeated or unknown options; preserve filters and cursor for explicit continuation.',
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
    if (!isWorkItemReadCommand(command)) throw new TypeError();
    const raw: unknown = JSON.parse(syncJsonSnapshot(input, inputBytes));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError();
    const row = raw as Record<string, unknown>;
    let expected: Expected | undefined;
    if (Object.hasOwn(row, 'expected_actor_id') || Object.hasOwn(row, 'expected_client_id')) {
      const identity = parseSyncCommandIdentity({
        ...scope,
        actor_id: row.expected_actor_id,
        client_id: row.expected_client_id,
      });
      validateRequestContext({ ...identity, trace_id: trace });
      expected = { actor_id: identity.actor_id, client_id: identity.client_id };
    }
    const { expected_actor_id: _actor, expected_client_id: _client, ...query } = row;
    return command === 'work-items list'
      ? { kind: 'list', query: parseWorkItemListQuery(query), ...(expected ? { expected } : {}) }
      : {
          kind: 'get',
          query: parseWorkItemProjectionQuery(query),
          ...(expected ? { expected } : {}),
        };
  } catch {
    throw invalid(trace);
  }
}

// Bounded input capture precedes the SDK network budget, including waiting for stdin EOF.
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
      !isWorkItemReadCommand(command) ||
      (raw !== undefined && file !== undefined) ||
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
      text = raw ?? '{}';
      if (Buffer.byteLength(text, 'utf8') > inputBytes) throw new TypeError();
    }
    return { target: prepare(command, JSON.parse(text), scope, trace), timeout_ms };
  } catch {
    throw invalid(trace);
  }
}
function execute(client: WcpClient, target: Target, timeout_ms: number) {
  return target.kind === 'list'
    ? client.listWorkItemProjections(target.query, { timeout_ms })
    : client.getWorkItemProjection(target.query.item_id, { timeout_ms });
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
export async function callWorkItemRead(command: string, input: unknown, options: Options) {
  const saved = structuredClone(options);
  const target = prepare(command, input, saved.scope, saved.trace);
  return execute(
    networkClient(saved, target.expected),
    target,
    timeout(saved.timeout_ms, saved.trace),
  );
}
export async function callWorkItemReadArguments(argv: string[], options: Options) {
  const saved = structuredClone(options);
  networkClient(saved); // Validate network configuration before consuming any input file/stdin.
  const { target, timeout_ms } = await argumentsFor(argv, saved.scope, saved.trace, true);
  return execute(networkClient({ ...saved, timeout_ms }, target.expected), target, timeout_ms);
}

export async function runWorkItemRead(
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
  const input = syncJsonSnapshot(
    { operation: target.kind === 'list' ? 'work_items' : 'work_item', ...target.query },
    inputBytes,
  );
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      const active = () => {
        if (request.signal?.aborted)
          throw new ContractError('GATEWAY_REQUEST_CANCELED', 'Stopped waiting for work items', {
            trace_id: trace,
            retryable: false,
          });
        authority();
      };
      active();
      if (
        request.method !== 'POST' ||
        request.path !== '/v1/workbench/query' ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !== responseBytes ||
        Object.keys(request.headers).length !== Object.keys(headers).length ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value) ||
        syncJsonSnapshot(request.body, inputBytes) !== input
      )
        throw invalid(trace);
      let gate = activeReads.get(router);
      if (!gate) {
        gate = { active: 0 };
        activeReads.set(router, gate);
      }
      if (gate.active >= 2)
        throw new ContractError('RATE_LIMITED', 'Embedded work item read capacity is occupied', {
          trace_id: trace,
          retryable: false,
        });
      const lease = gate;
      lease.active++;
      try {
        const result = await router.execute({
          operation: 'workbench.query',
          input: JSON.parse(input) as Record<string, unknown>,
          context: structuredClone(context),
        });
        active();
        return result as unknown as T;
      } finally {
        // The SDK can stop waiting before the router settles; retain capacity until this point.
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
  const items = Array.isArray(result.data) ? result.data : [result.data];
  if (
    !context.capability.includes('data.restricted.read') &&
    items.some((item) => item.classification === 'restricted')
  )
    throw new ContractError('DENIED', 'Restricted work items are unavailable to this reader', {
      trace_id: trace,
      retryable: false,
    });
  return result;
}
