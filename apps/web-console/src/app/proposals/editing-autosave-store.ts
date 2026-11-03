'use client';

import { createDraftAutosaveStore, type DraftAutosavePage } from './draft-autosave-store';
import { createDraftAutosaveBackup } from './draft-autosave-backup';
import {
  decodeProposalEditingDraft,
  encodeProposalEditingDraft,
  type ProposalEditingDraft,
} from './editing-model';

export interface EditingAutosaveSummary {
  session_id: string;
  request_key: string;
  saved_at: string;
  title: string;
  kind: string;
  classification: string;
}
export type EditingAutosavePage = DraftAutosavePage<EditingAutosaveSummary>;
const store = createDraftAutosaveStore<ProposalEditingDraft, EditingAutosaveSummary>({
  layout: { databaseName: 'planemem-proposal-editing-autosaves', contentStore: 'drafts' },
  backup: { kind: 'proposal-editing-autosaves-backup', documentBytes: 16 * 1024 * 1024 },
  encode: encodeProposalEditingDraft,
  decode: decodeProposalEditingDraft,
  summary: (session, draft) => ({
    session_id: session,
    request_key: draft.request_key,
    saved_at: draft.saved_at,
    title: draft.fields.values.title,
    kind: draft.fields.values.kind,
    classification: draft.fields.values.classification,
  }),
});
export const saveEditingAutosave = store.save;
export const listEditingAutosaves = store.list;
export const loadEditingAutosave = store.load;
export const removeEditingAutosave = store.remove;
export const editingAutosaveBackup = createDraftAutosaveBackup(store);
