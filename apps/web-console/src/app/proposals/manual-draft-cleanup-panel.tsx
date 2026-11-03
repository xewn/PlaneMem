'use client';

import type { ManualDraft } from './manual-draft-cleanup';
import { SavedCopyCleanupPanel, type SavedCopyCleanupPanelProps } from './saved-copy-cleanup-panel';

type ManualDraftCleanupPanelProps<
  Draft extends ManualDraft,
  Summary extends { request_key: string },
> = Omit<
  SavedCopyCleanupPanelProps<Draft, Summary>,
  'copyLabel' | 'heading' | 'findLabel' | 'scopeNote'
> & {
  draftLabel: (draft: Draft) => string;
};

export function ManualDraftCleanupPanel<
  Draft extends ManualDraft,
  Summary extends { request_key: string },
>({ draftLabel, ...props }: ManualDraftCleanupPanelProps<Draft, Summary>) {
  return (
    <SavedCopyCleanupPanel<Draft, Summary>
      {...props}
      copyLabel={(draft) => `${draftLabel(draft)} · ${draft.saved_at}`}
      heading="Select and remove manually saved copies from this page"
      findLabel="Find saved drafts"
      scopeNote="Automatic saving pauses before inspection or removal. Current editor text, automatic copies, prepared requests and remote proposals are kept. Removal does not send or cancel a review."
    />
  );
}
