import {
  ContractError,
  parseConflictReceiptQuery,
  parseConflictReceiptEnvelope,
  assertConflictReceiptIdentity,
} from '@planemem/contracts';
import { canReadConflictReceipt } from '../conflict-receipts.js';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';
export function prepareConflictReceiptTool(input: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  if (!canReadConflictReceipt(context))
    throw new ContractError('DENIED', 'A verified unexpired conflict resolver is required', {
      trace_id: context.trace_id,
    });
  let query;
  try {
    query = parseConflictReceiptQuery(input);
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Supply the original identity, request_key and complete command',
      { trace_id: context.trace_id },
    );
  }
  try {
    assertConflictReceiptIdentity(query.identity, context);
  } catch {
    throw new ContractError('DENIED', 'The original conflict identity differs from this session', {
      trace_id: context.trace_id,
    });
  }
  delete context.idempotency_key;
  delete context.expected_version;
  return {
    method: 'POST',
    path: '/v1/conflicts/receipt',
    headers: { 'content-type': 'application/json' },
    body: { ...query },
    context,
  };
}
export function conflictReceiptToolResult(value: unknown, request: HttpRequest) {
  try {
    if (
      request.method !== 'POST' ||
      request.path !== '/v1/conflicts/receipt' ||
      !canReadConflictReceipt(request.context) ||
      request.context.idempotency_key !== undefined ||
      request.context.expected_version !== undefined
    )
      throw new TypeError();
    const query = parseConflictReceiptQuery(request.body);
    assertConflictReceiptIdentity(query.identity, request.context);
    return parseConflictReceiptEnvelope(value, query, request.context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The original conflict receipt could not be confirmed; keep the saved request',
      { trace_id: request.context.trace_id, retryable: false },
    );
  }
}
