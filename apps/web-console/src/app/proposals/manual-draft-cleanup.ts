'use client';

import type { SavedCopy } from './saved-copy-cleanup';

/** Manual draft entry points retain their original API and required save time. */
export interface ManualDraft extends SavedCopy {
  saved_at: string;
}
export {
  createSavedCopyCleanup as createManualDraftCleanup,
  SAVED_COPY_SELECTION_LIMIT as MANUAL_DRAFT_SELECTION_LIMIT,
  type ReviewedSavedSelection as ReviewedManualSelection,
  type SavedCopyCleanup as ManualDraftCleanup,
} from './saved-copy-cleanup';
