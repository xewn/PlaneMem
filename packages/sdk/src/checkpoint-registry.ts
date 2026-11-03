import {
  ContractError,
  parseCheckpointRegistryQuery,
  parseCheckpointRegistryEnvelope,
  CHECKPOINT_REGISTRY_RESPONSE_BYTES,
  type CheckpointRegistryQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpCheckpointRegistryOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply valid checkpoint filters, project scope and timeout/signal options; restart pagination when filters change',
  DENIED: 'The current session cannot read this project checkpoint registry',
  UNAUTHENTICATED: 'The current session must be renewed',
  RATE_LIMITED: 'Gateway capacity is occupied',
  WORKBENCH_DATABASE_UNAVAILABLE: 'The checkpoint registry could not be read',
  CHECKPOINT_REGISTRY_INVALID: 'The stored checkpoint registry could not be validated',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The request audit could not be persisted',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the checkpoint registry',
  GATEWAY_REQUEST_TIMEOUT: 'The checkpoint registry exceeded the local deadline',
  GATEWAY_RESPONSE_INVALID: 'The checkpoint registry did not match this request',
  GATEWAY_UNAVAILABLE: 'The checkpoint registry request could not be completed',
};

export async function readCheckpointRegistry(
  transport: WcpTransport,
  original: RequestContext,
  input: CheckpointRegistryQuery,
  options: WcpCheckpointRegistryOptions,
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
    query = parseCheckpointRegistryQuery(input);
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
    const value = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/workbench/query',
        body: { operation: 'checkpoints', ...query },
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: CHECKPOINT_REGISTRY_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseCheckpointRegistryEnvelope(value, query, scope, trace);
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
