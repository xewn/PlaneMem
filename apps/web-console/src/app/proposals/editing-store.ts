'use client';

import { inBrowserStores, readBrowserPair } from '../sync/receipt/browser-store';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  proposalOriginalStoragePrefix,
  type ProposalSubmissionBinding,
} from './original-model';
import {
  decodeProposalEditingDraft,
  encodeProposalEditingDraft,
  type ProposalEditingDraft,
} from './editing-model';

const layout = { databaseName: 'planemem-proposal-editing-drafts', contentStore: 'drafts' };
export interface ProposalEditingSummary {
  request_key: string;
  saved_at: string;
  title: string;
  kind: string;
  classification: string;
}
export interface ProposalEditingPage {
  entries: ProposalEditingSummary[];
  next: string | null;
}
const summary = (draft: ProposalEditingDraft): ProposalEditingSummary => ({
  request_key: draft.request_key,
  saved_at: draft.saved_at,
  title: draft.fields.values.title,
  kind: draft.fields.values.kind,
  classification: draft.fields.values.classification,
});
function key(binding: ProposalSubmissionBinding, requestKey: string) {
  const value = proposalOriginalStorageKey(binding, requestKey);
  if (new TextEncoder().encode(value).byteLength > 16384) throw new TypeError();
  return value;
}
function pair(raw: unknown, index: unknown, binding: ProposalSubmissionBinding, slot: string) {
  if (typeof raw !== 'string' || typeof index !== 'string') throw new TypeError();
  const draft = decodeProposalEditingDraft(raw);
  assertProposalSubmissionBinding(draft.binding, binding);
  if (
    key(binding, draft.request_key) !== slot ||
    encodeProposalEditingDraft(draft) !== raw ||
    JSON.stringify(summary(draft)) !== index
  )
    throw new TypeError();
  return draft;
}
export async function saveProposalEditingDraft(input: ProposalEditingDraft, signal: AbortSignal) {
  const raw = encodeProposalEditingDraft(input);
  const draft = decodeProposalEditingDraft(raw);
  const slot = key(draft.binding, draft.request_key);
  return inBrowserStores<ProposalEditingDraft>(
    layout,
    'readwrite',
    signal,
    () => {
      throw new TypeError();
    },
    (context) => {
      readBrowserPair(context, slot, (old, index, exists) => {
        if (exists) {
          const saved = pair(old, index, draft.binding, slot);
          // Saving the same editing state again retains its first save time.
          if (encodeProposalEditingDraft({ ...draft, saved_at: saved.saved_at }) !== old)
            throw new TypeError();
          context.accept(saved);
          return;
        }
        context.content.add(raw, slot);
        context.directory.add(JSON.stringify(summary(draft)), slot);
        readBrowserPair(context, slot, (saved, metadata, present) => {
          if (!present || saved !== raw) throw new TypeError();
          context.accept(pair(saved, metadata, draft.binding, slot));
        });
      });
    },
  );
}
export function loadProposalEditingDraft(
  bindingInput: ProposalSubmissionBinding,
  selection: ProposalEditingSummary,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(bindingInput);
  const slot = key(binding, selection.request_key);
  const expected = JSON.stringify(selection);
  return inBrowserStores<ProposalEditingDraft>(
    layout,
    'readonly',
    signal,
    () => {
      throw new TypeError();
    },
    (context) => {
      readBrowserPair(context, slot, (raw, index, exists) => {
        if (!exists || index !== expected) throw new TypeError();
        context.accept(pair(raw, index, binding, slot));
      });
    },
  );
}
export function listProposalEditingDrafts(
  bindingInput: ProposalSubmissionBinding,
  after: string | null,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(bindingInput);
  const prefix = proposalOriginalStoragePrefix(binding);
  key(binding, 'a');
  const start = after === null ? prefix : key(binding, after);
  return inBrowserStores<ProposalEditingPage>(
    layout,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: ProposalEditingSummary[] = [];
      const cursor = context.directory.openCursor(
        IDBKeyRange.bound(start, prefix + '\uffff', after !== null, true),
      );
      cursor.onsuccess = context.guard(() => {
        const current = cursor.result;
        if (!current) {
          context.accept({ entries, next: null });
          return;
        }
        if (
          typeof current.primaryKey !== 'string' ||
          typeof current.value !== 'string' ||
          new TextEncoder().encode(current.value).byteLength > 4096
        )
          throw new TypeError();
        if (entries.length === 20) {
          context.accept({ entries, next: entries[19]!.request_key });
          return;
        }
        const slot = current.primaryKey;
        // Verify the full pair before exposing a directory entry; at most 20 drafts per page.
        readBrowserPair(context, slot, (raw, index, exists) => {
          if (!exists) throw new TypeError();
          entries.push(summary(pair(raw, index, binding, slot)));
          current.continue();
        });
      });
    },
  );
}
