import { parseArgs } from 'node:util';
import {
  ContractError,
  parseWorkbenchAdminEnvelope,
  validateRequestContext,
  WORKBENCH_ADMIN_RESPONSE_BYTES,
  type WorkbenchAdminScope,
} from '@planemem/contracts';
import { FetchWcpTransport, WcpClient, type WcpRequest, type WcpTransport } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';

function usage(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use admin snapshot with optional --timeout-ms (1..2147483647). No JSON, files, write keys, queue options or repeated flags.',
    { trace_id: trace, retryable: false },
  );
}

function timeoutFor(argv: string[], trace: string): number {
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: { 'timeout-ms': { type: 'string' } },
    });
    if (
      parsed.positionals.length !== 2 ||
      parsed.positionals.join(' ') !== 'admin snapshot' ||
      parsed.tokens.filter((token) => token.kind === 'option').length > 1
    )
      throw new TypeError();
    const value = parsed.values['timeout-ms'];
    if (value !== undefined && !/^[1-9][0-9]{0,9}$/.test(value)) throw new TypeError();
    const timeout = value === undefined ? 30_000 : Number(value);
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647)
      throw new TypeError();
    return timeout;
  } catch {
    throw usage(trace);
  }
}

function clientContext(scope: WorkbenchAdminScope, trace: string) {
  try {
    return validateRequestContext({ ...scope, trace_id: trace });
  } catch {
    throw usage(trace);
  }
}

export async function callAdminSnapshot(
  argv: string[],
  options: { base: string; token: string; scope: WorkbenchAdminScope; trace: string },
) {
  const trace = options.trace;
  const timeout_ms = timeoutFor(argv, trace);
  const scope = {
    tenant_id: options.scope.tenant_id,
    workspace_id: options.scope.workspace_id,
    project_id: options.scope.project_id,
  };
  const context = clientContext(scope, trace);
  let client;
  try {
    const token = options.token.trim();
    const base = new URL(options.base);
    if (!token || base.search || base.hash) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    client = new WcpClient(
      new FetchWcpTransport({ base_url: base.href, access_token: () => token, timeout_ms }),
      context,
    );
  } catch {
    throw usage(trace);
  }
  return client.getAdminSnapshot({ timeout_ms });
}

export async function runAdminSnapshot(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const timeout_ms = timeoutFor(argv, trace);
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  const sdkContext = clientContext(scope, trace);
  delete context.idempotency_key;
  delete context.expected_version;
  const authorize = () => {
    const expiry = Date.parse(context.token_expires_at ?? '');
    if (
      context.authenticated_client !== true ||
      !context.roles?.includes('admin') ||
      !context.capability.includes('admin.read') ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now()
    )
      throw new ContractError('DENIED', 'A verified administrator with admin.read is required', {
        trace_id: trace,
        retryable: false,
      });
  };
  authorize();
  const expectedHeaders = {
    'x-trace-id': trace,
    'x-tenant-id': scope.tenant_id,
    'x-workspace-id': scope.workspace_id,
    'x-project-id': scope.project_id,
  };
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      authorize();
      if (request.signal?.aborted)
        throw new ContractError('GATEWAY_REQUEST_CANCELED', 'Stopped waiting for the snapshot', {
          trace_id: trace,
        });
      if (
        request.method !== 'POST' ||
        request.path !== '/v1/workbench/query' ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !== WORKBENCH_ADMIN_RESPONSE_BYTES ||
        !request.body ||
        typeof request.body !== 'object' ||
        Array.isArray(request.body) ||
        Object.keys(request.body).length !== 1 ||
        (request.body as Record<string, unknown>).operation !== 'admin' ||
        Object.keys(request.headers).length !== Object.keys(expectedHeaders).length ||
        Object.entries(expectedHeaders).some(([key, value]) => request.headers[key] !== value)
      )
        throw new ContractError('INVALID_INPUT', 'Unsupported embedded administration request', {
          trace_id: trace,
        });
      const response = await router.execute({
        operation: 'workbench.query',
        input: { operation: 'admin' },
        context: structuredClone(context),
      });
      authorize();
      let result;
      try {
        result = parseWorkbenchAdminEnvelope(response, scope, trace, {
          audit: context.capability.includes('audit.read'),
          context: context.capability.includes('context.read'),
        });
      } catch {
        throw new ContractError('GATEWAY_RESPONSE_INVALID', 'Invalid administration snapshot', {
          trace_id: trace,
        });
      }
      authorize();
      return result as unknown as T;
    },
  };
  return new WcpClient(transport, sdkContext).getAdminSnapshot({ timeout_ms });
}
