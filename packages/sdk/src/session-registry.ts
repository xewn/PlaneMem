import {
  ContractError,
  parseSessionRegistryQuery,
  parseSessionRegistryEnvelope,
  SESSION_REGISTRY_RESPONSE_BYTES,
  type SessionRegistryQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpSessionRegistryOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}

export async function readSessionRegistry(
  transport: WcpTransport,
  original: RequestContext,
  input: SessionRegistryQuery,
  options: WcpSessionRegistryOptions,
) {
  const context = { ...original };
  const trace = context.trace_id;
  const messages: Record<string, string> = {
    INVALID_INPUT: 'Supply valid session filters, project scope and timeout/signal options',
    DENIED: 'The current session cannot read this project registry',
    UNAUTHENTICATED: 'The current session must be renewed',
    RATE_LIMITED: 'Gateway capacity is occupied',
    WORKBENCH_DATABASE_UNAVAILABLE: 'The session registry could not be read',
    SESSION_REGISTRY_INVALID: 'The stored session registry could not be validated',
    AUDIT_PERSISTENCE_UNAVAILABLE: 'The request audit could not be persisted',
    GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the session registry',
    GATEWAY_REQUEST_TIMEOUT: 'The session registry exceeded the local deadline',
    GATEWAY_RESPONSE_INVALID: 'The session registry did not match this request',
    GATEWAY_UNAVAILABLE: 'The session registry request could not be completed',
  };
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
    query = parseSessionRegistryQuery(input);
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
    const result = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/workbench/query',
        body: { operation: 'sessions', ...query },
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: SESSION_REGISTRY_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let envelope;
    try {
      envelope = parseSessionRegistryEnvelope(result, query, scope, trace);
    } catch {
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    budget.check();
    return envelope;
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
