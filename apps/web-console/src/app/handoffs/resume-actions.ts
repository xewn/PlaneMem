'use server';

import { isUlid, parseResumeReceiptLookup } from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  resumeWorkbenchHandoff,
  getWorkbenchResumeReceipt,
} from '../../lib/server-api';
import {
  parseResumeRequest,
  recordedResume,
  parseResumeNextActions,
  type ResumeRequest,
  type ResumeFeedback,
} from './resume-model';

export async function submitResume(
  raw: ResumeRequest,
  intent: 'resume' | 'receipt',
  confirmed: boolean,
  previouslyUncertain: boolean,
): Promise<ResumeFeedback> {
  const request = parseResumeRequest(raw);
  if (intent !== 'resume' && intent !== 'receipt') throw new TypeError('Invalid resume intent');
  const uncertain = previouslyUncertain === true;
  if (intent === 'resume' && confirmed !== true)
    return {
      status: 'error',
      request,
      uncertain,
      message: 'Confirm continuation from this original checkpoint.',
    };
  try {
    if (intent === 'receipt') {
      const result = await getWorkbenchResumeReceipt(
        request.parentSessionId,
        request.handoffId,
        request.identity,
        request.checkpointId,
      );
      const receipt = parseResumeReceiptLookup(
        result.data,
        request.parentSessionId,
        request.handoffId,
      );
      if (receipt.status !== 'recorded')
        return {
          status: 'error',
          request,
          uncertain: true,
          trace: result.trace_id,
          message:
            receipt.status === 'legacy-unverified'
              ? 'A historical session uses this key, but its handoff was not recorded. Review session history; this does not prove another resume is needed.'
              : 'No matching resume is visible yet. An earlier request may still finish. Keep this original request.',
        };
      return {
        status: 'done',
        request,
        receipt: recordedResume(receipt, request),
        trace: result.trace_id,
        message:
          'Confirmed the previously created child session. This historical receipt does not check current context validity.',
      };
    }
    const result = await resumeWorkbenchHandoff(
      request.parentSessionId,
      request.handoffId,
      request.identity,
      request.checkpointId,
    );
    const data = result.data;
    if (
      !data ||
      data.session?.parent_session_id !== request.parentSessionId ||
      data.checkpoint?.session_id !== request.parentSessionId ||
      data.checkpoint.checkpoint_id !== request.checkpointId ||
      data.handoff?.handoff_id !== request.handoffId ||
      data.handoff.checkpoint_id !== request.checkpointId ||
      data.session.resume_origin?.handoff_id !== request.handoffId ||
      data.session.resume_origin.checkpoint_id !== request.checkpointId ||
      data.session.resume_origin.require_claimed !== true ||
      !['checked', 'legacy-unverified', 'none'].includes(data.context_pack_state ?? '') ||
      (data.context_pack_state === 'checked' && !isUlid(data.context_pack?.pack_id))
    )
      throw new TypeError();
    const receipt = recordedResume(
      {
        status: 'recorded',
        parent_session_id: data.session.parent_session_id,
        handoff_id: data.handoff.handoff_id,
        session_id: data.session.session_id,
        checkpoint_id: data.checkpoint.checkpoint_id,
        require_claimed: data.session.resume_origin.require_claimed,
        context_pack_state: 'not-checked',
      },
      request,
    );
    return {
      status: 'done',
      request,
      receipt,
      trace: result.trace_id,
      nextActions: parseResumeNextActions(data.checkpoint.next_actions),
      ...(data.context_pack_state === 'checked' && data.context_pack
        ? { contextPackId: data.context_pack.pack_id }
        : {}),
      message:
        data.context_pack_state === 'checked'
          ? 'Session restored. The saved context pack and its sources were checked for this response.'
          : data.context_pack_state === 'legacy-unverified'
            ? 'Session restored. Historical context references remain unverified; review current context.'
            : 'Session restored without a saved context pack.',
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
            error.code === 'SESSION_RESUME_LEGACY_UNVERIFIED'
          : !(error instanceof AuthRequiredError)),
      ...(known ? { trace: error.trace_id } : {}),
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account, then check the original resume receipt.'
          : known
            ? error.message
            : 'The resume response could not be confirmed. Keep the original request and check its receipt.',
    };
  }
}
