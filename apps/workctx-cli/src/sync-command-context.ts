import { parseArgs } from 'node:util';
import {
  ContractError,
  parseSyncCommandIdentity,
  parseSyncCommandContextEnvelope,
  SYNC_COMMAND_CONTEXT_BYTES,
} from '@planemem/contracts';
import { WcpClient, FetchWcpTransport, type WcpTransport, type WcpRequest } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';

function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use sync identity with only optional --timeout-ms (1..2147483647); no JSON, write key or repeated options',
    { trace_id: trace, retryable: false },
  );
}
function timeoutFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: { 'timeout-ms': { type: 'string' } },
    });
    const value = args.values['timeout-ms'] ?? '30000';
    if (
      args.positionals.length !== 2 ||
      args.positionals.join(' ') !== 'sync identity' ||
      args.tokens.filter((token) => token.kind === 'option').length > 1 ||
      !/^[1-9][0-9]{0,9}$/.test(value) ||
      Number(value) > 2147483647
    )
      throw new TypeError();
    return Number(value);
  } catch {
    throw invalid(trace);
  }
}
export async function callSyncCommandContext(
  argv: string[],
  options: {
    base: string;
    token: string;
    trace: string;
    scope: { tenant_id: string; workspace_id: string; project_id: string };
  },
) {
  const timeout_ms = timeoutFor(argv, options.trace);
  let client: WcpClient;
  try {
    const base = new URL(options.base);
    const token = options.token.trim();
    if (base.hash || base.search || !token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    client = new WcpClient(
      new FetchWcpTransport({ base_url: base.href, access_token: () => token, timeout_ms }),
      { ...options.scope, trace_id: options.trace },
    );
  } catch {
    throw invalid(options.trace);
  }
  return client.getSyncCommandContext({ timeout_ms });
}

export async function runSyncCommandContext(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const timeout_ms = timeoutFor(argv, trace);
  delete context.idempotency_key;
  delete context.expected_version;
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  const authority = () => {
    const expiry = Date.parse(context.token_expires_at ?? '');
    if (
      context.authenticated_client !== true ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      (context.roles?.includes('admin') !== true && !context.capability.includes('sync.write'))
    )
      throw new ContractError('DENIED', 'A verified unexpired sync writer is required', {
        trace_id: trace,
      });
    try {
      return {
        identity: parseSyncCommandIdentity({
          ...scope,
          actor_id: context.actor_id,
          client_id: context.client_id,
        }),
        expires_at: new Date(expiry).toISOString(),
      };
    } catch {
      throw new ContractError(
        'SYNC_COMMAND_CONTEXT_INVALID',
        'Verified sync identity could not be represented',
        { trace_id: trace },
      );
    }
  };
  const expected = authority();
  const headers: Record<string, string> = {
    'x-trace-id': trace,
    'x-tenant-id': scope.tenant_id,
    'x-workspace-id': scope.workspace_id,
    'x-project-id': scope.project_id,
  };
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      authority();
      if (
        request.method !== 'GET' ||
        request.path !== '/v1/sync/commands/context' ||
        request.body !== undefined ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !== SYNC_COMMAND_CONTEXT_BYTES ||
        Object.keys(request.headers).length !== 4 ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value)
      )
        throw invalid(trace);
      if (request.signal?.aborted)
        throw new ContractError('GATEWAY_REQUEST_CANCELED', 'Stopped waiting for sync identity', {
          trace_id: trace,
        });
      const raw = await router.execute({
        operation: 'sync.command-context',
        input: {},
        context: structuredClone(context),
      });
      authority();
      try {
        const result = parseSyncCommandContextEnvelope(raw, scope, trace, expected.identity);
        if (result.data.expires_at !== expected.expires_at) throw new TypeError();
        return result as unknown as T;
      } catch {
        throw new ContractError(
          'GATEWAY_RESPONSE_INVALID',
          'Sync identity did not match verified authority',
          { trace_id: trace },
        );
      }
    },
  };
  return new WcpClient(transport, {
    ...scope,
    trace_id: trace,
  }).getSyncCommandContext({ timeout_ms });
}
