'use server';

import {
  AuthRequiredError,
  WorkbenchApiError,
  createWorkbenchHandoff,
  getWorkbenchHandoffCreateReceipt,
} from '../../lib/server-api';
import {
  parseCreateRequest,
  recordedCreation,
  type CreateRequest,
  type CreateFeedback,
} from './create-model';

export async function submitCreation(
  raw: CreateRequest,
  intent: 'create' | 'receipt',
  confirmed: boolean,
  previouslyUncertain: boolean,
): Promise<CreateFeedback> {
  const request = parseCreateRequest(raw);
  if (intent !== 'create' && intent !== 'receipt') throw new TypeError('Invalid creation intent');
  const uncertain = previouslyUncertain === true;
  if (intent === 'create' && confirmed !== true)
    return {
      status: 'error',
      request,
      uncertain,
      message: 'Confirm this checkpoint and recipient using the original account and client.',
    };
  try {
    const call = intent === 'receipt' ? getWorkbenchHandoffCreateReceipt : createWorkbenchHandoff;
    const result = await call(
      request.sessionId,
      request.checkpointId,
      request.target,
      request.key,
      request.identity,
    );
    if (result.data.status !== 'recorded')
      return {
        status: 'error',
        request,
        uncertain: true,
        trace: result.trace_id,
        message:
          'No matching creation receipt is visible. The request may still be committing or predate receipts. Keep the original request; a similar handoff in the list does not confirm this request.',
      };
    return {
      status: 'done',
      request,
      receipt: recordedCreation(result.data, request),
      trace: result.trace_id,
      message:
        'Confirmed the original handoff creation. Read its current state before claiming or resuming; this receipt does not verify current ownership or context.',
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
            error.code === 'HANDOFF_CREATE_LEGACY_UNVERIFIED'
          : !(error instanceof AuthRequiredError)),
      ...(known ? { trace: error.trace_id } : {}),
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account, then check this creation receipt.'
          : known
            ? error.message
            : 'The creation response could not be confirmed. Keep the original checkpoint, target and key, then check the receipt.',
    };
  }
}
