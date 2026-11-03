import {
  ContractError,
  parseSessionCommandContextEnvelope,
  SESSION_COMMAND_CONTEXT_BYTES,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpSessionCommandContextOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply a project scope and valid timeout/signal options',
  DENIED: 'A verified client with session read, write or claim access is required',
  UNAUTHENTICATED: 'Renew the current session to read its identity',
  RATE_LIMITED: 'Gateway capacity is occupied',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The request audit could not be persisted',
  SESSION_COMMAND_CONTEXT_INVALID: 'The verified caller context could not be represented',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the caller context',
  GATEWAY_REQUEST_TIMEOUT: 'The caller context exceeded the local deadline',
  GATEWAY_RESPONSE_INVALID: 'The caller context did not match this request or expired',
  GATEWAY_UNAVAILABLE: 'The caller context could not be read',
};
export async function readSessionCommandContext(
  transport: WcpTransport,
  original: RequestContext,
  options: WcpSessionCommandContextOptions,
) {
  const context = { ...original };
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  if (
    !context.project_id ||
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((field) => !['timeout_ms', 'signal'].includes(field))
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
        path: '/v1/sessions/command-context',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: SESSION_COMMAND_CONTEXT_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseSessionCommandContextEnvelope(raw, scope, trace);
      if (
        Date.parse(result.data.expires_at) <= Date.now() ||
        (context.actor_id !== undefined && result.data.identity.actor_id !== context.actor_id) ||
        (context.client_id !== undefined && result.data.identity.client_id !== context.client_id)
      )
        throw new TypeError();
    } catch {
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
