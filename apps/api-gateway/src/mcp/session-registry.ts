import {
  ContractError,
  parseSessionRegistryQuery,
  parseSessionRegistryEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function prepareSessionRegistry(raw: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  delete context.idempotency_key;
  delete context.expected_version;
  try {
    return {
      method: 'POST',
      path: '/v1/workbench/query',
      headers: {},
      context,
      body: { operation: 'sessions', ...parseSessionRegistryQuery(raw) },
    };
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Supply valid session filters and an unchanged continuation cursor',
      { trace_id: context.trace_id },
    );
  }
}

export function sessionRegistryToolResult(value: unknown, request: HttpRequest) {
  try {
    if (
      request.method !== 'POST' ||
      request.path !== '/v1/workbench/query' ||
      request.body?.operation !== 'sessions'
    )
      throw new TypeError();
    const { operation, ...fields } = request.body;
    return parseSessionRegistryEnvelope(
      value,
      parseSessionRegistryQuery(fields),
      request.context,
      request.context.trace_id,
    );
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Session registry did not match the requested page',
      { trace_id: request.context.trace_id, retryable: false },
    );
  }
}
