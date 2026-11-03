'use server';

import { parseCheckpointReceiptLookup } from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  saveWorkbenchCheckpoint,
  getWorkbenchCheckpointReceipt,
} from '../../lib/server-api';
import {
  parseCheckpointSaveRequest,
  type CheckpointSaveRequest,
  type CheckpointSaveFeedback,
} from './checkpoint-model';

export async function submitCheckpointSave(
  raw: CheckpointSaveRequest,
  intent: 'save' | 'receipt',
  confirmed: boolean,
  previouslyUncertain: boolean,
): Promise<CheckpointSaveFeedback> {
  const request = parseCheckpointSaveRequest(raw);
  if (intent !== 'save' && intent !== 'receipt') throw new TypeError('Invalid checkpoint intent');
  const uncertain = previouslyUncertain === true;
  if (intent === 'save' && confirmed !== true)
    return {
      status: 'error',
      request,
      uncertain,
      message: 'Confirm the original notes and context pack before saving.',
    };
  try {
    let value: unknown;
    let trace: string;
    if (intent === 'receipt') {
      const result = await getWorkbenchCheckpointReceipt(
        request.sessionId,
        request.version,
        request.notes,
        request.key,
        request.contextPackId,
        request.identity,
      );
      value = result.data;
      trace = result.trace_id;
    } else {
      const result = await saveWorkbenchCheckpoint(
        request.sessionId,
        request.version,
        request.notes,
        request.key,
        request.contextPackId,
        request.identity,
      );
      const data = result.data;
      if (
        !data ||
        (request.contextPackId && !/^sha256:[a-f0-9]{64}$/.test(data.context_pack_hash ?? ''))
      )
        throw new TypeError();
      value = {
        status: 'recorded',
        session_id: data.session_id,
        checkpoint_id: data.checkpoint_id,
        revision: data.revision,
        ...(data.context_pack_id === undefined ? {} : { context_pack_id: data.context_pack_id }),
        context_pack_state: 'not-checked',
      };
      trace = result.trace_id;
    }
    const receipt = parseCheckpointReceiptLookup(value, request.sessionId, request.contextPackId);
    if (receipt.status !== 'recorded')
      return {
        status: 'error',
        request,
        uncertain,
        trace,
        message:
          'No matching save is visible yet. This does not prove failure. Keep the original request.',
      };
    return {
      status: 'done',
      request,
      receipt,
      trace,
      message: `Confirmed saved checkpoint ${receipt.revision}. This is a historical receipt. Review the saved pack before resuming; its current validity was not established by this receipt.`,
    };
  } catch (error) {
    const known = error instanceof WorkbenchApiError;
    return {
      status: 'error',
      request,
      uncertain:
        uncertain ||
        (intent === 'save' &&
          (known
            ? error.status === undefined ||
              error.status === 408 ||
              error.status >= 500 ||
              error.code === 'SESSION_RECEIPT_INVALID' ||
              error.code === 'IDEMPOTENCY_KEY_REUSED'
            : !(error instanceof AuthRequiredError))),
      ...(known ? { trace: error.trace_id } : {}),
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account, then check this original save request.'
          : known
            ? error.message
            : 'The checkpoint response could not be confirmed. Keep the original request and check its receipt.',
    };
  }
}
