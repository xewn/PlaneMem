import { createHash } from 'node:crypto';
import {
  ContractError,
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  CONTEXT_PACK_READ_ERROR_BYTES,
  parseContextPackReadEnvelope,
  contextPackReadHashJson,
  syncJsonSnapshot,
  validateErrorEnvelope,
  type ContextPackReadQuery,
} from '@planemem/contracts';
import { readWorkbenchJsonResponse } from './workbench-response';

const messages: Record<string, string> = {
  INVALID_INPUT: 'Choose a valid saved context pack.',
  DENIED: 'Your current session cannot read this context pack in this project.',
  CONTEXT_PACK_NOT_FOUND: 'No saved context pack is available for this selection and project.',
  CONTEXT_PACK_STALE:
    'The saved pack sources changed. Review current knowledge and prepare a fresh pack.',
  CONTEXT_PACK_EXPIRED: 'The saved context pack expired. Prepare a fresh pack.',
  CONTEXT_PACK_INVALID: 'The saved context pack could not be validated.',
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Context pack storage is temporarily unavailable.',
  CONTEXT_SOURCE_LIMIT: 'The saved pack source checks exceeded their limit.',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is temporarily unavailable.',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context pack read audit could not be persisted.',
  RATE_LIMITED: 'Context pack reads are temporarily busy. Retry when ready.',
  GATEWAY_REQUEST_TIMEOUT: 'The context pack exceeded the local read deadline. Retry when ready.',
  GATEWAY_RESPONSE_INVALID:
    'The complete context pack response was invalid, incomplete or exceeded its read limit.',
  GATEWAY_UNAVAILABLE: 'The saved context pack could not be read. Retry when ready.',
};

export function contextPackReadFailure(code: string, trace: string) {
  const known = Object.hasOwn(messages, code) ? code : 'GATEWAY_UNAVAILABLE';
  return new ContractError(known, messages[known]!, { trace_id: trace, retryable: false });
}

/** One original deadline covers bytes, full structure, ETag and saved content digest. */
export async function readContextPackResponse(
  response: Response,
  signal: AbortSignal,
  trace: string,
  deadline: number,
  query: ContextPackReadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
) {
  const fail = (code: string) => contextPackReadFailure(code, trace);
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
      CONTEXT_PACK_READ_RESPONSE_BYTES,
      CONTEXT_PACK_READ_ERROR_BYTES,
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
      syncJsonSnapshot(value, CONTEXT_PACK_READ_ERROR_BYTES);
      const error = validateErrorEnvelope(value);
      if (error.trace_id !== trace) throw new TypeError();
      // These codes change recovery options, so require their documented HTTP status too.
      const expected = {
        CONTEXT_PACK_NOT_FOUND: 404,
        CONTEXT_PACK_STALE: 409,
        CONTEXT_PACK_EXPIRED: 410,
      };
      if (
        Object.hasOwn(expected, error.code) &&
        response.status !== expected[error.code as keyof typeof expected]
      )
        throw new TypeError();
      code = error.code;
    } catch {
      check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    check();
    throw fail(code);
  }
  try {
    const result = parseContextPackReadEnvelope(value, query, scope, trace);
    if (response.headers.get('etag') !== result.etag) throw new TypeError();
    check();
    const hash =
      'sha256:' +
      createHash('sha256').update(contextPackReadHashJson(result.data.pack)).digest('hex');
    if (hash !== result.data.pack.pack_hash) throw new TypeError();
    check();
    return result;
  } catch {
    check();
    throw fail('GATEWAY_RESPONSE_INVALID');
  }
}
