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
  getWorkbenchProposalSubmissionBinding,
  submitWorkbenchProposalOriginal,
  readWorkbenchProposalCreateReceipt,
} from '../../lib/server-api';
import {
  decodeProposalOriginal,
  encodeProposalOriginal,
  PROPOSAL_ORIGINAL_BYTES,
  parseProposalSubmissionBinding,
} from './original-model';

export async function prepareProposalSubmission(data: FormData) {
  try {
    const key = field(data, 'key');
    validateIdempotencyKey(key);
    if (field(data, 'acknowledged') !== 'yes') throw new TypeError();
    const raw = data.get('draft');
    if (
      typeof raw !== 'string' ||
      new TextEncoder().encode(raw).byteLength > PROPOSAL_ORIGINAL_BYTES
    )
      throw new TypeError();
    const draft = parseCreateProposal(JSON.parse(raw));
    const bindingText = field(data, 'binding');
    if (new TextEncoder().encode(bindingText).byteLength > 16384) throw new TypeError();
    const binding = await getWorkbenchProposalSubmissionBinding(
      parseProposalSubmissionBinding(JSON.parse(bindingText)),
    );
    return {
      status: 'prepared' as const,
      original: encodeProposalOriginal({
        schema_version: 1,
        kind: 'proposal-submission',
        binding,
        request_key: key,
        draft,
      }),
    };
  } catch {
    return {
      status: 'error' as const,
      message:
        'The original request could not be prepared. Check the draft and sign in to the intended project, then try again. No proposal was submitted.',
    };
  }
}

export async function submitSavedProposal(data: FormData) {
  const original = decodeProposalOriginal(data.get('original'));
  const raw = encodeProposalOriginal(original);
  try {
    if (field(data, 'confirmed') !== 'yes') throw new TypeError();
    const result = await submitWorkbenchProposalOriginal(original);
    revalidatePath('/proposals');
    return { status: 'saved' as const, original: raw, receipt: result.data };
  } catch {
    return {
      status: 'unknown' as const,
      original: raw,
      message:
        'The original submission is not confirmed. Keep this request unchanged. Restore the original gateway, account, client and project before retrying.',
    };
  }
}
export async function readSavedProposalReceipt(data: FormData) {
  const original = decodeProposalOriginal(data.get('original'));
  const raw = encodeProposalOriginal(original);
  try {
    const receipt = await readWorkbenchProposalCreateReceipt(original);
    return { status: 'read' as const, original: raw, receipt };
  } catch {
    return {
      status: 'unavailable' as const,
      original: raw,
      message:
        'The original creation receipt could not be confirmed. Keep the original request and restore its gateway, account, client and project before another explicit query. No creation request was sent.',
    };
  }
}

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
