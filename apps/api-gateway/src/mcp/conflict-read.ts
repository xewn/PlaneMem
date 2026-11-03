import {
  ContractError,
  parseConflictReadQuery,
  parseConflictReadEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function prepareConflictReadTool(input: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  delete context.idempotency_key;
  delete context.expected_version;
  try {
    const query = parseConflictReadQuery(input);
    return {
      method: 'GET',
      path: '/v1/conflicts/' + encodeURIComponent(query.conflict_id),
      headers: {},
      body: { ...query },
      context,
    };
  } catch {
    throw new ContractError('INVALID_INPUT', 'Supply only conflict_id', {
      trace_id: context.trace_id,
      retryable: false,
    });
  }
}
export function conflictReadToolResult(value: unknown, request: HttpRequest) {
  try {
    const query = parseConflictReadQuery(request.body);
    if (
      request.method !== 'GET' ||
      request.path !== '/v1/conflicts/' + encodeURIComponent(query.conflict_id)
    )
      throw new TypeError();
    return parseConflictReadEnvelope(value, query, request.context, request.context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the complete requested conflict detail',
      { trace_id: request.context.trace_id, retryable: false },
    );
  }
}
