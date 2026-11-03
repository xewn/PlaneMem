import {
  ContractError,
  parseCheckpointRegistryQuery,
  parseCheckpointRegistryEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function prepareCheckpointRegistry(raw: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  delete context.idempotency_key;
  delete context.expected_version;
  try {
    return {
      method: 'POST',
      path: '/v1/workbench/query',
      headers: {},
      context,
      body: { operation: 'checkpoints', ...parseCheckpointRegistryQuery(raw) },
    };
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Supply valid checkpoint filters and an unchanged continuation cursor',
      { trace_id: context.trace_id },
    );
  }
}
export function checkpointRegistryToolResult(value: unknown, request: HttpRequest) {
  try {
    if (
      request.method !== 'POST' ||
      request.path !== '/v1/workbench/query' ||
      request.body?.operation !== 'checkpoints'
    )
      throw new TypeError();
    const { operation, ...fields } = request.body;
    return parseCheckpointRegistryEnvelope(
      value,
      parseCheckpointRegistryQuery(fields),
      request.context,
      request.context.trace_id,
    );
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Checkpoint registry did not match the requested page',
      { trace_id: request.context.trace_id, retryable: false },
    );
  }
}
