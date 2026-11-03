import {
  ContractError,
  conflictReceiptJson,
  parseConflictCommandContextEnvelope,
  CONFLICT_COMMAND_CONTEXT_BYTES,
} from '@planemem/contracts';
import { conflictCommandContextData } from '../conflict-command-context.js';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function prepareConflictCommandContext(raw: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  conflictCommandContextData(context);
  try {
    conflictReceiptJson(raw, CONFLICT_COMMAND_CONTEXT_BYTES);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)
      throw new TypeError();
  } catch {
    throw new ContractError('INVALID_INPUT', 'Conflict command context accepts no arguments', {
      trace_id: context.trace_id,
    });
  }
  delete context.idempotency_key;
  delete context.expected_version;
  return { method: 'GET', path: '/v1/conflicts/commands/context', headers: {}, context };
}
export function conflictCommandContextToolResult(value: unknown, request: HttpRequest) {
  try {
    if (
      request.method !== 'GET' ||
      request.path !== '/v1/conflicts/commands/context' ||
      request.body !== undefined ||
      Object.keys(request.headers).length ||
      request.context.idempotency_key !== undefined ||
      request.context.expected_version !== undefined
    )
      throw new TypeError();
    const expected = conflictCommandContextData(request.context);
    const result = parseConflictCommandContextEnvelope(
      value,
      request.context,
      request.context.trace_id,
      expected.identity,
    );
    if (result.data.expires_at !== expected.expires_at) throw new TypeError();
    conflictCommandContextData(request.context);
    return result;
  } catch (error) {
    if (error instanceof ContractError && error.envelope.code === 'DENIED') throw error;
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Conflict identity did not match verified authority; keep the saved original request',
      {
        trace_id: request.context.trace_id,
        retryable: false,
      },
    );
  }
}
