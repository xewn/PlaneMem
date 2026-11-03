'use server';

import { proposalText } from '@planemem/contracts';
import {
  getWorkbenchProposalSubmissionBinding,
  submitWorkbenchProposalReviewOriginal,
} from '../../lib/server-api';
import { decodeReviewOriginal, encodeReviewOriginal, parseReviewOriginal } from './review-model';

export async function prepareProposalReview(data: FormData) {
  try {
    if (data.get('acknowledged') !== 'yes') throw new TypeError();
    const bindingText = data.get('binding');
    if (
      typeof bindingText !== 'string' ||
      bindingText.length > 16384 ||
      new TextEncoder().encode(bindingText).byteLength > 16384
    )
      throw new TypeError();
    const original = parseReviewOriginal({
      schema_version: 1,
      kind: 'proposal-review-submission',
      binding: JSON.parse(bindingText),
      request_key: data.get('key'),
      proposal_id: data.get('proposal_id'),
      expected_revision: Number(data.get('revision')),
      decision: data.get('choice'),
      reason: proposalText(data.get('reason'), 'reason', 2000),
    });
    await getWorkbenchProposalSubmissionBinding(original.binding);
    return { status: 'prepared' as const, original: encodeReviewOriginal(original) };
  } catch {
    return {
      status: 'error' as const,
      message:
        'The review request could not be prepared. Keep your reason and restore the original account and project. No review decision was sent.',
    };
  }
}
export async function submitSavedProposalReview(data: FormData) {
  const original = decodeReviewOriginal(data.get('original'));
  const raw = encodeReviewOriginal(original);
  try {
    if (data.get('confirmed') !== 'yes') throw new TypeError();
    const receipt = await submitWorkbenchProposalReviewOriginal(original);
    return { status: 'saved' as const, original: raw, receipt };
  } catch {
    return {
      status: 'unknown' as const,
      original: raw,
      message:
        'The original review outcome is not confirmed. Keep the original decision, reason, revision and key. Restore its gateway, account, client and project before an explicit retry.',
    };
  }
}
