import {
  ContractError,
  parsePlaneInboxIdentity,
  parsePlaneInboxRetryQuery,
  parsePlaneInboxRetryReceipt,
  parsePlaneInboxRetryLookup,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function isPlaneInboxRetryTool(name: string): boolean {
  return name === 'retry_plane_event' || name === 'get_plane_event_retry_receipt';
}

/** Only adapts the request. API dispatch still runs the normal authorization and durable transaction. */
export function preparePlaneInboxRetryTool(
  name: string,
  input: Record<string, unknown>,
  context: RequestContext,
): HttpRequest {
  const lookup = name === 'get_plane_event_retry_receipt';
  const fail = (message: string): never => {
    throw new ContractError('INVALID_INPUT', message, { trace_id: context.trace_id });
  };
  if (!isPlaneInboxRetryTool(name)) fail('Unknown event retry tool');
  if (context.expected_version !== undefined)
    fail('Use the original decimal-string expected_revision without numeric version headers');
  const { expected_actor_id, expected_client_id, idempotency_key, confirmed, ...fields } = input;
  if (lookup && (idempotency_key !== undefined || confirmed !== undefined))
    fail('Receipt queries accept the original request_key without write options');
  if (!lookup && (confirmed !== true || fields.request_key !== undefined))
    fail(
      'Explicit confirmation and an idempotency_key are required to schedule this original event',
    );
  let query;
  let identity;
  try {
    query = parsePlaneInboxRetryQuery(
      lookup ? fields : { ...fields, request_key: idempotency_key },
    );
    identity = parsePlaneInboxIdentity({
      tenant_id: context.tenant_id,
      workspace_id: context.workspace_id,
      project_id: context.project_id,
      actor_id: expected_actor_id,
      client_id: expected_client_id,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid event retry request');
  }
  if (identity.actor_id !== context.actor_id || identity.client_id !== context.client_id)
    throw new ContractError(
      'DENIED',
      'Authenticated identity changed since the original retry request was prepared',
      { trace_id: context.trace_id },
    );
  if (
    !lookup &&
    context.idempotency_key !== undefined &&
    context.idempotency_key !== query.request_key
  )
    fail('Idempotency keys disagree');
  const nextContext = { ...context };
  delete nextContext.idempotency_key;
  delete nextContext.expected_version;
  if (!lookup) nextContext.idempotency_key = query.request_key;
  return {
    method: 'POST',
    path:
      '/v1/plane/events/' +
      encodeURIComponent(query.event_id) +
      '/retry' +
      (lookup ? '/receipt' : ''),
    body: { ...query },
    context: nextContext,
    headers: {
      'content-type': 'application/json',
      ...(lookup ? {} : { 'idempotency-key': query.request_key }),
    },
  };
}

/** Reject malformed success responses without treating an unconfirmed write as failed. */
export function planeInboxRetryToolResult(name: string, value: unknown, request: HttpRequest) {
  try {
    if (!isPlaneInboxRetryTool(name) || !value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    const envelope = value as Record<string, unknown>;
    if (
      envelope.schema_version !== 1 ||
      envelope.trace_id !== request.context.trace_id ||
      !Array.isArray(envelope.source_refs) ||
      envelope.source_refs.length !== 0
    )
      throw new Error();
    const { request_key, ...command } = parsePlaneInboxRetryQuery(request.body);
    const identity = parsePlaneInboxIdentity({
      tenant_id: request.context.tenant_id,
      workspace_id: request.context.workspace_id,
      project_id: request.context.project_id,
      actor_id: request.context.actor_id,
      client_id: request.context.client_id,
    });
    const data =
      name === 'get_plane_event_retry_receipt'
        ? parsePlaneInboxRetryLookup(envelope.data, command, identity, request_key)
        : parsePlaneInboxRetryReceipt(envelope.data, command, identity, request_key);
    return { ...envelope, data };
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The original retry response could not be confirmed; retain the original request and query its receipt',
      { trace_id: request.context.trace_id, retryable: true },
    );
  }
}
