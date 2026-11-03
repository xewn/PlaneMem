import {
  ContractError,
  buildEtag,
  parseCheckpointBinding,
  parseCheckpointSaveCommand,
  parseCheckpointSaveEnvelope,
  parseCheckpointReceiptEnvelope,
  parseCheckpointReadQuery,
  parseCheckpointReadEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function isCheckpointTool(name: string): boolean {
  return name === 'record_checkpoint' || name === 'get_checkpoint_receipt';
}
export function checkpointReadToolResult(value: unknown, request: HttpRequest) {
  try {
    const query = parseCheckpointReadQuery(request.body);
    if (
      request.method !== 'GET' ||
      request.path !==
        '/v1/sessions/' +
          encodeURIComponent(query.session_id) +
          '/checkpoints/' +
          encodeURIComponent(query.checkpoint_id)
    )
      throw new TypeError();
    return parseCheckpointReadEnvelope(value, query, request.context, request.context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested historical checkpoint detail',
      { trace_id: request.context.trace_id },
    );
  }
}
export function prepareCheckpointTool(
  name: string,
  input: Record<string, unknown>,
  context: RequestContext,
): HttpRequest {
  if (context.authenticated_client !== true)
    throw new ContractError(
      'DENIED',
      'A verified client is required for checkpoint commands and receipts',
      { trace_id: context.trace_id },
    );
  const lookup = name === 'get_checkpoint_receipt';
  let binding;
  try {
    if (!isCheckpointTool(name)) throw new TypeError('Unknown checkpoint tool');
    const { expected_identity, ...fields } = input;
    const { session_id, ...query } = fields;
    if (lookup && fields.idempotency_key !== undefined)
      throw new TypeError('Receipt queries use the original request_key');
    binding = parseCheckpointBinding(
      session_id,
      lookup
        ? query
        : {
            request_key: fields.idempotency_key,
            checkpoint: parseCheckpointSaveCommand(fields),
          },
      expected_identity,
      context,
    );
    if (
      !lookup &&
      ((context.idempotency_key !== undefined &&
        context.idempotency_key !== binding.query.request_key) ||
        (context.expected_version !== undefined &&
          context.expected_version !== binding.query.checkpoint.expected_version))
    )
      throw new TypeError('Original checkpoint key or version differs from the request context');
  } catch (error) {
    throw new ContractError(
      'INVALID_INPUT',
      error instanceof Error ? error.message : 'Invalid original checkpoint',
      { trace_id: context.trace_id },
    );
  }
  if (
    context.actor_id !== binding.identity.actor_id ||
    context.client_id !== binding.identity.client_id
  )
    throw new ContractError(
      'DENIED',
      'Authenticated identity differs from the original checkpoint',
      { trace_id: context.trace_id },
    );
  const { idempotency_key: _key, expected_version: _version, ...readContext } = context;
  return {
    method: 'POST',
    path:
      '/v1/sessions/' +
      encodeURIComponent(binding.session_id) +
      '/checkpoint' +
      (lookup ? '/receipt' : ''),
    body: lookup
      ? { session_id: binding.session_id, ...binding.query }
      : { ...binding.query.checkpoint },
    context: {
      ...readContext,
      ...(lookup
        ? {}
        : {
            idempotency_key: binding.query.request_key,
            expected_version: binding.query.checkpoint.expected_version,
          }),
    },
    headers: {
      'content-type': 'application/json',
      ...(lookup
        ? {}
        : {
            'idempotency-key': binding.query.request_key,
            'if-match': buildEtag(binding.query.checkpoint.expected_version),
          }),
    },
  };
}
export function checkpointToolResult(name: string, value: unknown, request: HttpRequest) {
  try {
    if (!isCheckpointTool(name) || request.method !== 'POST' || !request.body)
      throw new TypeError();
    const lookup = name === 'get_checkpoint_receipt';
    const { session_id, ...query } = request.body;
    const context = request.context;
    const binding = parseCheckpointBinding(
      session_id,
      lookup
        ? query
        : {
            request_key: context.idempotency_key,
            checkpoint: request.body,
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
    if (
      request.path !==
      '/v1/sessions/' +
        encodeURIComponent(binding.session_id) +
        '/checkpoint' +
        (lookup ? '/receipt' : '')
    )
      throw new TypeError();
    return lookup
      ? parseCheckpointReceiptEnvelope(value, binding, context.trace_id)
      : parseCheckpointSaveEnvelope(value, binding, context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The checkpoint response could not be confirmed. Keep the original identity, notes, references, version and key, then query its receipt.',
      { trace_id: request.context.trace_id, retryable: true },
    );
  }
}
