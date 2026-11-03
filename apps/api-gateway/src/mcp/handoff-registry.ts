import {
  ContractError,
  parseHandoffRegistryQuery,
  parseHandoffRegistryEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function prepareHandoffRegistry(raw: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  delete context.idempotency_key;
  delete context.expected_version;
  try {
    return {
      method: 'POST',
      path: '/v1/workbench/query',
      headers: {},
      context,
      body: { operation: 'handoffs', ...parseHandoffRegistryQuery(raw) },
    };
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Supply valid handoff filters and an unchanged continuation cursor',
      { trace_id: context.trace_id },
    );
  }
}
export function handoffRegistryToolResult(value: unknown, request: HttpRequest) {
  try {
    if (
      request.method !== 'POST' ||
      request.path !== '/v1/workbench/query' ||
      request.body?.operation !== 'handoffs'
    )
      throw new TypeError();
    const { operation, ...fields } = request.body;
    return parseHandoffRegistryEnvelope(
      value,
      parseHandoffRegistryQuery(fields),
      request.context,
      request.context.trace_id,
    );
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Handoff registry did not match the requested page',
      { trace_id: request.context.trace_id, retryable: false },
    );
  }
}
