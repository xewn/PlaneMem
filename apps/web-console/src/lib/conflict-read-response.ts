import {
  ContractError,
  CONFLICT_READ_RESPONSE_BYTES,
  CONFLICT_READ_ERROR_BYTES,
  validateErrorEnvelope,
} from '@planemem/contracts';
import { readWorkbenchJsonResponse } from './workbench-response';

const messages: Record<string, string> = {
  CONFLICT_NOT_FOUND: 'This conflict is unavailable in the current project.',
  CONFLICT_READ_TOO_LARGE:
    'The complete conflict exceeds the read limit. No partial values were returned.',
  CONFLICT_READ_INVALID: 'Stored conflict detail could not be validated.',
  CONFLICT_STORAGE_UNAVAILABLE: 'Conflict detail storage is temporarily unavailable.',
  INVALID_INPUT: 'Choose a valid conflict ID.',
  DENIED: 'Your current session cannot read this conflict.',
  RATE_LIMITED: 'Conflict reads are temporarily busy.',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is temporarily unavailable.',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The request audit could not be persisted.',
  GATEWAY_RESPONSE_INVALID:
    'The complete conflict response was invalid, incomplete or exceeded its limit.',
  GATEWAY_REQUEST_TIMEOUT: 'Conflict detail exceeded the local deadline.',
  GATEWAY_UNAVAILABLE: 'Conflict detail could not be read.',
};
export async function readConflictResponse(
  response: Response,
  signal: AbortSignal,
  trace: string,
  deadline: number,
): Promise<unknown> {
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  const check = () => {
    if (signal.aborted || Date.now() >= deadline) throw fail('GATEWAY_REQUEST_TIMEOUT');
  };
  let value;
  try {
    value = await readWorkbenchJsonResponse(
      response,
      signal,
      CONFLICT_READ_RESPONSE_BYTES,
      CONFLICT_READ_ERROR_BYTES,
    );
  } catch {
    check();
    throw fail('GATEWAY_RESPONSE_INVALID');
  }
  check();
  if (response.headers.get('x-trace-id') !== trace) throw fail('GATEWAY_RESPONSE_INVALID');
  if (!response.ok) {
    let code;
    try {
      const error = validateErrorEnvelope(value);
      if (error.trace_id !== trace) throw new TypeError();
      code = error.code;
    } catch {
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    throw fail(Object.hasOwn(messages, code) ? code : 'GATEWAY_UNAVAILABLE');
  }
  return value;
}
