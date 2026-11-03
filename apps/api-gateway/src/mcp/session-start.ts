import {
  ContractError,
  parseSessionStartBinding,
  parseSessionStartEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function isSessionStartTool(name: string): boolean {
  return name === 'start_session' || name === 'get_session_start_receipt';
}
export function prepareSessionStartTool(
  name: string,
  input: Record<string, unknown>,
  context: RequestContext,
): HttpRequest {
  const lookup = name === 'get_session_start_receipt';
  const fail = (message: string): never => {
    throw new ContractError('INVALID_INPUT', message, { trace_id: context.trace_id });
  };
  if (!isSessionStartTool(name)) fail('Unknown session start tool');
  if (context.authenticated_client !== true)
    throw new ContractError(
      'DENIED',
      'A verified client is required for session start and receipts',
      { trace_id: context.trace_id },
    );
  const { expected_identity, idempotency_key, ...fields } = input;
  if (lookup && idempotency_key !== undefined)
    fail('Start receipt queries use request_key without write options');
  let binding;
  try {
    binding = parseSessionStartBinding(
      lookup ? fields : { request_key: idempotency_key, session: fields },
      expected_identity,
      context,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid original session start');
  }
  if (
    binding.identity.actor_id !== context.actor_id ||
    binding.identity.client_id !== context.client_id
  )
    throw new ContractError(
      'DENIED',
      'Authenticated identity differs from the original session start',
      { trace_id: context.trace_id },
    );
  if (
    !lookup &&
    (context.expected_version !== undefined ||
      (context.idempotency_key !== undefined &&
        context.idempotency_key !== binding.query.request_key))
  )
    fail('Session start uses the original key without a version precondition');
  const clean = { ...context };
  delete clean.idempotency_key;
  delete clean.expected_version;
  if (!lookup) clean.idempotency_key = binding.query.request_key;
  return {
    method: 'POST',
    path: lookup ? '/v1/sessions/start/receipt' : '/v1/sessions',
    body: lookup ? { ...binding.query } : { ...binding.query.session },
    context: clean,
    headers: {
      'content-type': 'application/json',
      ...(lookup ? {} : { 'idempotency-key': binding.query.request_key }),
    },
  };
}
export function sessionStartToolResult(name: string, value: unknown, request: HttpRequest) {
  try {
    if (!isSessionStartTool(name)) throw new TypeError();
    const lookup = name === 'get_session_start_receipt';
    if (
      request.method !== 'POST' ||
      request.path !== (lookup ? '/v1/sessions/start/receipt' : '/v1/sessions')
    )
      throw new TypeError();
    const context = request.context;
    const binding = parseSessionStartBinding(
      lookup ? request.body : { request_key: context.idempotency_key, session: request.body },
      {
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
      },
      context,
    );
    return parseSessionStartEnvelope(value, binding, context.trace_id, lookup);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The start response could not be confirmed. Keep the original identity, parameters and key, then query its receipt.',
      { trace_id: request.context.trace_id, retryable: true },
    );
  }
}
