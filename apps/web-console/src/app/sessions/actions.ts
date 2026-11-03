'use server';

import {
  AuthRequiredError,
  WorkbenchApiError,
  startWorkbenchSession,
  getWorkbenchSessionStartReceipt,
} from '../../lib/server-api';
import {
  parseStartRequest,
  recordedStart,
  type StartRequest,
  type StartFeedback,
} from './start-model';

export async function submitStart(
  raw: StartRequest,
  intent: 'start' | 'receipt',
  confirmed: boolean,
  previouslyUncertain: boolean,
): Promise<StartFeedback> {
  const request = parseStartRequest(raw);
  if (intent !== 'start' && intent !== 'receipt') throw new TypeError('Invalid start intent');
  const uncertain = previouslyUncertain === true;
  if (intent === 'start' && confirmed !== true)
    return {
      status: 'error',
      request,
      uncertain,
      message: 'Confirm this session start using your original account and client.',
    };
  try {
    const call = intent === 'receipt' ? getWorkbenchSessionStartReceipt : startWorkbenchSession;
    const result = await call(request.session, request.key, request.identity);
    if (result.data.status !== 'recorded')
      return {
        status: 'error',
        request,
        uncertain: true,
        trace: result.trace_id,
        message:
          'No matching start receipt is visible. The request may still be committing or predate receipts. Keep the original request; a similar session does not confirm it.',
      };
    return {
      status: 'done',
      request,
      receipt: recordedStart(result.data, request),
      trace: result.trace_id,
      message:
        'Confirmed the original session start. Open the session to read its current state; it may have advanced since this request.',
    };
  } catch (error) {
    const known = error instanceof WorkbenchApiError;
    return {
      status: 'error',
      request,
      uncertain:
        uncertain ||
        intent === 'receipt' ||
        (known
          ? error.status === undefined ||
            error.status === 408 ||
            error.status >= 500 ||
            error.code === 'SESSION_RECEIPT_INVALID' ||
            error.code === 'IDEMPOTENCY_KEY_REUSED' ||
            error.code === 'SESSION_START_LEGACY_UNVERIFIED'
          : !(error instanceof AuthRequiredError)),
      ...(known ? { trace: error.trace_id } : {}),
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account, then check this start receipt.'
          : known
            ? error.message
            : 'The start response could not be confirmed. Keep the original parameters and key, then check the receipt.',
    };
  }
}
