import {
  ContractError,
  parseWorkbenchAdminEnvelope,
  WORKBENCH_ADMIN_RESPONSE_BYTES,
  type RequestContext,
  type WorkbenchAdminEnvelope,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpAdminOptions {
  /** Local wait, including custom transport and validation. Defaults to 30 seconds. */
  timeout_ms?: number;
  signal?: AbortSignal;
}

const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply a project scope and only timeout_ms or signal options',
  DENIED: 'The current session cannot read this administration snapshot',
  UNAUTHENTICATED: 'The current session must be renewed',
  NOT_FOUND: 'The project is not available in the readable scope',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  WORKBENCH_DATABASE_UNAVAILABLE: 'The project snapshot could not be read',
  WORKBENCH_ADMIN_INVALID: 'The stored administration snapshot could not be validated',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The request audit could not be persisted',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the administration snapshot',
  GATEWAY_REQUEST_TIMEOUT: 'The administration snapshot exceeded the local deadline',
  GATEWAY_RESPONSE_INVALID: 'The administration snapshot did not match the request',
  GATEWAY_UNAVAILABLE: 'The administration request could not be completed',
};

/** A validated observation in the configured project, never a global readiness assertion. */
export async function readAdminSnapshot(
  transport: WcpTransport,
  source: RequestContext,
  options: WcpAdminOptions,
): Promise<WorkbenchAdminEnvelope> {
  const context = { ...source };
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  if (
    !context.project_id ||
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== 'timeout_ms' && key !== 'signal')
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
    const response = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/workbench/query',
        body: { operation: 'admin' },
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: WORKBENCH_ADMIN_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseWorkbenchAdminEnvelope(response, scope, trace);
    } catch {
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    budget.check();
    return result;
  } catch (error) {
    const code =
      error instanceof ContractError &&
      error.envelope.trace_id === trace &&
      Object.hasOwn(messages, error.envelope.code)
        ? error.envelope.code
        : 'GATEWAY_UNAVAILABLE';
    throw fail(code);
  } finally {
    budget.close();
  }
}
