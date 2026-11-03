'use server';

import { parseHandoffClaimReceiptLookup } from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  claimWorkbenchHandoff,
  getWorkbenchHandoffClaimReceipt,
} from '../../lib/server-api';
import {
  parseClaimRequest,
  recordedClaim,
  type ClaimRequest,
  type ClaimFeedback,
} from './claim-model';

export async function submitClaim(
  raw: ClaimRequest,
  intent: 'claim' | 'receipt',
  confirmed: boolean,
  previouslyUncertain: boolean,
): Promise<ClaimFeedback> {
  const request = parseClaimRequest(raw);
  if (intent !== 'claim' && intent !== 'receipt') throw new TypeError('Invalid claim intent');
  const uncertain = previouslyUncertain === true;
  if (intent === 'claim' && confirmed !== true)
    return {
      status: 'error',
      request,
      uncertain,
      message: 'Confirm ownership using the original signed-in account and client.',
    };
  try {
    let receipt;
    let trace: string;
    if (intent === 'receipt') {
      const result = await getWorkbenchHandoffClaimReceipt(
        request.handoffId,
        request.version,
        request.key,
        request.identity,
      );
      const lookup = parseHandoffClaimReceiptLookup(
        result.data,
        request.handoffId,
        request.version,
        request.identity,
      );
      if (lookup.status !== 'recorded')
        return {
          status: 'error',
          request,
          uncertain: true,
          trace: result.trace_id,
          message:
            'No matching claim receipt is visible. Earlier claims may lack receipts or still be committing. Keep the original request; current ownership does not prove this request succeeded.',
        };
      receipt = recordedClaim(lookup, request);
      trace = result.trace_id;
    } else {
      const result = await claimWorkbenchHandoff(
        request.handoffId,
        request.version,
        request.key,
        request.identity,
      );
      receipt = recordedClaim(result.data?.claim_receipt, request);
      if (
        result.data.handoff_id !== request.handoffId ||
        result.data.checkpoint_id !== request.checkpointId ||
        !Number.isSafeInteger(result.data.version) ||
        result.data.version < receipt.handoff_version
      )
        throw new TypeError();
      trace = result.trace_id;
    }
    return {
      status: 'done',
      request,
      receipt,
      trace,
      message: receipt.changed
        ? 'Confirmed this original ownership claim. Read the current handoff before resuming; the receipt does not verify current context.'
        : 'Confirmed this original request made no ownership change because the same account and client already held the handoff. Read the current handoff before resuming.',
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
            error.code === 'IDEMPOTENCY_KEY_REUSED' ||
            error.code === 'HANDOFF_CLAIM_LEGACY_UNVERIFIED'
          : !(error instanceof AuthRequiredError)),
      ...(known ? { trace: error.trace_id } : {}),
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account, then check this claim receipt.'
          : known
            ? error.message
            : 'The claim response could not be confirmed. Keep the original version and key, then check its receipt.',
    };
  }
}
