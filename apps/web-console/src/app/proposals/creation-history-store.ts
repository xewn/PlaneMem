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
import {
  CREATION_HISTORY_BACKUP_DOCUMENT_BYTES,
  CREATION_HISTORY_BACKUP_MAX_ENTRIES,
  parseCreationHistoryBackupDocument,
  type CreationHistoryBackupDocument,
} from './creation-history-backup-model';

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

/** Verify every digest outside transactions; keep original observation times and traces. */
export async function verifyCreationHistoryBackup(
  input: CreationHistoryBackupDocument,
  check: () => void,
) {
  check();
  const document = parseCreationHistoryBackupDocument(input);
  for (const file of document.entries) {
    check();
    await inspectCreationHistory(creationHistoryFileJson(file), document.binding, check);
  }
  check();
  return document;
}

function backupReadBudget() {
  let bytes = 0;
  return (raw: unknown, index: unknown) => {
    if (
      typeof raw !== 'string' ||
      raw.length > CREATION_HISTORY_FILE_BYTES ||
      typeof index !== 'string' ||
      index.length > 4096
    )
      throw new TypeError();
    const size = new TextEncoder().encode(raw).byteLength;
    if (size > CREATION_HISTORY_FILE_BYTES || new TextEncoder().encode(index).byteLength > 4096)
      throw new TypeError();
    bytes += size;
    if (bytes > CREATION_HISTORY_BACKUP_DOCUMENT_BYTES) throw new TypeError();
  };
}

/** A complete scoped snapshot: counts and all pairs share one read transaction. */
export async function readCreationHistoryBackup(
  input: ProposalSubmissionBinding,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const binding = parseProposalSubmissionBinding(input);
  key(binding, '0'.repeat(64));
  const prefix = proposalOriginalStoragePrefix(binding);
  const empty = (): CreationHistoryBackupDocument => ({
    schema_version: 1,
    kind: 'proposal-creation-history-backup',
    binding,
    entries: [],
  });
  const document = await inBrowserStores<CreationHistoryBackupDocument>(
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
          count > CREATION_HISTORY_BACKUP_MAX_ENTRIES ||
          directory.result !== count
        )
          throw new TypeError();
        const entries: CreationHistoryFile[] = [];
        const account = backupReadBudget();
        const request = context.content.openKeyCursor(range);
        request.onsuccess = context.guard(() => {
          check();
          const cursor = request.result;
          if (!cursor) {
            if (entries.length !== count) throw new TypeError();
            context.accept(parseCreationHistoryBackupDocument({ ...empty(), entries }));
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
  return verifyCreationHistoryBackup(document, check);
}

type CreationHistoryBackupState = 'missing' | 'same' | 'different';
export interface CreationHistoryBackupComparison {
  entries: Array<CreationHistorySummary & { state: CreationHistoryBackupState }>;
  missing: number;
  same: number;
  different: number;
  can_restore: boolean;
}
export interface CreationHistoryBackupRestoreResult {
  total: number;
  added: number;
  already_present: number;
}
async function backupEntries(input: CreationHistoryBackupDocument, check: () => void) {
  const document = await verifyCreationHistoryBackup(input, check);
  return document.entries.map((file) => ({
    file,
    slot: key(document.binding, file.document_sha256),
    raw: creationHistoryFileJson(file),
    index: JSON.stringify(summary(file)),
  }));
}

function backupEntryState(
  item: Awaited<ReturnType<typeof backupEntries>>[number],
  raw: unknown,
  index: unknown,
  exists: boolean,
): CreationHistoryBackupState {
  if (!exists) return 'missing';
  pair(raw, index, item.file.document.original.binding, item.slot);
  // Exact equality to a hash-verified incoming file proves an identical target's digest too.
  // Different content at this digest is a conflict, never a trusted alternate observation.
  return raw === item.raw && index === item.index ? 'same' : 'different';
}
function backupComparison(
  entries: CreationHistoryBackupComparison['entries'],
): CreationHistoryBackupComparison {
  const missing = entries.filter((entry) => entry.state === 'missing').length;
  const same = entries.filter((entry) => entry.state === 'same').length;
  const different = entries.filter((entry) => entry.state === 'different').length;
  return { entries, missing, same, different, can_restore: different === 0 };
}
export async function compareCreationHistoryBackup(
  input: CreationHistoryBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  const prepared = await backupEntries(input, check);
  check();
  if (!prepared.length) return backupComparison([]);
  return inBrowserStores<CreationHistoryBackupComparison>(
    layout,
    'readonly',
    signal,
    () =>
      backupComparison(
        prepared.map(({ file }) => ({ ...summary(file), state: 'missing' as const })),
      ),
    (context) => {
      const entries: CreationHistoryBackupComparison['entries'] = [];
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
export async function restoreCreationHistoryBackup(
  input: CreationHistoryBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  const prepared = await backupEntries(input, check);
  check();
  if (!prepared.length) return { total: 0, added: 0, already_present: 0 };
  return inBrowserStores<CreationHistoryBackupRestoreResult>(
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
