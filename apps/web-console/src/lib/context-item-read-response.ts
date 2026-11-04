import {
  ContractError,
  CONTEXT_ITEM_READ_RESPONSE_BYTES,
  CONTEXT_ITEM_READ_ERROR_BYTES,
  parseContextItemReadEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
  type ContextItemReadQuery,
} from '@planemem/contracts';
import { readWorkbenchJsonResponse } from './workbench-response';

const messages: Record<string, string> = {
  INVALID_INPUT: 'Choose a valid current or archived context item.',
  DENIED: 'Your current session cannot read this context item in this project.',
  CONTEXT_ITEM_NOT_FOUND: 'This context item is unavailable in the selected view and project.',
  CONTEXT_ITEM_INVALID: 'The saved context item could not be validated.',
  CONTEXT_ITEM_STORAGE_UNAVAILABLE: 'Context item storage is temporarily unavailable.',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is temporarily unavailable.',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context item read audit could not be persisted.',
  RATE_LIMITED: 'Context item reads are temporarily busy. Retry when ready.',
  GATEWAY_REQUEST_TIMEOUT:
    'Context item details exceeded the local read deadline. Retry when ready.',
  GATEWAY_RESPONSE_INVALID:
    'The complete context item response was invalid, incomplete or exceeded its read limit.',
  GATEWAY_UNAVAILABLE: 'Context item details could not be read. Retry when ready.',
};

export function contextItemReadFailure(code: string, trace: string) {
  const known = Object.hasOwn(messages, code) ? code : 'GATEWAY_UNAVAILABLE';
  return new ContractError(known, messages[known]!, { trace_id: trace, retryable: false });
}

/** The original fetch budget includes bytes, full document validation and ETag matching. */
export async function readContextItemResponse(
  response: Response,
  signal: AbortSignal,
  trace: string,
  deadline: number,
  query: ContextItemReadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
) {
  const fail = (code: string) => contextItemReadFailure(code, trace);
  const check = () => {
    if (signal.aborted || Date.now() >= deadline) throw fail('GATEWAY_REQUEST_TIMEOUT');
  };
  let value: unknown;
  try {
    check();
    if (
      (response.status !== 200 && (response.status < 400 || response.status > 599)) ||
      response.headers.get('x-trace-id') !== trace ||
      (!response.ok && response.headers.has('etag'))
    )
      throw new TypeError();
    value = await readWorkbenchJsonResponse(
      response,
      signal,
      CONTEXT_ITEM_READ_RESPONSE_BYTES,
      CONTEXT_ITEM_READ_ERROR_BYTES,
    );
  } catch {
    void response.body?.cancel().catch(() => undefined);
    check();
    throw fail('GATEWAY_RESPONSE_INVALID');
  }
  check();
  if (!response.ok) {
    let code: string;
    try {
      syncJsonSnapshot(value, CONTEXT_ITEM_READ_ERROR_BYTES);
      const error = validateErrorEnvelope(value);
      if (error.trace_id !== trace) throw new TypeError();
      code = error.code;
    } catch {
      check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    check();
    throw fail(code);
  }
  try {
    const result = parseContextItemReadEnvelope(value, query, scope, trace);
    if (response.headers.get('etag') !== result.etag) throw new TypeError();
    check();
    return result;
  } catch {
    check();
    throw fail('GATEWAY_RESPONSE_INVALID');
  }
}
