import {
  ContractError,
  parseWorkbenchAdminEnvelope,
  validateErrorEnvelope,
  WORKBENCH_ADMIN_RESPONSE_BYTES,
} from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

const preparations = new WeakMap<ApiGateway, { active: number }>();
const messages: Record<string, string> = {
  INVALID_INPUT: 'Administration snapshot takes no arguments',
  DENIED: 'A verified unexpired administrator with actual admin.read is required',
  UNAUTHENTICATED: 'The current session must be renewed',
  NOT_FOUND: 'The project is not available in the readable scope',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  WORKBENCH_DATABASE_UNAVAILABLE: 'The project snapshot could not be read',
  WORKBENCH_ADMIN_INVALID: 'The stored administration snapshot could not be validated',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The request audit could not be persisted',
  MCP_ADMIN_BUSY: 'MCP administration snapshot preparation capacity is occupied',
  MCP_ADMIN_TIMEOUT: 'Stopped waiting; the administration query may still be running',
  GATEWAY_RESPONSE_INVALID: 'The administration snapshot did not match the request',
};

export function canUseAdminSnapshot(context: RequestContext): boolean {
  const expiry = Date.parse(context.token_expires_at ?? '');
  return (
    context.authenticated_client === true &&
    context.roles?.includes('admin') === true &&
    context.capability.includes('admin.read') &&
    Number.isFinite(expiry) &&
    expiry > Date.now()
  );
}

export function prepareAdminSnapshot(raw: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: context.trace_id, retryable: false });
  if (!canUseAdminSnapshot(context)) throw fail('DENIED');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)
    throw fail('INVALID_INPUT');
  delete context.idempotency_key;
  delete context.expected_version;
  return {
    method: 'POST',
    path: '/v1/workbench/query',
    headers: {},
    context,
    body: { operation: 'admin' },
  };
}

/** A bounded project observation; it does not perform external service health checks. */
export async function executeAdminSnapshot(api: ApiGateway, prepared: HttpRequest) {
  const request = structuredClone(prepared);
  const context = request.context;
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  let dispatch: HttpRequest;
  try {
    if (
      request.method !== 'POST' ||
      request.path !== '/v1/workbench/query' ||
      Object.keys(request.headers).length ||
      context.idempotency_key !== undefined ||
      context.expected_version !== undefined ||
      !request.body ||
      typeof request.body !== 'object' ||
      Array.isArray(request.body) ||
      Object.keys(request.body).length !== 1 ||
      request.body.operation !== 'admin'
    )
      throw new TypeError();
    dispatch = prepareAdminSnapshot({}, context);
  } catch (error) {
    if (error instanceof ContractError && error.envelope.code === 'DENIED') throw fail('DENIED');
    throw fail('INVALID_INPUT');
  }
  const deadline = Date.now() + 30_000;
  const active = () => {
    if (Date.now() >= deadline) throw fail('MCP_ADMIN_TIMEOUT');
    if (!canUseAdminSnapshot(context)) throw fail('DENIED');
  };
  let gate = preparations.get(api);
  if (!gate) {
    gate = { active: 0 };
    preparations.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_ADMIN_BUSY');
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      active();
      const response = await api.handle(structuredClone(dispatch));
      active();
      if (Buffer.byteLength(JSON.stringify(response.body), 'utf8') > WORKBENCH_ADMIN_RESPONSE_BYTES)
        throw fail('GATEWAY_RESPONSE_INVALID');
      if (response.status >= 400) {
        const error = validateErrorEnvelope(response.body);
        if (error.trace_id !== trace) throw fail('GATEWAY_RESPONSE_INVALID');
        active();
        throw fail(Object.hasOwn(messages, error.code) ? error.code : 'GATEWAY_RESPONSE_INVALID');
      }
      if (response.status !== 200 || response.headers['x-trace-id'] !== trace)
        throw fail('GATEWAY_RESPONSE_INVALID');
      const envelope = parseWorkbenchAdminEnvelope(response.body, context, trace, {
        audit: context.capability.includes('audit.read'),
        context: context.capability.includes('context.read'),
      });
      const result = { content: [{ type: 'text', text: JSON.stringify(envelope) }] };
      if (
        Buffer.byteLength(JSON.stringify(result), 'utf8') >
        2 * WORKBENCH_ADMIN_RESPONSE_BYTES + 4096
      )
        throw fail('GATEWAY_RESPONSE_INVALID');
      active();
      return result;
    } catch (error) {
      const code =
        error instanceof ContractError &&
        error.envelope.trace_id === trace &&
        Object.hasOwn(messages, error.envelope.code)
          ? error.envelope.code
          : 'GATEWAY_RESPONSE_INVALID';
      throw fail(code);
    } finally {
      lease.active--;
    }
  })();
  // Keep the preparation slot until underlying work settles, even after the caller times out.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(fail('MCP_ADMIN_TIMEOUT')),
          Math.max(1, deadline - Date.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
