import {
  ContractError,
  CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES,
  CONTEXT_ITEM_DIRECTORY_ERROR_BYTES,
  parseContextItemDirectoryQuery,
  parseContextItemDirectoryEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
  type ContextItemDirectoryQuery,
  type ContextItemDirectoryScope,
} from '@planemem/contracts';
import { readWorkbenchJsonResponse } from './workbench-response';

const messages: Record<string, string> = {
  INVALID_INPUT:
    'This context page no longer matches its filters or page size. Start again from the first page.',
  DENIED: 'Your current session cannot read context items in this project.',
  CONTEXT_ITEM_INVALID:
    'The complete context page is invalid or too large. Try a smaller page or narrower filters.',
  WORKBENCH_DATABASE_UNAVAILABLE: 'Context information is temporarily unavailable.',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is temporarily unavailable.',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context read audit could not be persisted.',
  RATE_LIMITED: 'Context reads are temporarily busy. Retry this page when ready.',
  GATEWAY_REQUEST_TIMEOUT: 'The context page exceeded its read deadline. Retry when ready.',
  GATEWAY_RESPONSE_INVALID:
    'The complete context page was invalid, incomplete or exceeded its read limit.',
  GATEWAY_UNAVAILABLE: 'The context page could not be read. Retry when ready.',
};
export function contextDirectoryFailure(code: string, trace: string) {
  const known = Object.hasOwn(messages, code) ? code : 'GATEWAY_UNAVAILABLE';
  return new ContractError(known, messages[known]!, { trace_id: trace, retryable: false });
}
export function prepareContextDirectoryQuery(
  body: Record<string, unknown>,
): ContextItemDirectoryQuery {
  const { operation, ...input } = JSON.parse(syncJsonSnapshot(body, 8192)) as Record<
    string,
    unknown
  >;
  if (operation !== 'context') throw new TypeError('Choose a context directory read');
  return parseContextItemDirectoryQuery(input);
}
/** Full bytes, original query and scope, inside the existing fetch deadline. */
export async function readContextDirectoryResponse(
  response: Response,
  signal: AbortSignal,
  trace: string,
  deadline: number,
  query: ContextItemDirectoryQuery,
  scope: ContextItemDirectoryScope,
) {
  const fail = (code: string) => contextDirectoryFailure(code, trace);
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
      CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES,
      CONTEXT_ITEM_DIRECTORY_ERROR_BYTES,
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
      syncJsonSnapshot(value, CONTEXT_ITEM_DIRECTORY_ERROR_BYTES);
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
    const result = parseContextItemDirectoryEnvelope(value, query, scope, trace);
    check();
    return result;
  } catch {
    check();
    throw fail('GATEWAY_RESPONSE_INVALID');
  }
}
