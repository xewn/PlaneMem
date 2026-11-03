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
  decodeReviewOriginal,
  encodeReviewOriginal,
  type ProposalReviewOriginal,
} from './review-model';

const layout = { databaseName: 'planemem-proposal-review-originals', contentStore: 'originals' };
export interface SavedReview {
  request_key: string;
  proposal_id: string;
  decision: 'confirm' | 'reject';
  expected_revision: number;
}
export interface SavedReviewPage {
  entries: SavedReview[];
  next: string | null;
}
const summary = (original: ProposalReviewOriginal): SavedReview => ({
  request_key: original.request_key,
  proposal_id: original.proposal_id,
  decision: original.decision,
  expected_revision: original.expected_revision,
});
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
  const original = decodeReviewOriginal(raw);
  assertProposalSubmissionBinding(original.binding, binding);
  if (
    encodeReviewOriginal(original) !== raw ||
    key(binding, original.request_key) !== slot ||
    JSON.stringify(summary(original)) !== index
  )
    throw new TypeError();
  return original;
}
export function saveReviewOriginal(input: ProposalReviewOriginal, signal: AbortSignal) {
  const raw = encodeReviewOriginal(input);
  const original = decodeReviewOriginal(raw);
  const slot = key(original.binding, original.request_key);
  return inBrowserStores<ProposalReviewOriginal>(
    layout,
    'readwrite',
    signal,
    () => {
      throw new TypeError();
    },
    (context) => {
      readBrowserPair(context, slot, (old, index, exists) => {
        if (exists) {
          const saved = pair(old, index, original.binding, slot);
          if (old !== raw) throw new TypeError();
          context.accept(saved);
          return;
        }
        context.content.add(raw, slot);
        context.directory.add(JSON.stringify(summary(original)), slot);
        readBrowserPair(context, slot, (saved, metadata, present) => {
          if (!present || saved !== raw) throw new TypeError();
          context.accept(pair(saved, metadata, original.binding, slot));
        });
      });
    },
  );
}
export function loadReviewOriginal(
  input: ProposalSubmissionBinding,
  requestKey: string,
  signal: AbortSignal,
  selection?: SavedReview,
) {
  const binding = parseProposalSubmissionBinding(input);
  const slot = key(binding, requestKey);
  const selected = selection ? JSON.stringify(selection) : undefined;
  return inBrowserStores<ProposalReviewOriginal | null>(
    layout,
    'readonly',
    signal,
    () => null,
    (context) =>
      readBrowserPair(context, slot, (raw, index, exists) => {
        if (!exists) {
          context.accept(null);
          return;
        }
        if (selected !== undefined && selected !== index) throw new TypeError();
        context.accept(pair(raw, index, binding, slot));
      }),
  );
}
export function listReviewOriginals(
  input: ProposalSubmissionBinding,
  after: string | null,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(input);
  key(binding, 'a');
  const prefix = proposalOriginalStoragePrefix(binding);
  return inBrowserStores<SavedReviewPage>(
    layout,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: SavedReview[] = [];
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
          typeof cursor.value !== 'string' ||
          cursor.primaryKey.length > 16384 ||
          cursor.value.length > 4096 ||
          new TextEncoder().encode(cursor.primaryKey).byteLength > 16384 ||
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
