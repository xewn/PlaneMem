'use client';

import { parseProposalEditingDraft, type ProposalEditingFields } from './editing-model';
import type { ProposalSubmissionBinding } from './original-model';
import { saveEditingAutosave } from './editing-autosave-store';
import { useDraftAutosave } from './use-draft-autosave';

function makeDraft(input: string, savedAt: string) {
  return parseProposalEditingDraft({
    ...JSON.parse(input),
    schema_version: 1,
    kind: 'proposal-editing-draft',
    saved_at: savedAt,
  });
}
export function useEditingAutosave({
  binding,
  requestKey,
  fields,
  disabled,
  restricted,
}: {
  binding: ProposalSubmissionBinding;
  requestKey: string;
  fields: ProposalEditingFields;
  disabled: boolean;
  restricted: boolean;
}) {
  return useDraftAutosave({
    input: JSON.stringify({ binding, request_key: requestKey, fields }),
    disabled,
    allowed: fields.values.classification !== 'restricted' || restricted,
    makeDraft,
    save: saveEditingAutosave,
  });
}
