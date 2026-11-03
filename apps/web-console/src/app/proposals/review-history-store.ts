'use client';

import { backupHash } from '../sync/receipt/backup-operation';
import { inBrowserStores, readBrowserPair } from '../sync/receipt/browser-store';
import {
  assertProposalSubmissionBinding,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  proposalOriginalStoragePrefix,
  type ProposalSubmissionBinding,
} from './original-model';
import {
  REVIEW_HISTORY_FILE_BYTES,
  parseReviewHistoryFile,
  reviewHistoryFileJson,
  reviewObservationJson,
  reviewObservationStatus,
  type ReviewHistoryFile,
  type ReviewObservation,
} from './review-history-model';
import {
  REVIEW_HISTORY_BACKUP_DOCUMENT_BYTES,
  REVIEW_HISTORY_BACKUP_MAX_ENTRIES,
  parseReviewHistoryBackupDocument,
  type ReviewHistoryBackupDocument,
} from './review-history-backup-model';

const layout = { databaseName: 'planemem-proposal-review-history', contentStore: 'observations' };
export interface ReviewHistoryCandidate {
  file: ReviewHistoryFile;
  raw: string;
}
const summary = (file: ReviewHistoryFile) => ({
  digest: file.document_sha256,
  request_key: file.document.original.request_key,
  proposal_id: file.document.original.proposal_id,
  observed_at: file.document.observed_at,
  source: file.document.source,
  status: reviewObservationStatus(file.document),
});
export type ReviewHistorySummary = ReturnType<typeof summary>;
export interface ReviewHistoryPage {
  entries: ReviewHistorySummary[];
  next: string | null;
}
function key(binding: ProposalSubmissionBinding, digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError();
  const slot = proposalOriginalStorageKey(binding, digest);
  if (new TextEncoder().encode(slot).byteLength > 16384) throw new TypeError();
  return slot;
}
function decode(raw: unknown) {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > REVIEW_HISTORY_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > REVIEW_HISTORY_FILE_BYTES
  )
    throw new TypeError();
  return parseReviewHistoryFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
}
export async function prepareReviewHistory(
  document: ReviewObservation,
  check: () => void,
): Promise<ReviewHistoryCandidate> {
  check();
  const raw = reviewObservationJson(document);
  const document_sha256 = await backupHash(raw);
  check();
  const file = parseReviewHistoryFile({ document: JSON.parse(raw), document_sha256 });
  return { file, raw: reviewHistoryFileJson(file) };
}
export async function inspectReviewHistory(
  raw: string,
  binding: ProposalSubmissionBinding,
  check: () => void,
): Promise<ReviewHistoryCandidate> {
  check();
  const file = decode(raw);
  assertProposalSubmissionBinding(file.document.original.binding, binding);
  const digest = await backupHash(reviewObservationJson(file.document));
  check();
  if (digest !== file.document_sha256) throw new TypeError();
  key(binding, digest);
  return { file, raw: reviewHistoryFileJson(file) };
}
function pair(raw: unknown, index: unknown, binding: ProposalSubmissionBinding, slot: string) {
  if (
    typeof index !== 'string' ||
    index.length > 4096 ||
    new TextEncoder().encode(index).byteLength > 4096
  )
    throw new TypeError();
  const file = decode(raw);
  assertProposalSubmissionBinding(file.document.original.binding, binding);
  if (
    reviewHistoryFileJson(file) !== raw ||
    key(binding, file.document_sha256) !== slot ||
    JSON.stringify(summary(file)) !== index
  )
    throw new TypeError();
  return { file, raw: raw as string };
}
/** Hashing finishes before a write transaction; exact content is rechecked within the transaction. */
export async function saveReviewHistory(
  raw: string,
  binding: ProposalSubmissionBinding,
  signal: AbortSignal,
  check: () => void,
) {
  const candidate = await inspectReviewHistory(raw, binding, check);
  check();
  const slot = key(binding, candidate.file.document_sha256);
  return inBrowserStores<ReviewHistoryCandidate>(
    layout,
    'readwrite',
    signal,
    () => {
      throw new TypeError();
    },
    (context) => {
      readBrowserPair(context, slot, (old, index, exists) => {
        if (exists) {
          const saved = pair(old, index, binding, slot);
          if (saved.raw !== candidate.raw) throw new TypeError();
          context.accept(saved);
          return;
        }
        context.content.add(candidate.raw, slot);
        context.directory.add(JSON.stringify(summary(candidate.file)), slot);
        readBrowserPair(context, slot, (saved, metadata, present) => {
          if (!present || saved !== candidate.raw) throw new TypeError();
          context.accept(pair(saved, metadata, binding, slot));
        });
      });
    },
  );
}
export async function loadReviewHistory(
  input: ProposalSubmissionBinding,
  digest: string,
  signal: AbortSignal,
  check: () => void,
  selected?: ReviewHistorySummary,
) {
  check();
  const binding = parseProposalSubmissionBinding(input);
  const slot = key(binding, digest);
  const expected = selected ? JSON.stringify(selected) : undefined;
  const candidate = await inBrowserStores<ReviewHistoryCandidate | null>(
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
  check();
  return candidate ? inspectReviewHistory(candidate.raw, binding, check) : null;
}
/** Read a bounded consistent page, then verify every content digest before exposing it. */
export async function listReviewHistory(
  input: ProposalSubmissionBinding,
  after: string | null,
  signal: AbortSignal,
  check: () => void,
): Promise<ReviewHistoryPage> {
  check();
  const binding = parseProposalSubmissionBinding(input);
  key(binding, '0'.repeat(64));
  const prefix = proposalOriginalStoragePrefix(binding);
  const page = await inBrowserStores<{ entries: ReviewHistoryCandidate[]; next: string | null }>(
    layout,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: ReviewHistoryCandidate[] = [];
      const request = context.directory.openCursor(
        IDBKeyRange.bound(
          after === null ? prefix : key(binding, after),
          prefix + '\uffff',
          after !== null,
          true,
        ),
      );
      request.onsuccess = context.guard(() => {
        check();
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
          context.accept({ entries, next: entries[19]!.file.document_sha256 });
          return;
        }
        const slot = cursor.primaryKey;
        readBrowserPair(context, slot, (raw, index, exists) => {
          if (!exists) throw new TypeError();
          entries.push(pair(raw, index, binding, slot));
          cursor.continue();
        });
      });
    },
  );
  const entries: ReviewHistorySummary[] = [];
  for (const entry of page.entries) {
    check();
    entries.push(summary((await inspectReviewHistory(entry.raw, binding, check)).file));
  }
  check();
  return { entries, next: page.next };
}

/** Verify every digest outside transactions; keep original observation times and traces. */
export async function verifyReviewHistoryBackup(
  input: ReviewHistoryBackupDocument,
  check: () => void,
) {
  check();
  const document = parseReviewHistoryBackupDocument(input);
  for (const file of document.entries) {
    check();
    await inspectReviewHistory(reviewHistoryFileJson(file), document.binding, check);
  }
  check();
  return document;
}

function backupReadBudget() {
  let bytes = 0;
  return (raw: unknown, index: unknown) => {
    if (
      typeof raw !== 'string' ||
      raw.length > REVIEW_HISTORY_FILE_BYTES ||
      typeof index !== 'string' ||
      index.length > 4096
    )
      throw new TypeError();
    const size = new TextEncoder().encode(raw).byteLength;
    if (size > REVIEW_HISTORY_FILE_BYTES || new TextEncoder().encode(index).byteLength > 4096)
      throw new TypeError();
    bytes += size;
    if (bytes > REVIEW_HISTORY_BACKUP_DOCUMENT_BYTES) throw new TypeError();
  };
}

/** A complete scoped snapshot: counts and all pairs share one read transaction. */
export async function readReviewHistoryBackup(
  input: ProposalSubmissionBinding,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const binding = parseProposalSubmissionBinding(input);
  key(binding, '0'.repeat(64));
  const prefix = proposalOriginalStoragePrefix(binding);
  const empty = (): ReviewHistoryBackupDocument => ({
    schema_version: 1,
    kind: 'proposal-review-history-backup',
    binding,
    entries: [],
  });
  const document = await inBrowserStores<ReviewHistoryBackupDocument>(
    layout,
    'readonly',
    signal,
    empty,
    (context) => {
      const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, true);
      const observations = context.content.count(range);
      const directory = context.directory.count(range);
      directory.onsuccess = context.guard(() => {
        check();
        const count = observations.result;
        if (
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > REVIEW_HISTORY_BACKUP_MAX_ENTRIES ||
          directory.result !== count
        )
          throw new TypeError();
        const entries: ReviewHistoryFile[] = [];
        const account = backupReadBudget();
        const request = context.content.openKeyCursor(range);
        request.onsuccess = context.guard(() => {
          check();
          const cursor = request.result;
          if (!cursor) {
            if (entries.length !== count) throw new TypeError();
            context.accept(parseReviewHistoryBackupDocument({ ...empty(), entries }));
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
            entries.push(pair(raw, index, binding, slot).file);
            cursor.continue();
          });
        });
      });
    },
  );
  check();
  return verifyReviewHistoryBackup(document, check);
}

type ReviewHistoryBackupState = 'missing' | 'same' | 'different';
export interface ReviewHistoryBackupComparison {
  entries: Array<ReviewHistorySummary & { state: ReviewHistoryBackupState }>;
  missing: number;
  same: number;
  different: number;
  can_restore: boolean;
}
export interface ReviewHistoryBackupRestoreResult {
  total: number;
  added: number;
  already_present: number;
}
async function backupEntries(input: ReviewHistoryBackupDocument, check: () => void) {
  const document = await verifyReviewHistoryBackup(input, check);
  return document.entries.map((file) => ({
    file,
    slot: key(document.binding, file.document_sha256),
    raw: reviewHistoryFileJson(file),
    index: JSON.stringify(summary(file)),
  }));
}
function backupEntryState(
  item: Awaited<ReturnType<typeof backupEntries>>[number],
  raw: unknown,
  index: unknown,
  exists: boolean,
): ReviewHistoryBackupState {
  if (!exists) return 'missing';
  pair(raw, index, item.file.document.original.binding, item.slot);
  // Exact equality to a hash-verified incoming file proves an identical target's digest too.
  // Different content at this digest is a conflict, never a trusted alternate observation.
  return raw === item.raw && index === item.index ? 'same' : 'different';
}
function backupComparison(
  entries: ReviewHistoryBackupComparison['entries'],
): ReviewHistoryBackupComparison {
  const missing = entries.filter((entry) => entry.state === 'missing').length;
  const same = entries.filter((entry) => entry.state === 'same').length;
  const different = entries.filter((entry) => entry.state === 'different').length;
  return { entries, missing, same, different, can_restore: different === 0 };
}
export async function compareReviewHistoryBackup(
  input: ReviewHistoryBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  const prepared = await backupEntries(input, check);
  check();
  if (!prepared.length) return backupComparison([]);
  return inBrowserStores<ReviewHistoryBackupComparison>(
    layout,
    'readonly',
    signal,
    () =>
      backupComparison(
        prepared.map(({ file }) => ({ ...summary(file), state: 'missing' as const })),
      ),
    (context) => {
      const entries: ReviewHistoryBackupComparison['entries'] = [];
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
            ...summary(item.file),
            state: backupEntryState(item, raw, index, exists),
          });
          next();
        });
      };
      next();
    },
  );
}
/** Hashes finish before opening a write transaction; all targets are rechecked atomically. */
export async function restoreReviewHistoryBackup(
  input: ReviewHistoryBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  const prepared = await backupEntries(input, check);
  check();
  if (!prepared.length) return { total: 0, added: 0, already_present: 0 };
  return inBrowserStores<ReviewHistoryBackupRestoreResult>(
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
