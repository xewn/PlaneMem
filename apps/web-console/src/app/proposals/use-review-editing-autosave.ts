'use client';

import { parseReviewEditingDraft } from './review-editing-model';
import type { ProposalSubmissionBinding } from './original-model';
import { saveReviewEditingAutosave } from './review-editing-autosave-store';
import { useDraftAutosave } from './use-draft-autosave';

interface ReviewAutosaveEditor {
  requestKey: string;
  proposalId: string;
  revision: number;
  decision: string;
  reason: string;
}
function makeDraft(input: string, savedAt: string) {
  return parseReviewEditingDraft({
    ...JSON.parse(input),
    schema_version: 1,
    kind: 'proposal-review-editing-draft',
    saved_at: savedAt,
  });
}
export function useReviewEditingAutosave({
  binding,
  editor,
  disabled,
}: {
  binding: ProposalSubmissionBinding;
  editor: ReviewAutosaveEditor | undefined;
  disabled: boolean;
}) {
  return useDraftAutosave({
    input: editor
      ? JSON.stringify({
          binding,
          request_key: editor.requestKey,
          proposal_id: editor.proposalId,
          expected_revision: editor.revision,
          decision: editor.decision,
          reason: editor.reason,
        })
      : null,
    disabled,
    allowed: !!editor,
    makeDraft,
    save: saveReviewEditingAutosave,
  });
}
