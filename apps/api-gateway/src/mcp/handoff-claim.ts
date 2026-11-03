import {
  ContractError,
  parseHandoffClaimBinding,
  parseHandoffClaimEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function isHandoffClaimTool(name: string): boolean {
  return name === 'accept_handoff' || name === 'get_handoff_claim_receipt';
}

export function prepareHandoffClaimTool(
  name: string,
  input: Record<string, unknown>,
  context: RequestContext,
): HttpRequest {
  const lookup = name === 'get_handoff_claim_receipt';
  const fail = (message: string): never => {
    throw new ContractError('INVALID_INPUT', message, { trace_id: context.trace_id });
  };
  if (!isHandoffClaimTool(name)) fail('Unknown handoff claim tool');
  if (context.authenticated_client !== true)
    throw new ContractError(
      'DENIED',
      'A verified client is required for handoff claims and receipts',
      { trace_id: context.trace_id },
    );
  const { handoff_id, expected_identity, idempotency_key, ...fields } = input;
  if (lookup && idempotency_key !== undefined)
    fail('Receipt queries use request_key without write options');
  let binding;
  try {
    binding = parseHandoffClaimBinding(
      handoff_id,
      lookup ? fields : { request_key: idempotency_key, claim: fields },
      expected_identity,
      context,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid original handoff claim');
  }
  if (
    binding.identity.actor_id !== context.actor_id ||
    binding.identity.client_id !== context.client_id
  )
    throw new ContractError(
      'DENIED',
      'Authenticated identity differs from the original handoff claim',
      { trace_id: context.trace_id },
    );
  if (
    !lookup &&
    ((context.idempotency_key !== undefined &&
      context.idempotency_key !== binding.query.request_key) ||
      (context.expected_version !== undefined &&
        context.expected_version !== binding.query.claim.expected_version))
  )
    fail('Original claim key or version disagrees with the request context');
  const clean = { ...context };
  delete clean.idempotency_key;
  delete clean.expected_version;
  if (!lookup) {
    clean.idempotency_key = binding.query.request_key;
    clean.expected_version = binding.query.claim.expected_version;
  }
  return {
    method: 'POST',
    path:
      '/v1/handoffs/' +
      encodeURIComponent(binding.handoff_id) +
      '/claim' +
      (lookup ? '/receipt' : ''),
    body: lookup ? { ...binding.query } : { ...binding.query.claim },
    context: clean,
    headers: {
      'content-type': 'application/json',
      ...(lookup ? {} : { 'idempotency-key': binding.query.request_key }),
    },
  };
}

export function handoffClaimToolResult(name: string, value: unknown, request: HttpRequest) {
  try {
    if (!isHandoffClaimTool(name)) throw new TypeError();
    const lookup = name === 'get_handoff_claim_receipt';
    const match = /^\/v1\/handoffs\/([^/]+)\/claim(?:\/receipt)?$/.exec(request.path);
    if (!match) throw new TypeError();
    const context = request.context;
    const binding = parseHandoffClaimBinding(
      decodeURIComponent(match[1]!),
      lookup
        ? request.body
        : {
            request_key: context.idempotency_key,
            claim: request.body,
          },
      {
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
      },
      context,
    );
    return parseHandoffClaimEnvelope(value, binding, context.trace_id, lookup);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The original claim response could not be confirmed. Retain its identity, version and key, then query the receipt.',
      { trace_id: request.context.trace_id, retryable: true },
    );
  }
}
