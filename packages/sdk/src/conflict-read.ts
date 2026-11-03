import {
  ContractError,
  CONFLICT_READ_RESPONSE_BYTES,
  parseConflictReadQuery,
  parseConflictReadEnvelope,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpConflictReadOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply a conflict identifier, project scope and valid timeout/signal options',
  UNAUTHENTICATED: 'The current session must be renewed',
  DENIED: 'The current session cannot read this conflict',
  RATE_LIMITED: 'Conflict reads are temporarily busy',
  CONFLICT_NOT_FOUND: 'Conflict is unavailable in this project',
  CONFLICT_READ_TOO_LARGE:
    'Complete conflict detail exceeds the read limit; no partial values were returned',
  CONFLICT_READ_INVALID: 'Stored conflict detail could not be validated',
  CONFLICT_STORAGE_UNAVAILABLE: 'Conflict detail storage is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The request audit could not be persisted',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for conflict detail',
  GATEWAY_REQUEST_TIMEOUT: 'Conflict detail exceeded the local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete conflict response did not match this request or exceeded its limit',
  GATEWAY_UNAVAILABLE: 'Conflict detail could not be read',
};
export async function readConflict(
  transport: WcpTransport,
  original: RequestContext,
  id: string,
  options: WcpConflictReadOptions,
) {
  const context = { ...original };
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  let query;
  try {
    if (
      !context.project_id ||
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => !['timeout_ms', 'signal'].includes(key))
    )
      throw new TypeError();
    query = parseConflictReadQuery({ conflict_id: id });
  } catch {
    throw fail('INVALID_INPUT');
  }
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id!,
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
        path: '/v1/conflicts/' + encodeURIComponent(query.conflict_id),
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: CONFLICT_READ_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseConflictReadEnvelope(raw, query, scope, trace);
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
