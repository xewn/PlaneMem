import {
  ContractError,
  parseSessionStateQuery,
  parseSessionStateEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';

export function sessionStateToolResult(value: unknown, request: HttpRequest) {
  try {
    const { session_id } = parseSessionStateQuery(request.body);
    if (
      request.method !== 'GET' ||
      request.path !== '/v1/sessions/' + encodeURIComponent(session_id)
    )
      throw new TypeError('Invalid session state request');
    return parseSessionStateEnvelope(value, session_id, request.context, request.context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested current session state',
      { trace_id: request.context.trace_id },
    );
  }
}
