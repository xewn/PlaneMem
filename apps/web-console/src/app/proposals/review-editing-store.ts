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
  decodeReviewEditingDraft,
  encodeReviewEditingDraft,
  type ReviewEditingDraft,
} from './review-editing-model';

const layout = { databaseName: 'planemem-proposal-review-editing-drafts', contentStore: 'drafts' };
const summary = (draft: ReviewEditingDraft) => ({
  request_key: draft.request_key,
  saved_at: draft.saved_at,
  proposal_id: draft.proposal_id,
  expected_revision: draft.expected_revision,
  decision: draft.decision,
});
export type ReviewEditingSummary = ReturnType<typeof summary>;
export interface ReviewEditingPage {
  entries: ReviewEditingSummary[];
  next: string | null;
}
function key(binding: ProposalSubmissionBinding, requestKey: string) {
  const slot = proposalOriginalStorageKey(binding, requestKey);
  if (new TextEncoder().encode(slot).byteLength > 16384) throw new TypeError();
  return slot;
}
function pair(raw: unknown, index: unknown, binding: ProposalSubmissionBinding, slot: string) {
  if (
    typeof index !== 'string' ||
    index.length > 4096 ||
    new TextEncoder().encode(index).byteLength > 4096
  )
    throw new TypeError();
  const draft = decodeReviewEditingDraft(raw);
  assertProposalSubmissionBinding(draft.binding, binding);
  if (
    encodeReviewEditingDraft(draft) !== raw ||
    key(binding, draft.request_key) !== slot ||
    JSON.stringify(summary(draft)) !== index
  )
    throw new TypeError();
  return draft;
}
export function saveReviewEditingDraft(input: ReviewEditingDraft, signal: AbortSignal) {
  const raw = encodeReviewEditingDraft(input);
  const draft = decodeReviewEditingDraft(raw);
  const slot = key(draft.binding, draft.request_key);
  return inBrowserStores<ReviewEditingDraft>(
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
          if (encodeReviewEditingDraft({ ...draft, saved_at: saved.saved_at }) !== old)
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
export function loadReviewEditingDraft(
  input: ProposalSubmissionBinding,
  requestKey: string,
  signal: AbortSignal,
  selection?: ReviewEditingSummary,
) {
  const binding = parseProposalSubmissionBinding(input);
  const slot = key(binding, requestKey);
  const expected = selection ? JSON.stringify(selection) : undefined;
  return inBrowserStores<ReviewEditingDraft | null>(
    layout,
    'readonly',
    signal,
    () => null,
    (context) => {
      readBrowserPair(context, slot, (raw, index, exists) => {
        if (!exists) {
          context.accept(null);
          return;
        }
        if (expected !== undefined && expected !== index) throw new TypeError();
        context.accept(pair(raw, index, binding, slot));
      });
    },
  );
}
export function listReviewEditingDrafts(
  input: ProposalSubmissionBinding,
  after: string | null,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(input);
  key(binding, 'a');
  const prefix = proposalOriginalStoragePrefix(binding);
  return inBrowserStores<ReviewEditingPage>(
    layout,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: ReviewEditingSummary[] = [];
      const request = context.directory.openCursor(
        IDBKeyRange.bound(
          after === null ? prefix : key(binding, after),
          prefix + '\uffff',
          after !== null,
          true,
        ),
      );
      request.onsuccess = context.guard(() => {
        const cursor = request.result;
        if (!cursor) {
          context.accept({ entries, next: null });
          return;
        }
        if (
          typeof cursor.primaryKey !== 'string' ||
          new TextEncoder().encode(cursor.primaryKey).byteLength > 16384 ||
          typeof cursor.value !== 'string' ||
          new TextEncoder().encode(cursor.value).byteLength > 4096
        )
          throw new TypeError();
        if (entries.length === 20) {
          context.accept({ entries, next: entries[19]!.request_key });
          return;
        }
        const slot = cursor.primaryKey;
        readBrowserPair(context, slot, (raw, index, exists) => {
          if (!exists) throw new TypeError();
          entries.push(summary(pair(raw, index, binding, slot)));
          cursor.continue();
        });
      });
    },
  );
}
