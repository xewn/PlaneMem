'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isUlid, parseCreateProposal, validateIdempotencyKey } from '@planemem/contracts';
import { field } from '../../lib/command-feedback';
import { validateProposalReceipt } from '../../lib/mutation-receipts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  reviewWorkbenchProposal,
  createWorkbenchProposal,
} from '../../lib/server-api';

export interface ReviewFeedback {
  status: 'idle' | 'error';
  key?: string;
  message?: string;
  trace?: string | undefined;
  uncertain?: boolean;
  reload?: boolean;
}

export async function submitProposal(
  previous: ReviewFeedback,
  data: FormData,
): Promise<ReviewFeedback> {
  const key = field(data, 'key');
  const unresolved = previous.key === key && previous.uncertain === true;
  let input: ReturnType<typeof parseCreateProposal>;
  try {
    validateIdempotencyKey(key);
    if (field(data, 'acknowledged') !== 'yes')
      throw new TypeError('Review the draft and acknowledge the submission.');
    const draft = data.get('draft');
    if (typeof draft !== 'string') throw new TypeError('The proposal draft is missing.');
    input = parseCreateProposal(JSON.parse(draft));
  } catch (error) {
    return {
      status: 'error',
      key,
      uncertain: unresolved,
      message: error instanceof Error ? error.message : 'Check the proposal fields.',
    };
  }
  let id: string;
  try {
    const result = await createWorkbenchProposal(input, key);
    validateProposalReceipt(result.data, { status: 'proposed', revision: 1 });
    id = result.data.proposal_id;
    revalidatePath('/proposals');
  } catch (error) {
    if (error instanceof AuthRequiredError)
      return {
        status: 'error',
        key,
        uncertain: unresolved,
        message: 'Sign in again to submit this proposal.',
      };
    if (error instanceof WorkbenchApiError)
      return {
        status: 'error',
        key,
        message: error.message,
        trace: error.trace_id,
        uncertain: unresolved || error.status === undefined || error.status >= 500,
      };
    return {
      status: 'error',
      key,
      uncertain: true,
      message: 'The gateway did not confirm the submission. Retry with the original draft.',
    };
  }
  redirect('/proposals?status=all&proposal=' + encodeURIComponent(id));
}

export async function reviewProposal(
  previous: ReviewFeedback,
  data: FormData,
): Promise<ReviewFeedback> {
  const key = field(data, 'key');
  const unresolved = previous.key === key && previous.uncertain === true;
  const id = field(data, 'proposal_id');
  const choice = field(data, 'choice');
  const revision = Number(field(data, 'revision'));
  const reason = field(data, 'reason');
  if (
    !key ||
    !isUlid(id) ||
    !['confirm', 'reject'].includes(choice) ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isSafeInteger(revision + 1) ||
    !reason ||
    reason.length > 2000 ||
    field(data, 'acknowledged') !== 'yes'
  )
    return {
      status: 'error',
      key,
      uncertain: unresolved,
      message: 'Choose a decision, enter your reason and acknowledge the review.',
    };
  try {
    const result = await reviewWorkbenchProposal(
      id,
      choice as 'confirm' | 'reject',
      revision,
      reason,
      key,
    );
    validateProposalReceipt(result.data, {
      id,
      status: choice === 'confirm' ? 'verified' : 'rejected',
      revision: revision + 1,
    });
    revalidatePath('/proposals');
  } catch (error) {
    if (error instanceof AuthRequiredError)
      return {
        status: 'error',
        key,
        uncertain: unresolved,
        message: 'Sign in again to review this proposal.',
      };
    if (error instanceof WorkbenchApiError)
      return {
        status: 'error',
        key,
        message: error.message,
        trace: error.trace_id,
        uncertain: unresolved || error.status === undefined || error.status >= 500,
        reload:
          !unresolved && (error.status === 404 || error.status === 409 || error.status === 410),
      };
    return {
      status: 'error',
      key,
      uncertain: true,
      message: 'The gateway did not confirm the decision. Retry with the original values.',
    };
  }
  redirect('/proposals?status=all&proposal=' + encodeURIComponent(id));
}
