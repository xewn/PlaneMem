import { parseArgs } from 'node:util';
import {
  ContractError,
  parseHandoffRegistryQuery,
  HANDOFF_REGISTRY_RESPONSE_BYTES,
  type HandoffRegistryQuery,
} from '@planemem/contracts';
import { WcpClient, FetchWcpTransport, type WcpTransport, type WcpRequest } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';

function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use handoffs list with query/status/session_id/origin/limit/cursor JSON; no write key or repeated options',
    { trace_id: trace, retryable: false },
  );
}
export async function callHandoffRegistry(
  input: unknown,
  options: {
    base: string;
    token: string;
    trace: string;
    scope: { tenant_id: string; workspace_id: string; project_id: string };
    key?: string | undefined;
  },
) {
  let query: HandoffRegistryQuery;
  let client: WcpClient;
  try {
    if (options.key !== undefined) throw new TypeError();
    query = parseHandoffRegistryQuery(input);
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
  return client.listHandoffs(query);
}
export async function runHandoffRegistry(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  delete context.idempotency_key;
  delete context.expected_version;
  let query: HandoffRegistryQuery;
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: { json: { type: 'string' } },
    });
    if (
      parsed.positionals.length !== 2 ||
      parsed.positionals.join(' ') !== 'handoffs list' ||
      parsed.tokens.filter((token) => token.kind === 'option').length > 1
    )
      throw new TypeError();
    const raw = parsed.values.json ?? '{}';
    if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) throw new TypeError();
    query = parseHandoffRegistryQuery(JSON.parse(raw));
  } catch {
    throw invalid(trace);
  }
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  const body = { operation: 'handoffs', ...query };
  const headers: Record<string, string> = {
    'x-trace-id': trace,
    'x-tenant-id': scope.tenant_id,
    'x-workspace-id': scope.workspace_id,
    'x-project-id': scope.project_id,
  };
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      if (
        request.method !== 'POST' ||
        request.path !== '/v1/workbench/query' ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !== HANDOFF_REGISTRY_RESPONSE_BYTES ||
        JSON.stringify(request.body) !== JSON.stringify(body) ||
        Object.keys(request.headers).length !== 4 ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value)
      )
        throw invalid(trace);
      return (await router.execute({
        operation: 'workbench.query',
        input: { ...body },
        context: structuredClone(context),
      })) as unknown as T;
    },
  };
  return new WcpClient(transport, { ...scope, trace_id: trace }).listHandoffs(query);
}
