import { createHash } from 'node:crypto';
import {
  ContractError,
  CONTEXT_HISTORY_RESPONSE_BYTES,
  CONTEXT_REVISION_RESPONSE_BYTES,
  CONTEXT_HISTORY_ERROR_BYTES,
  contextRevisionSnapshotJson,
  parseContextHistoryReadEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
  type ContextHistoryReadQuery,
  type ContextItemRevision,
} from '@planemem/contracts';
import { readWorkbenchJsonResponse } from './workbench-response';

const messages: Record<string, string> = {
  INVALID_INPUT: 'The history query was rejected. Choose a valid item, version or history page.',
  DENIED: 'Your current session cannot read context history in this project.',
  CONTEXT_ITEM_NOT_FOUND: 'This item or recorded version is unavailable in the selected project.',
  CONTEXT_ITEM_INVALID: 'The saved context history could not be validated.',
  CONTEXT_ITEM_STORAGE_UNAVAILABLE: 'Context history is temporarily unavailable.',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is temporarily unavailable.',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context history read audit could not be persisted.',
  RATE_LIMITED: 'Context history reads are temporarily busy. Retry when ready.',
  GATEWAY_REQUEST_TIMEOUT: 'Context history exceeded the local read deadline. Retry when ready.',
  GATEWAY_RESPONSE_INVALID:
    'The complete history response was invalid, incomplete or exceeded its read limit.',
  GATEWAY_UNAVAILABLE: 'Context history could not be read. Retry when ready.',
};

export function contextHistoryReadFailure(code: string, trace: string) {
  const known = Object.hasOwn(messages, code) ? code : 'GATEWAY_UNAVAILABLE';
  return new ContractError(known, messages[known]!, { trace_id: trace, retryable: false });
}

/** Consume, validate and hash the complete reply within the original fetch deadline. */
export async function readContextHistoryResponse(
  response: Response,
  signal: AbortSignal,
  trace: string,
  deadline: number,
  query: ContextHistoryReadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
) {
  const fail = (code: string) => contextHistoryReadFailure(code, trace);
  const check = () => {
    if (signal.aborted || Date.now() >= deadline) throw fail('GATEWAY_REQUEST_TIMEOUT');
  };
  let value: unknown;
  try {
    check();
    if (
      (response.status !== 200 && (response.status < 400 || response.status > 599)) ||
      response.headers.get('x-trace-id') !== trace ||
      response.headers.has('etag')
    )
      throw new TypeError();
    value = await readWorkbenchJsonResponse(
      response,
      signal,
      query.kind === 'history' ? CONTEXT_HISTORY_RESPONSE_BYTES : CONTEXT_REVISION_RESPONSE_BYTES,
      CONTEXT_HISTORY_ERROR_BYTES,
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
      syncJsonSnapshot(value, CONTEXT_HISTORY_ERROR_BYTES);
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
    const result = parseContextHistoryReadEnvelope(value, query, scope, trace);
    check();
    if (query.kind === 'version') {
      const revision = result.data as ContextItemRevision;
      const hash = createHash('sha256').update(contextRevisionSnapshotJson(revision)).digest('hex');
      if (hash !== revision.snapshot_hash) throw new TypeError();
    }
    check();
    return result;
  } catch {
    check();
    throw fail('GATEWAY_RESPONSE_INVALID');
  }
}
