import {
  ContractError,
  parseHandoffCreateBinding,
  parseHandoffCreateEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function isHandoffCreateTool(name: string): boolean {
  return name === 'create_handoff' || name === 'get_handoff_create_receipt';
}
export function prepareHandoffCreateTool(
  name: string,
  input: Record<string, unknown>,
  context: RequestContext,
): HttpRequest {
  const lookup = name === 'get_handoff_create_receipt';
  const fail = (message: string): never => {
    throw new ContractError('INVALID_INPUT', message, { trace_id: context.trace_id });
  };
  if (!isHandoffCreateTool(name)) fail('Unknown handoff creation tool');
  if (context.authenticated_client !== true)
    throw new ContractError(
      'DENIED',
      'A verified client is required for handoff creation and receipts',
      { trace_id: context.trace_id },
    );
  const { session_id, expected_identity, idempotency_key, ...fields } = input;
  if (lookup && idempotency_key !== undefined)
    fail('Creation receipt queries use request_key without write options');
  let binding;
  try {
    binding = parseHandoffCreateBinding(
      session_id,
      lookup ? fields : { request_key: idempotency_key, handoff: fields },
      expected_identity,
      context,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid original handoff creation');
  }
  if (
    binding.identity.actor_id !== context.actor_id ||
    binding.identity.client_id !== context.client_id
  )
    throw new ContractError(
      'DENIED',
      'Authenticated identity differs from the original handoff creation',
      { trace_id: context.trace_id },
    );
  if (
    !lookup &&
    (context.expected_version !== undefined ||
      (context.idempotency_key !== undefined &&
        context.idempotency_key !== binding.query.request_key))
  )
    fail('Creation uses the original key without a version precondition');
  const clean = { ...context };
  delete clean.idempotency_key;
  delete clean.expected_version;
  if (!lookup) clean.idempotency_key = binding.query.request_key;
  return {
    method: 'POST',
    path:
      '/v1/sessions/' +
      encodeURIComponent(binding.session_id) +
      '/handoff' +
      (lookup ? '/receipt' : ''),
    body: lookup ? { ...binding.query } : { ...binding.query.handoff },
    context: clean,
    headers: {
      'content-type': 'application/json',
      ...(lookup ? {} : { 'idempotency-key': binding.query.request_key }),
    },
  };
}
export function handoffCreateToolResult(name: string, value: unknown, request: HttpRequest) {
  try {
    if (!isHandoffCreateTool(name)) throw new TypeError();
    const lookup = name === 'get_handoff_create_receipt';
    const match = /^\/v1\/sessions\/([^/]+)\/handoff(\/receipt)?$/.exec(request.path);
    if (!match || !!match[2] !== lookup) throw new TypeError();
    const context = request.context;
    const binding = parseHandoffCreateBinding(
      decodeURIComponent(match[1]!),
      lookup ? request.body : { request_key: context.idempotency_key, handoff: request.body },
      {
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
      },
      context,
    );
    return parseHandoffCreateEnvelope(value, binding, context.trace_id, lookup);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The creation response could not be confirmed. Keep the original identity, checkpoint, target and key, then query its receipt.',
      { trace_id: request.context.trace_id, retryable: true },
    );
  }
}
