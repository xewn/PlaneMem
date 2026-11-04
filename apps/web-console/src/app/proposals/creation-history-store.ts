'use client';

import {
  inBrowserStores,
  readBrowserPair,
  removeBrowserPair,
  type BrowserRemovalResult,
} from '../sync/receipt/browser-store';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  proposalOriginalStoragePrefix,
  type ProposalSubmissionBinding,
} from './original-model';
import {
  CREATION_HISTORY_FILE_BYTES,
  creationHistoryFileJson,
  creationObservationStatus,
  creationRecordedReceipt,
  parseCreationHistoryFile,
  type CreationHistoryFile,
} from './creation-history-model';
import { inspectCreationHistory, type CreationHistoryCandidate } from './creation-history-file';

const layout = { databaseName: 'planemem-proposal-creation-history', contentStore: 'observations' };
// A creation observation can include two full copies of its original draft.
export const CREATION_HISTORY_PAGE_SIZE = 5;
const summary = (file: CreationHistoryFile) => ({
  digest: file.document_sha256,
  request_key: file.document.original.request_key,
  proposal_id: creationRecordedReceipt(file.document)?.proposal_id ?? null,
  source: file.document.source,
  status: creationObservationStatus(file.document),
  observed_at: file.document.observed_at,
});
export type CreationHistorySummary = ReturnType<typeof summary>;
export interface CreationHistoryPage {
  entries: CreationHistorySummary[];
  next: string | null;
}
function key(binding: ProposalSubmissionBinding, digest: string) {
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new TypeError();
  const slot = proposalOriginalStorageKey(binding, digest);
  if (new TextEncoder().encode(slot).byteLength > 16384) throw new TypeError();
  return slot;
}
/** Structural and byte-for-byte checks in a transaction; hashes are checked outside it. */
function pair(
  raw: unknown,
  index: unknown,
  binding: ProposalSubmissionBinding,
  slot: string,
): CreationHistoryCandidate {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > CREATION_HISTORY_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > CREATION_HISTORY_FILE_BYTES ||
    typeof index !== 'string' ||
    index.length > 4096 ||
    new TextEncoder().encode(index).byteLength > 4096
  )
    throw new TypeError();
  const file = parseCreationHistoryFile(JSON.parse(raw));
  assertProposalSubmissionBinding(file.document.original.binding, binding);
  if (
    key(binding, file.document_sha256) !== slot ||
    creationHistoryFileJson(file) !== raw ||
    JSON.stringify(summary(file)) !== index
  )
    throw new TypeError();
  return { file, raw };
}
export async function saveCreationHistory(
  raw: string,
  input: ProposalSubmissionBinding,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const binding = parseProposalSubmissionBinding(input);
  const candidate = await inspectCreationHistory(raw, binding, check);
  check();
  const slot = key(binding, candidate.file.document_sha256);
  return inBrowserStores<CreationHistoryCandidate>(
    layout,
    'readwrite',
    signal,
    () => {
      throw new TypeError();
    },
    (context) => {
      readBrowserPair(context, slot, (old, index, exists) => {
        check();
        if (exists) {
          const stored = pair(old, index, binding, slot);
          if (stored.raw !== candidate.raw) throw new TypeError();
          context.accept(stored);
          return;
        }
        context.content.add(candidate.raw, slot);
        context.directory.add(JSON.stringify(summary(candidate.file)), slot);
        readBrowserPair(context, slot, (saved, metadata, present) => {
          check();
          if (!present || saved !== candidate.raw) throw new TypeError();
          context.accept(pair(saved, metadata, binding, slot));
        });
      });
    },
  );
}
export async function loadCreationHistory(
  input: ProposalSubmissionBinding,
  digest: string,
  signal: AbortSignal,
  check: () => void,
  selection?: CreationHistorySummary,
) {
  check();
  const binding = parseProposalSubmissionBinding(input);
  const slot = key(binding, digest);
  const expected = selection ? JSON.stringify(selection) : undefined;
  const candidate = await inBrowserStores<CreationHistoryCandidate | null>(
    layout,
    'readonly',
    signal,
    () => null,
    (context) => {
      readBrowserPair(context, slot, (raw, index, exists) => {
        check();
        if (!exists) {
          context.accept(null);
          return;
        }
        if (expected !== undefined && index !== expected) throw new TypeError();
        context.accept(pair(raw, index, binding, slot));
      });
    },
  );
  check();
  return candidate ? inspectCreationHistory(candidate.raw, binding, check) : null;
}
export async function listCreationHistory(
  input: ProposalSubmissionBinding,
  after: string | null,
  signal: AbortSignal,
  check: () => void,
): Promise<CreationHistoryPage> {
  check();
  const binding = parseProposalSubmissionBinding(input);
  key(binding, '0'.repeat(64));
  const prefix = proposalOriginalStoragePrefix(binding);
  const lower = after === null ? prefix : key(binding, after);
  const page = await inBrowserStores<{ entries: CreationHistoryCandidate[]; next: string | null }>(
    layout,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: CreationHistoryCandidate[] = [];
      const request = context.directory.openKeyCursor(
        IDBKeyRange.bound(lower, prefix + '\uffff', after !== null, true),
      );
      request.onsuccess = context.guard(() => {
        check();
        const cursor = request.result;
        if (!cursor) {
          context.accept({ entries, next: null });
          return;
        }
        // Read only the lookahead key; it is not a verified observation in this page.
        if (entries.length === CREATION_HISTORY_PAGE_SIZE) {
          context.accept({ entries, next: entries[entries.length - 1]!.file.document_sha256 });
          return;
        }
        const slot = cursor.primaryKey;
        if (typeof slot !== 'string' || new TextEncoder().encode(slot).byteLength > 16384)
          throw new TypeError();
        readBrowserPair(context, slot, (raw, index, exists) => {
          check();
          if (!exists) throw new TypeError();
          entries.push(pair(raw, index, binding, slot));
          cursor.continue();
        });
      });
    },
  );
  const entries: CreationHistorySummary[] = [];
  for (const candidate of page.entries) {
    check();
    entries.push(summary((await inspectCreationHistory(candidate.raw, binding, check)).file));
  }
  check();
  return { entries, next: page.next };
}
/** Only a fully inspected browser copy qualifies in the UI; recheck exact pairs before deletion. */
export async function removeCreationHistory(
  raw: string,
  input: ProposalSubmissionBinding,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const binding = parseProposalSubmissionBinding(input);
  const reviewed = await inspectCreationHistory(raw, binding, check);
  check();
  const slot = key(binding, reviewed.file.document_sha256);
  const expectedIndex = JSON.stringify(summary(reviewed.file));
  return inBrowserStores<BrowserRemovalResult>(
    layout,
    'readwrite',
    signal,
    () => 'not-present',
    (context) => {
      readBrowserPair(context, slot, (stored, index, exists) => {
        check();
        if (!exists) {
          context.accept('not-present');
          return;
        }
        pair(stored, index, binding, slot);
        if (stored !== reviewed.raw || index !== expectedIndex) throw new TypeError();
        check();
        removeBrowserPair(context, slot);
      });
    },
    { create: false },
  );
}
