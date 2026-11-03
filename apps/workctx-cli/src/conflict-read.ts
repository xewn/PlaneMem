import { parseArgs } from 'node:util';
import {
  ContractError,
  parseConflictReadQuery,
  CONFLICT_READ_RESPONSE_BYTES,
} from '@planemem/contracts';
import { FetchWcpTransport, WcpClient, type WcpRequest, type WcpTransport } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';

function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use conflicts get with JSON containing only conflict_id; no write key or repeated options',
    { trace_id: trace, retryable: false },
  );
}
export async function callConflictRead(
  input: unknown,
  options: {
    base: string;
    token: string;
    trace: string;
    scope: { tenant_id: string; workspace_id: string; project_id: string };
    key?: string | undefined;
  },
) {
  let query;
  let client: WcpClient;
  try {
    if (options.key !== undefined) throw new TypeError();
    query = parseConflictReadQuery(input);
    const base = new URL(options.base);
    const token = options.token.trim();
    if (base.hash || base.search || !token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    client = new WcpClient(
      new FetchWcpTransport({ base_url: base.href, access_token: () => token, timeout_ms: 30_000 }),
      { ...options.scope, trace_id: options.trace },
    );
  } catch {
    throw invalid(options.trace);
  }
  return client.getConflict(query.conflict_id);
}
export async function runConflictRead(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = structuredClone(original);
  delete context.idempotency_key;
  delete context.expected_version;
  const trace = context.trace_id;
  let query;
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: { json: { type: 'string' } },
    });
    if (
      parsed.positionals.length !== 2 ||
      parsed.positionals.join(' ') !== 'conflicts get' ||
      parsed.tokens.filter((token) => token.kind === 'option').length > 1
    )
      throw new TypeError();
    const raw = parsed.values.json ?? '{}';
    if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) throw new TypeError();
    query = parseConflictReadQuery(JSON.parse(raw));
  } catch {
    throw invalid(trace);
  }
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  const headers: Record<string, string> = {
    'x-trace-id': trace,
    'x-tenant-id': scope.tenant_id,
    'x-workspace-id': scope.workspace_id,
    'x-project-id': scope.project_id,
  };
  const target = { ...query };
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      if (
        request.method !== 'GET' ||
        request.path !== '/v1/conflicts/' + encodeURIComponent(target.conflict_id) ||
        request.body !== undefined ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !== CONFLICT_READ_RESPONSE_BYTES ||
        Object.keys(request.headers).length !== 4 ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value)
      )
        throw invalid(trace);
      return (await router.execute({
        operation: 'conflict.read',
        input: { ...target },
        context: structuredClone(context),
      })) as unknown as T;
    },
  };
  return new WcpClient(transport, { ...scope, trace_id: trace }).getConflict(target.conflict_id);
}
