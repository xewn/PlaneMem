import {
  ContractError,
  isSyncIdentifier,
  parseConflictCommandContextEnvelope,
  CONFLICT_COMMAND_CONTEXT_BYTES,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpConflictCommandContextOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply a project scope, optional original identity constraints and valid timeout/signal options',
  DENIED: 'A verified unexpired account and client with conflict resolution access is required',
  UNAUTHENTICATED: 'Renew the original session to read its conflict operation identity',
  RATE_LIMITED: 'Conflict identity reads are temporarily busy',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The identity read audit could not be persisted',
  CONFLICT_COMMAND_CONTEXT_INVALID: 'The verified conflict identity could not be represented',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for conflict identity',
  GATEWAY_REQUEST_TIMEOUT: 'Conflict identity exceeded the local deadline',
  GATEWAY_RESPONSE_INVALID: 'The complete conflict identity did not match this request or expired',
  GATEWAY_UNAVAILABLE: 'Conflict identity could not be read',
};
function validText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}

export async function readConflictCommandContext(
  transport: WcpTransport,
  original: RequestContext,
  options: WcpConflictCommandContextOptions,
) {
  const context = { ...original };
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, {
      trace_id: trace,
      retryable: false,
    });
  if (
    !validText(trace) ||
    !context.project_id ||
    [context.tenant_id, context.workspace_id, context.project_id].some(
      (id) => !isSyncIdentifier(id) || id === '.' || id === '..',
    ) ||
    (context.actor_id !== undefined && !validText(context.actor_id)) ||
    (context.client_id !== undefined && !validText(context.client_id)) ||
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !['timeout_ms', 'signal'].includes(key))
  )
    throw fail('INVALID_INPUT');
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  const budget = createRequestBudget(
    trace,
    options.timeout_ms === undefined ? 30_000 : options.timeout_ms,
    options.signal,
  );
  try {
    const raw = await budget.wait(() =>
      transport.request({
        method: 'GET',
        path: '/v1/conflicts/commands/context',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: CONFLICT_COMMAND_CONTEXT_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseConflictCommandContextEnvelope(raw, scope, trace);
      if (
        Date.parse(result.data.expires_at) <= Date.now() ||
        (context.actor_id !== undefined && result.data.identity.actor_id !== context.actor_id) ||
        (context.client_id !== undefined && result.data.identity.client_id !== context.client_id)
      )
        throw new TypeError();
    } catch {
      budget.check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    budget.check();
    return result;
  } catch (error) {
    throw fail(
      error instanceof ContractError &&
        error.envelope.trace_id === trace &&
        Object.hasOwn(messages, error.envelope.code)
        ? error.envelope.code
        : 'GATEWAY_UNAVAILABLE',
    );
  } finally {
    budget.close();
  }
}
