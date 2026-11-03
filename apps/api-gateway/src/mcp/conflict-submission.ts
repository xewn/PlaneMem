import {
  ContractError,
  buildEtag,
  parseConflictReceiptQuery,
  assertConflictReceiptIdentity,
  parseConflictSubmissionResponse,
  type ConflictReceiptQuery,
} from '@planemem/contracts';
import { canReadConflictReceipt } from '../conflict-receipts.js';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function prepareOriginalConflictTool(
  input: Record<string, unknown>,
  originalContext: RequestContext,
): HttpRequest {
  const context = structuredClone(originalContext);
  if (!canReadConflictReceipt(context))
    throw new ContractError(
      'DENIED',
      'A verified unexpired conflict resolver is required; keep the saved original request',
      { trace_id: context.trace_id },
    );
  let original: ConflictReceiptQuery;
  try {
    if (
      input.reviewed !== true ||
      Object.keys(input).some((key) => !['original', 'reviewed'].includes(key))
    )
      throw new TypeError();
    original = parseConflictReceiptQuery(input.original);
    if (
      (context.idempotency_key !== undefined && context.idempotency_key !== original.request_key) ||
      (context.expected_version !== undefined &&
        context.expected_version !== original.command.expected_version)
    )
      throw new TypeError();
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Supply the complete saved original request and reviewed=true; outer write conditions must match it',
      { trace_id: context.trace_id },
    );
  }
  try {
    assertConflictReceiptIdentity(original.identity, context);
  } catch {
    throw new ContractError(
      'DENIED',
      'The saved original identity differs from the verified account, client or project',
      { trace_id: context.trace_id },
    );
  }
  return {
    method: 'POST',
    path: '/v1/conflicts/' + encodeURIComponent(original.command.conflict_id) + '/resolve',
    body: original.command,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': original.request_key,
      'if-match': buildEtag(original.command.expected_version),
      'x-expected-actor-id': original.identity.actor_id,
      'x-expected-client-id': original.identity.client_id,
    },
    context: {
      ...context,
      idempotency_key: original.request_key,
      expected_version: original.command.expected_version,
    },
  };
}

export function originalConflictToolResult(value: unknown, request: HttpRequest) {
  try {
    if (!canReadConflictReceipt(request.context))
      throw new ContractError(
        'DENIED',
        'The original authority expired; keep the request and check its receipt after renewing access',
        { trace_id: request.context.trace_id },
      );
    const original = parseConflictReceiptQuery({
      identity: {
        tenant_id: request.context.tenant_id,
        workspace_id: request.context.workspace_id,
        project_id: request.context.project_id,
        actor_id: request.context.actor_id,
        client_id: request.context.client_id,
      },
      request_key: request.context.idempotency_key,
      command: request.body,
    });
    const expectedHeaders: Record<string, string> = {
      'content-type': 'application/json',
      'idempotency-key': original.request_key,
      'if-match': buildEtag(original.command.expected_version),
      'x-expected-actor-id': original.identity.actor_id,
      'x-expected-client-id': original.identity.client_id,
    };
    if (
      request.method !== 'POST' ||
      request.path !==
        '/v1/conflicts/' + encodeURIComponent(original.command.conflict_id) + '/resolve' ||
      request.context.expected_version !== original.command.expected_version ||
      Object.keys(request.headers).length !== 5 ||
      Object.entries(expectedHeaders).some(([key, value]) => request.headers[key] !== value)
    )
      throw new TypeError();
    const result = parseConflictSubmissionResponse(value, original, request.context.trace_id);
    if (!canReadConflictReceipt(request.context)) throw new TypeError();
    return result;
  } catch (error) {
    if (error instanceof ContractError && error.envelope.code === 'DENIED') throw error;
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The complete decision response could not be validated; keep the original request and explicitly check its receipt',
      {
        trace_id: request.context.trace_id,
        retryable: false,
      },
    );
  }
}
