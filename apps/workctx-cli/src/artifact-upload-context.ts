import { parseArgs } from 'node:util';
import { ContractError, validateRequestContext } from '@planemem/contracts';
import { WcpClient, FetchWcpTransport, type WcpRequest, type WcpTransport } from '@planemem/sdk';
import {
  artifactUploadContextAuthority,
  artifactUploadContextResult,
  type CommandRouter,
  type RequestContext,
} from '@planemem/api-gateway';

function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use artifacts identity with only optional --timeout-ms (1..2147483647); no JSON, write key or repeated options',
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
      args.positionals.join(' ') !== 'artifacts identity' ||
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

export async function callArtifactUploadContext(
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
      validateRequestContext({ ...options.scope, trace_id: options.trace }),
    );
  } catch {
    throw invalid(options.trace);
  }
  return client.getArtifactUploadContext({ timeout_ms });
}

export async function runArtifactUploadContext(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const timeout_ms = timeoutFor(argv, trace);
  delete context.idempotency_key;
  delete context.expected_version;
  artifactUploadContextAuthority(context);
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
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      artifactUploadContextAuthority(context);
      if (
        request.method !== 'GET' ||
        request.path !== '/v1/artifacts/upload-context' ||
        request.body !== undefined ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !== 16 * 1024 ||
        Object.keys(request.headers).length !== 4 ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value)
      )
        throw invalid(trace);
      if (request.signal?.aborted)
        throw new ContractError('GATEWAY_REQUEST_CANCELED', 'Stopped waiting for upload identity', {
          trace_id: trace,
        });
      const raw = await router.execute({
        operation: 'artifact.upload-context',
        input: {},
        context: structuredClone(context),
      });
      return artifactUploadContextResult(raw, context) as unknown as T;
    },
  };
  return new WcpClient(
    transport,
    validateRequestContext({ ...scope, trace_id: trace }),
  ).getArtifactUploadContext({ timeout_ms });
}
