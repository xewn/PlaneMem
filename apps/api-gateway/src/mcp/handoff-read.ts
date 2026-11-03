import {
  ContractError,
  parseHandoffReadQuery,
  parseHandoffReadEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';

export function handoffReadToolResult(value: unknown, request: HttpRequest) {
  try {
    const { handoff_id } = parseHandoffReadQuery(request.body);
    if (
      request.method !== 'GET' ||
      request.path !== '/v1/handoffs/' + encodeURIComponent(handoff_id)
    )
      throw new TypeError('Invalid handoff read request');
    return parseHandoffReadEnvelope(value, handoff_id, request.context, request.context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested current handoff detail',
      { trace_id: request.context.trace_id },
    );
  }
}
