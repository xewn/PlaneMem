import {
  ContractError,
  parseConflictRegistryQuery,
  parseConflictRegistryEnvelope,
  CONFLICT_REGISTRY_RESPONSE_BYTES,
  type ConflictRegistryQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';
export interface WcpConflictRegistryOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply valid conflict filters, scope and timeout/signal options; restart pagination when filters change',
  DENIED: 'The current session cannot read conflicts in this project',
  UNAUTHENTICATED: 'The current session must be renewed',
  NOT_FOUND: 'Project is unavailable in the readable scope',
  RATE_LIMITED: 'Conflict reads are temporarily busy',
  CONFLICT_REGISTRY_INVALID: 'Stored conflict metadata could not be validated',
  WORKBENCH_DATABASE_UNAVAILABLE: 'Conflict directory storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The request audit could not be persisted',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the conflict directory',
  GATEWAY_REQUEST_TIMEOUT: 'The conflict directory exceeded the local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete conflict directory did not match this request or exceeded its limit',
  GATEWAY_UNAVAILABLE: 'The conflict directory could not be read',
};
export async function readConflictRegistry(
  transport: WcpTransport,
  original: RequestContext,
  input: ConflictRegistryQuery,
  options: WcpConflictRegistryOptions,
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
    query = parseConflictRegistryQuery(input);
  } catch {
    throw fail('INVALID_INPUT');
  }
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id!,
  };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) search.set(key, String(value));
  const path = '/v1/conflicts' + (search.size ? '?' + search.toString() : '');
  const budget = createRequestBudget(
    trace,
    options.timeout_ms === undefined ? 30_000 : options.timeout_ms,
    options.signal,
  );
  try {
    const raw = await budget.wait(() =>
      transport.request({
        method: 'GET',
        path,
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: CONFLICT_REGISTRY_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseConflictRegistryEnvelope(raw, query, scope, trace);
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
