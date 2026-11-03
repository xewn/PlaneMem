import {
  ContractError,
  parseResumeBinding,
  parseResumeCommand,
  parseResumeEnvelope,
  parseResumeReceiptEnvelope,
} from '@planemem/contracts';
import type { RequestContext } from '../router.js';
import type { HttpRequest } from '../http.js';
export function isResumeTool(name: string): boolean {
  return name === 'resume_session' || name === 'get_resume_receipt';
}
export function prepareResumeTool(
  name: string,
  input: Record<string, unknown>,
  context: RequestContext,
): HttpRequest {
  if (context.authenticated_client !== true)
    throw new ContractError(
      'DENIED',
      'A verified client is required for resume commands and receipts',
      { trace_id: context.trace_id },
    );
  const lookup = name === 'get_resume_receipt';
  let binding;
  let originalKey: unknown;
  try {
    if (!isResumeTool(name)) throw new TypeError('Unknown resume tool');
    const { session_id, expected_identity, expected_checkpoint_id, idempotency_key, ...fields } =
      input;
    originalKey = idempotency_key;
    if (lookup && idempotency_key !== undefined)
      throw new TypeError('Resume receipt queries use request_key');
    binding = parseResumeBinding(
      session_id,
      lookup ? fields : { ...parseResumeCommand(fields), request_key: idempotency_key },
      expected_identity,
      context,
      expected_checkpoint_id,
    );
    if (
      !lookup &&
      (context.expected_version !== undefined ||
        (context.idempotency_key !== undefined &&
          context.idempotency_key !== binding.query.request_key))
    )
      throw new TypeError(
        'Resume requires its original request key without a version precondition',
      );
    if (
      context.client_id === (process.env.AUTH_SERVER_CLIENT_ID ?? 'PlaneMem_WebConsole') &&
      !binding.query.require_claimed
    )
      throw new TypeError('This client requires the original effective require_claimed=true');
  } catch (error) {
    throw new ContractError(
      'INVALID_INPUT',
      error instanceof Error ? error.message : 'Invalid original resume',
      { trace_id: context.trace_id },
    );
  }
  if (
    context.actor_id !== binding.identity.actor_id ||
    context.client_id !== binding.identity.client_id
  )
    throw new ContractError('DENIED', 'Authenticated identity differs from the original resume', {
      trace_id: context.trace_id,
    });
  const { idempotency_key: _key, expected_version: _version, ...identityContext } = context;
  const { request_key, ...command } = binding.query;
  return {
    method: 'POST',
    path:
      '/v1/sessions/' +
      encodeURIComponent(binding.parent_session_id) +
      '/resume' +
      (lookup ? '/receipt' : ''),
    body: {
      session_id: binding.parent_session_id,
      ...(lookup
        ? binding.query
        : { ...command, ...(originalKey === undefined ? {} : { idempotency_key: request_key }) }),
    },
    context: { ...identityContext, ...(lookup ? {} : { idempotency_key: request_key }) },
    headers: {
      'content-type': 'application/json',
      ...(lookup ? {} : { 'idempotency-key': request_key }),
    },
  };
}
export function resumeToolResult(
  name: string,
  value: unknown,
  request: HttpRequest,
  expectedCheckpointId?: unknown,
) {
  try {
    if (!isResumeTool(name) || request.method !== 'POST' || !request.body) throw new TypeError();
    const lookup = name === 'get_resume_receipt';
    const { session_id, idempotency_key: _key, ...fields } = request.body;
    const context = request.context;
    const binding = parseResumeBinding(
      session_id,
      lookup ? fields : { ...parseResumeCommand(fields), request_key: context.idempotency_key },
      {
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
      },
      context,
      expectedCheckpointId,
    );
    if (
      request.path !==
      '/v1/sessions/' +
        encodeURIComponent(binding.parent_session_id) +
        '/resume' +
        (lookup ? '/receipt' : '')
    )
      throw new TypeError();
    return lookup
      ? parseResumeReceiptEnvelope(value, binding, context.trace_id)
      : parseResumeEnvelope(value, binding, context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The resume response could not be confirmed. Keep the original identity, parent, handoff, checkpoint expectation, ownership requirement and key, then query its receipt.',
      { trace_id: request.context.trace_id, retryable: true },
    );
  }
}
