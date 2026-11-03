'use client';

import { createDraftAutosaveStore, type DraftAutosavePage } from './draft-autosave-store';
import { createDraftAutosaveBackup } from './draft-autosave-backup';
import { createDraftAutosaveCleanup } from './draft-autosave-cleanup';
import {
  decodeReviewEditingDraft,
  encodeReviewEditingDraft,
  type ReviewEditingDraft,
} from './review-editing-model';

export interface ReviewEditingAutosaveSummary {
  session_id: string;
  request_key: string;
  saved_at: string;
  proposal_id: string;
  expected_revision: number;
  decision: ReviewEditingDraft['decision'];
}
export type ReviewEditingAutosavePage = DraftAutosavePage<ReviewEditingAutosaveSummary>;
const store = createDraftAutosaveStore<ReviewEditingDraft, ReviewEditingAutosaveSummary>({
  layout: { databaseName: 'planemem-proposal-review-editing-autosaves', contentStore: 'drafts' },
  backup: { kind: 'proposal-review-editing-autosaves-backup', documentBytes: 4 * 1024 * 1024 },
  encode: encodeReviewEditingDraft,
  decode: decodeReviewEditingDraft,
  summary: (session, draft) => ({
    session_id: session,
    request_key: draft.request_key,
    saved_at: draft.saved_at,
    proposal_id: draft.proposal_id,
    expected_revision: draft.expected_revision,
    decision: draft.decision,
  }),
});
export const saveReviewEditingAutosave = store.save;
export const listReviewEditingAutosaves = store.list;
export const loadReviewEditingAutosave = store.load;
export const removeReviewEditingAutosave = store.remove;
export const reviewEditingAutosaveBackup = createDraftAutosaveBackup(store);
export const reviewEditingAutosaveCleanup = createDraftAutosaveCleanup(store);
