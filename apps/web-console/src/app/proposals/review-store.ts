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
  decodeReviewOriginal,
  encodeReviewOriginal,
  REVIEW_ORIGINAL_BYTES,
  type ProposalReviewOriginal,
} from './review-model';
import {
  REVIEW_BACKUP_DOCUMENT_BYTES,
  REVIEW_BACKUP_FILE_BYTES,
  REVIEW_BACKUP_MAX_ENTRIES,
  reviewBackupDocumentJson,
  reviewBackupFileJson,
  parseReviewBackupFile,
  parseReviewBackupDocument,
  type ReviewBackupDocument,
} from './review-backup-model';
import { createSavedCopyCleanup } from './saved-copy-cleanup';

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
/** Only remove the immutable browser pair whose complete original was inspected. */
export function removeReviewOriginal(
  bindingInput: ProposalSubmissionBinding,
  reviewed: ProposalReviewOriginal,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(bindingInput);
  const expectedRaw = encodeReviewOriginal(reviewed);
  const original = decodeReviewOriginal(expectedRaw);
  assertProposalSubmissionBinding(original.binding, binding);
  const slot = key(binding, original.request_key);
  const expectedIndex = JSON.stringify(summary(original));
  return inBrowserStores<BrowserRemovalResult>(
    layout,
    'readwrite',
    signal,
    () => 'not-present',
    (context) => {
      readBrowserPair(context, slot, (raw, index, exists) => {
        if (!exists) {
          context.accept('not-present');
          return;
        }
        pair(raw, index, binding, slot);
        if (raw !== expectedRaw || index !== expectedIndex) throw new TypeError();
        removeBrowserPair(context, slot);
      });
    },
    { create: false },
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

/** Count both stores and verify every pair in a single scoped snapshot; never truncate. */
export function readReviewBackup(
  bindingInput: ProposalSubmissionBinding,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const binding = parseProposalSubmissionBinding(bindingInput);
  key(binding, 'a');
  const prefix = proposalOriginalStoragePrefix(binding);
  const empty = (): ReviewBackupDocument => ({
    schema_version: 1,
    kind: 'proposal-review-originals-backup',
    binding,
    entries: [],
  });
  return inBrowserStores<ReviewBackupDocument>(layout, 'readonly', signal, empty, (context) => {
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, true);
    const originals = context.content.count(range);
    const directory = context.directory.count(range);
    directory.onsuccess = context.guard(() => {
      check();
      const count = originals.result;
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > REVIEW_BACKUP_MAX_ENTRIES ||
        directory.result !== count
      )
        throw new TypeError();
      const entries: ProposalReviewOriginal[] = [];
      const account = backupReadBudget();
      const request = context.content.openKeyCursor(range);
      request.onsuccess = context.guard(() => {
        check();
        const cursor = request.result;
        if (!cursor) {
          if (entries.length !== count) throw new TypeError();
          context.accept(parseReviewBackupDocument({ ...empty(), entries }));
          return;
        }
        const slot = cursor.primaryKey;
        if (
          entries.length >= count ||
          typeof slot !== 'string' ||
          new TextEncoder().encode(slot).byteLength > 16384
        )
          throw new TypeError();
        readBrowserPair(context, slot, (raw, index, exists) => {
          if (!exists) throw new TypeError();
          account(raw, index);
          entries.push(pair(raw, index, binding, slot));
          cursor.continue();
        });
      });
    });
  });
}

/** Bounds parsed target content per complete pass, even when it differs from the source. */
function backupReadBudget() {
  let bytes = 0;
  return (raw: unknown, index: unknown) => {
    if (
      typeof raw !== 'string' ||
      raw.length > REVIEW_ORIGINAL_BYTES ||
      typeof index !== 'string' ||
      index.length > 4096
    )
      throw new TypeError();
    const size = new TextEncoder().encode(raw).byteLength;
    if (size > REVIEW_ORIGINAL_BYTES || new TextEncoder().encode(index).byteLength > 4096)
      throw new TypeError();
    bytes += size;
    if (bytes > REVIEW_BACKUP_DOCUMENT_BYTES) throw new TypeError();
  };
}
export const reviewOriginalCleanup = createSavedCopyCleanup<
  ProposalReviewOriginal,
  SavedReview,
  ReviewBackupDocument
>({
  layout,
  kind: 'proposal-review-originals-backup',
  documentBytes: REVIEW_BACKUP_DOCUMENT_BYTES,
  fileBytes: REVIEW_BACKUP_FILE_BYTES,
  key,
  pair,
  encode: encodeReviewOriginal,
  summary,
  readBudget: backupReadBudget,
  parseDocument: parseReviewBackupDocument,
  documentJson: reviewBackupDocumentJson,
  parseFile: parseReviewBackupFile,
  fileJson: reviewBackupFileJson,
});
type ReviewBackupState = 'missing' | 'same' | 'different';
export interface ReviewBackupComparison {
  entries: Array<{
    request_key: string;
    proposal_id: string;
    decision: SavedReview['decision'];
    expected_revision: number;
    state: ReviewBackupState;
  }>;
  missing: number;
  same: number;
  different: number;
  can_restore: boolean;
}
export interface ReviewBackupRestoreResult {
  total: number;
  added: number;
  already_present: number;
}
function backupEntries(input: ReviewBackupDocument) {
  const document = parseReviewBackupDocument(input);
  return document.entries.map((original) => ({
    original,
    slot: key(document.binding, original.request_key),
    raw: encodeReviewOriginal(original),
    index: JSON.stringify(summary(original)),
  }));
}
function backupEntryState(
  item: ReturnType<typeof backupEntries>[number],
  raw: unknown,
  index: unknown,
  exists: boolean,
): ReviewBackupState {
  if (!exists) return 'missing';
  pair(raw, index, item.original.binding, item.slot);
  return raw === item.raw && index === item.index ? 'same' : 'different';
}
function backupComparison(entries: ReviewBackupComparison['entries']): ReviewBackupComparison {
  const missing = entries.filter((entry) => entry.state === 'missing').length;
  const same = entries.filter((entry) => entry.state === 'same').length;
  const different = entries.filter((entry) => entry.state === 'different').length;
  return { entries, missing, same, different, can_restore: different === 0 };
}
/** Advisory only. Damaged/partial targets reject the entire comparison. */
export function compareReviewBackup(
  input: ReviewBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const prepared = backupEntries(input);
  check();
  if (!prepared.length) return Promise.resolve(backupComparison([]));
  return inBrowserStores<ReviewBackupComparison>(
    layout,
    'readonly',
    signal,
    () =>
      backupComparison(
        prepared.map(({ original }) => ({
          request_key: original.request_key,
          proposal_id: original.proposal_id,
          decision: original.decision,
          expected_revision: original.expected_revision,
          state: 'missing' as const,
        })),
      ),
    (context) => {
      const entries: ReviewBackupComparison['entries'] = [];
      const account = backupReadBudget();
      const next = () => {
        check();
        const item = prepared[entries.length];
        if (!item) {
          context.accept(backupComparison(entries));
          return;
        }
        readBrowserPair(context, item.slot, (raw, index, exists) => {
          if (exists) account(raw, index);
          entries.push({
            request_key: item.original.request_key,
            proposal_id: item.original.proposal_id,
            decision: item.original.decision,
            expected_revision: item.original.expected_revision,
            state: backupEntryState(item, raw, index, exists),
          });
          next();
        });
      };
      next();
    },
  );
}
/** Complete preflight, missing-only writes and full readback share one transaction. */
export function restoreReviewBackup(
  input: ReviewBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const prepared = backupEntries(input);
  check();
  if (!prepared.length) return Promise.resolve({ total: 0, added: 0, already_present: 0 });
  return inBrowserStores<ReviewBackupRestoreResult>(
    layout,
    'readwrite',
    signal,
    () => {
      throw new TypeError();
    },
    (context) => {
      const missing: typeof prepared = [];
      const preflightBudget = backupReadBudget();
      const verificationBudget = backupReadBudget();
      let inspected = 0;
      let verified = 0;
      const verify = () => {
        check();
        const item = prepared[verified];
        if (!item) {
          context.accept({
            total: prepared.length,
            added: missing.length,
            already_present: prepared.length - missing.length,
          });
          return;
        }
        readBrowserPair(context, item.slot, (raw, index, exists) => {
          if (!exists) throw new TypeError();
          verificationBudget(raw, index);
          if (backupEntryState(item, raw, index, exists) !== 'same') throw new TypeError();
          verified += 1;
          verify();
        });
      };
      const inspect = () => {
        check();
        const item = prepared[inspected];
        if (!item) {
          for (const absent of missing) {
            check();
            context.content.add(absent.raw, absent.slot);
            context.directory.add(absent.index, absent.slot);
          }
          // All adds are queued before readback; any failure aborts every write.
          verify();
          return;
        }
        readBrowserPair(context, item.slot, (raw, index, exists) => {
          if (exists) preflightBudget(raw, index);
          const state = backupEntryState(item, raw, index, exists);
          if (state === 'missing') missing.push(item);
          else if (state !== 'same') throw new TypeError();
          inspected += 1;
          inspect();
        });
      };
      inspect();
    },
  );
}
