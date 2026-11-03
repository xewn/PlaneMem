import { ContractError, parseSessionCommandContextEnvelope } from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';
import { sessionCommandContextData } from '../session-command-context.js';

export function prepareSessionCommandContext(raw: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  sessionCommandContextData(context);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)
    throw new ContractError('INVALID_INPUT', 'Session command context accepts no arguments', {
      trace_id: context.trace_id,
    });
  delete context.idempotency_key;
  delete context.expected_version;
  return { method: 'GET', path: '/v1/sessions/command-context', headers: {}, context };
}
export function sessionCommandContextToolResult(value: unknown, request: HttpRequest) {
  try {
    if (
      request.method !== 'GET' ||
      request.path !== '/v1/sessions/command-context' ||
      request.body !== undefined ||
      Object.keys(request.headers).length ||
      request.context.idempotency_key !== undefined ||
      request.context.expected_version !== undefined
    )
      throw new TypeError();
    const expected = sessionCommandContextData(request.context);
    const result = parseSessionCommandContextEnvelope(
      value,
      request.context,
      request.context.trace_id,
      expected,
    );
    sessionCommandContextData(request.context);
    return result;
  } catch (error) {
    if (error instanceof ContractError && error.envelope.code === 'DENIED') throw error;
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Caller context did not match verified identity and permissions',
      { trace_id: request.context.trace_id, retryable: false },
    );
  }
}
