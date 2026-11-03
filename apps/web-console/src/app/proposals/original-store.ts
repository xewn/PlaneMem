'use client';

import { proposalKinds, type Classification, type ProposalKind } from '@planemem/contracts';
import { inBrowserStores, readBrowserPair } from '../sync/receipt/browser-store';
import {
  parseProposalBackupDocument,
  PROPOSAL_BACKUP_MAX_ENTRIES,
  PROPOSAL_BACKUP_DOCUMENT_BYTES,
  type ProposalBackupDocument,
} from './backup-model';
import {
  assertProposalSubmissionBinding,
  decodeProposalOriginal,
  encodeProposalOriginal,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  proposalOriginalStoragePrefix,
  PROPOSAL_ORIGINAL_BYTES,
  type ProposalOriginal,
  type ProposalSubmissionBinding,
} from './original-model';

const database = { databaseName: 'planemem-proposal-originals', contentStore: 'originals' };
const keyBytes = 16 * 1024;
const metadataBytes = 4 * 1024;
const pageSize = 20;

interface OriginalMetadata {
  schema_version: 1;
  request_key: string;
  title: string;
  kind: ProposalKind;
  classification: Classification;
  original_bytes: number;
}
export interface SavedProposalOriginal {
  key: string;
  metadata: OriginalMetadata;
}
export interface SavedProposalOriginalPage {
  entries: SavedProposalOriginal[];
  next: string | null;
}
function unavailable() {
  return new Error('The browser original could not be confirmed. Keep every original copy.');
}
function bytes(raw: string) {
  return new TextEncoder().encode(raw).byteLength;
}
function checkedKey(value: unknown, binding: ProposalSubmissionBinding) {
  const prefix = proposalOriginalStoragePrefix(binding);
  if (
    typeof value !== 'string' ||
    value.length > keyBytes ||
    bytes(value) > keyBytes ||
    !value.startsWith(prefix) ||
    !value.endsWith(']')
  )
    throw unavailable();
  const key: unknown = JSON.parse(value.slice(prefix.length, -1));
  if (typeof key !== 'string' || proposalOriginalStorageKey(binding, key) !== value)
    throw unavailable();
  return value;
}
function metadata(original: ProposalOriginal, raw: string): OriginalMetadata {
  return {
    schema_version: 1,
    request_key: original.request_key,
    title: original.draft.title,
    kind: original.draft.kind,
    classification: original.draft.classification,
    original_bytes: bytes(raw),
  };
}
function readMetadata(
  raw: unknown,
  key: unknown,
  binding: ProposalSubmissionBinding,
): SavedProposalOriginal {
  const checked = checkedKey(key, binding);
  if (typeof raw !== 'string' || raw.length > metadataBytes || bytes(raw) > metadataBytes)
    throw unavailable();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const row = value as Record<string, unknown>;
  const fields = [
    'schema_version',
    'request_key',
    'title',
    'kind',
    'classification',
    'original_bytes',
  ];
  if (
    Object.keys(row).length !== fields.length ||
    Object.keys(row).some((key) => !fields.includes(key)) ||
    row.schema_version !== 1 ||
    typeof row.request_key !== 'string' ||
    typeof row.title !== 'string' ||
    !row.title.trim() ||
    row.title !== row.title.trim() ||
    row.title.length > 300 ||
    /[\u0000\p{Cs}]/u.test(row.title) ||
    !proposalKinds.includes(row.kind as ProposalKind) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(row.classification as string) ||
    typeof row.original_bytes !== 'number' ||
    !Number.isSafeInteger(row.original_bytes) ||
    row.original_bytes < 1 ||
    row.original_bytes > PROPOSAL_ORIGINAL_BYTES ||
    proposalOriginalStorageKey(binding, row.request_key) !== checked
  )
    throw unavailable();
  return {
    key: checked,
    metadata: {
      schema_version: 1,
      request_key: row.request_key,
      title: row.title,
      kind: row.kind as ProposalKind,
      classification: row.classification as Classification,
      original_bytes: row.original_bytes,
    },
  };
}
function readOriginal(
  raw: unknown,
  summary: unknown,
  key: string,
  binding: ProposalSubmissionBinding,
) {
  const entry = readMetadata(summary, key, binding);
  const original = decodeProposalOriginal(raw);
  const encoded = encodeProposalOriginal(original);
  assertProposalSubmissionBinding(original.binding, binding);
  if (
    encoded !== raw ||
    proposalOriginalStorageKey(binding, original.request_key) !== key ||
    JSON.stringify(metadata(original, encoded)) !== JSON.stringify(entry.metadata)
  )
    throw unavailable();
  return original;
}

/** Reading an old exact slot never migrates, overwrites or deletes it. */
export function loadLegacyProposalOriginal(binding: ProposalSubmissionBinding, requestKey: string) {
  const key = proposalOriginalStorageKey(binding, requestKey);
  const raw = sessionStorage.getItem(key);
  if (raw === null) return null;
  const original = decodeProposalOriginal(raw);
  assertProposalSubmissionBinding(original.binding, binding);
  if (original.request_key !== requestKey) throw unavailable();
  return original;
}
function checkLegacy(original: ProposalOriginal, raw: string) {
  const legacy = loadLegacyProposalOriginal(original.binding, original.request_key);
  if (legacy && encodeProposalOriginal(legacy) !== raw) throw unavailable();
}

/** Never replace either slot. Cross-tab saves serialize; resolve only after committed read-back. */
export async function preserveBrowserProposalOriginal(
  input: ProposalOriginal,
  signal: AbortSignal,
) {
  const raw = encodeProposalOriginal(input);
  const original = decodeProposalOriginal(raw);
  const key = proposalOriginalStorageKey(original.binding, original.request_key);
  const summary = JSON.stringify(metadata(original, raw));
  readMetadata(summary, key, original.binding);
  checkLegacy(original, raw);
  await inBrowserStores<void>(
    database,
    'readwrite',
    signal,
    () => {
      throw unavailable();
    },
    (context) => {
      readBrowserPair(context, key, (existing, index, present) => {
        checkLegacy(original, raw);
        if (present) {
          if (encodeProposalOriginal(readOriginal(existing, index, key, original.binding)) !== raw)
            throw unavailable();
          context.accept(undefined);
          return;
        }
        context.content.add(raw, key);
        context.directory.add(summary, key);
        readBrowserPair(context, key, (saved, savedIndex, exists) => {
          if (
            !exists ||
            encodeProposalOriginal(readOriginal(saved, savedIndex, key, original.binding)) !== raw
          )
            throw unavailable();
          context.accept(undefined);
        });
      });
    },
  );
  if (signal.aborted) throw unavailable();
  checkLegacy(original, raw);
}

/** A selected directory row must still describe the complete original when it is opened. */
export function loadBrowserProposalOriginal(
  input: ProposalSubmissionBinding,
  requestKey: string,
  signal: AbortSignal,
  selection?: SavedProposalOriginal,
) {
  const binding = parseProposalSubmissionBinding(input);
  const key = checkedKey(proposalOriginalStorageKey(binding, requestKey), binding);
  const selected =
    selection === undefined
      ? undefined
      : readMetadata(JSON.stringify(selection.metadata), selection.key, binding);
  if (selected && selected.key !== key) throw unavailable();
  return inBrowserStores<ProposalOriginal | null>(
    database,
    'readonly',
    signal,
    () => null,
    (context) => {
      readBrowserPair(context, key, (raw, summary, present) => {
        if (!present) {
          context.accept(null);
          return;
        }
        const original = readOriginal(raw, summary, key, binding);
        if (
          selected &&
          JSON.stringify(metadata(original, encodeProposalOriginal(original))) !==
            JSON.stringify(selected.metadata)
        )
          throw unavailable();
        context.accept(original);
      });
    },
  );
}

/** Metadata-only, scope-bound keyset page; no full-content or remote-outcome claim. */
export function listBrowserProposalOriginals(
  input: ProposalSubmissionBinding,
  after: string | null,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(input);
  const prefix = proposalOriginalStoragePrefix(binding);
  // Bound even empty-directory queries before touching browser storage.
  checkedKey(proposalOriginalStorageKey(binding, 'a'), binding);
  if (after !== null) checkedKey(after, binding);
  return inBrowserStores<SavedProposalOriginalPage>(
    database,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: SavedProposalOriginal[] = [];
      const range = IDBKeyRange.bound(after ?? prefix, prefix + '\uffff', after !== null, true);
      const request = context.directory.openCursor(range);
      request.onsuccess = context.guard(() => {
        const cursor = request.result;
        if (!cursor) {
          context.accept({ entries, next: null });
          return;
        }
        const entry = readMetadata(cursor.value as unknown, cursor.primaryKey, binding);
        if (entries.length === pageSize) {
          context.accept({ entries, next: entries[entries.length - 1]!.key });
          return;
        }
        entries.push(entry);
        cursor.continue();
      });
    },
  );
}

/** Complete scoped snapshot: equal counts plus a verified pair for every content key. */
export function readBrowserProposalBackup(input: ProposalSubmissionBinding, signal: AbortSignal) {
  const binding = parseProposalSubmissionBinding(input);
  checkedKey(proposalOriginalStorageKey(binding, 'a'), binding);
  const prefix = proposalOriginalStoragePrefix(binding);
  const empty = (): ProposalBackupDocument => ({
    schema_version: 1,
    kind: 'proposal-originals-backup',
    binding,
    entries: [],
  });
  return inBrowserStores<ProposalBackupDocument>(database, 'readonly', signal, empty, (context) => {
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, true);
    const originals = context.content.count(range);
    const directory = context.directory.count(range);
    directory.onsuccess = context.guard(() => {
      const count = originals.result;
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > PROPOSAL_BACKUP_MAX_ENTRIES ||
        directory.result !== count
      )
        throw unavailable();
      const entries: ProposalOriginal[] = [];
      let totalBytes = 0;
      const request = context.content.openKeyCursor(range);
      request.onsuccess = context.guard(() => {
        const cursor = request.result;
        if (!cursor) {
          if (entries.length !== count) throw unavailable();
          context.accept(parseProposalBackupDocument({ ...empty(), entries }));
          return;
        }
        if (entries.length >= count) throw unavailable();
        const key = checkedKey(cursor.primaryKey, binding);
        readBrowserPair(context, key, (raw, summary, present) => {
          if (!present || typeof raw !== 'string' || raw.length > PROPOSAL_ORIGINAL_BYTES)
            throw unavailable();
          totalBytes += bytes(raw);
          if (totalBytes > PROPOSAL_BACKUP_DOCUMENT_BYTES) throw unavailable();
          entries.push(readOriginal(raw, summary, key, binding));
          cursor.continue();
        });
      });
    });
  });
}

type BackupEntryState = 'missing' | 'same' | 'different' | 'blocked';
export interface ProposalBackupComparison {
  entries: Array<{ request_key: string; title: string; state: BackupEntryState }>;
  total: number;
  missing: number;
  same: number;
  different: number;
  blocked: number;
  can_restore: boolean;
}
export interface ProposalBackupRestoreResult {
  total: number;
  added: number;
  already_present: number;
}
function backupEntries(document: ProposalBackupDocument) {
  return document.entries.map((original) => {
    const raw = encodeProposalOriginal(original);
    const key = proposalOriginalStorageKey(document.binding, original.request_key);
    const summary = JSON.stringify(metadata(original, raw));
    readMetadata(summary, key, document.binding);
    return { original, raw, key, summary };
  });
}
type BackupEntry = ReturnType<typeof backupEntries>[number];
function legacyBackupState(item: BackupEntry): 'different' | 'blocked' | null {
  try {
    const legacy = loadLegacyProposalOriginal(item.original.binding, item.original.request_key);
    return legacy && encodeProposalOriginal(legacy) !== item.raw ? 'different' : null;
  } catch {
    return 'blocked';
  }
}
function compareBackupEntry(
  item: BackupEntry,
  raw: unknown,
  summary: unknown,
  present: boolean,
): BackupEntryState {
  const legacy = legacyBackupState(item);
  if (legacy) return legacy;
  if (!present) return 'missing';
  try {
    return encodeProposalOriginal(readOriginal(raw, summary, item.key, item.original.binding)) ===
      item.raw
      ? 'same'
      : 'different';
  } catch {
    return 'blocked';
  }
}
function comparison(entries: ProposalBackupComparison['entries']): ProposalBackupComparison {
  const missing = entries.filter((entry) => entry.state === 'missing').length;
  const same = entries.filter((entry) => entry.state === 'same').length;
  const different = entries.filter((entry) => entry.state === 'different').length;
  const blocked = entries.filter((entry) => entry.state === 'blocked').length;
  return {
    entries,
    total: entries.length,
    missing,
    same,
    different,
    blocked,
    can_restore: different === 0 && blocked === 0,
  };
}
/** Advisory comparison only. No database initialization, migration or writes. */
export function previewBrowserProposalBackup(
  input: ProposalBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const prepared = backupEntries(parseProposalBackupDocument(input));
  check();
  const missing = () =>
    comparison(
      prepared.map((item) => ({
        request_key: item.original.request_key,
        title: item.original.draft.title,
        state: compareBackupEntry(item, undefined, undefined, false),
      })),
    );
  if (!prepared.length) return Promise.resolve(comparison([]));
  return inBrowserStores<ProposalBackupComparison>(
    database,
    'readonly',
    signal,
    missing,
    (context) => {
      const entries: ProposalBackupComparison['entries'] = [];
      const inspectNext = () => {
        check();
        const item = prepared[entries.length];
        if (!item) {
          context.accept(comparison(entries));
          return;
        }
        readBrowserPair(context, item.key, (raw, summary, present) => {
          entries.push({
            request_key: item.original.request_key,
            title: item.original.draft.title,
            state: compareBackupEntry(item, raw, summary, present),
          });
          inspectNext();
        });
      };
      inspectNext();
    },
  );
}

/** File adapter verifies the digest. Entire preflight and all writes share one transaction. */
export async function restoreBrowserProposalBackup(
  input: ProposalBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const prepared = backupEntries(parseProposalBackupDocument(input));
  check();
  for (const item of prepared) if (legacyBackupState(item) !== null) throw unavailable();
  if (!prepared.length) return { total: 0, added: 0, already_present: 0 };
  const result = await inBrowserStores<ProposalBackupRestoreResult>(
    database,
    'readwrite',
    signal,
    () => {
      throw unavailable();
    },
    (context) => {
      const missing: BackupEntry[] = [];
      let inspected = 0;
      let written = 0;
      let verified = 0;
      const verifyNext = () => {
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
        readBrowserPair(context, item.key, (raw, summary, present) => {
          if (compareBackupEntry(item, raw, summary, present) !== 'same') throw unavailable();
          verified += 1;
          verifyNext();
        });
      };
      const writeNext = () => {
        check();
        const item = missing[written];
        if (!item) {
          verifyNext();
          return;
        }
        if (legacyBackupState(item) !== null) throw unavailable();
        context.content.add(item.raw, item.key);
        context.directory.add(item.summary, item.key);
        // Queued synchronously after add; failure anywhere aborts the entire import.
        readBrowserPair(context, item.key, (raw, summary, present) => {
          if (compareBackupEntry(item, raw, summary, present) !== 'same') throw unavailable();
          written += 1;
          writeNext();
        });
      };
      const inspectNext = () => {
        check();
        const item = prepared[inspected];
        if (!item) {
          writeNext();
          return;
        }
        readBrowserPair(context, item.key, (raw, summary, present) => {
          const state = compareBackupEntry(item, raw, summary, present);
          if (state === 'missing') missing.push(item);
          else if (state !== 'same') throw unavailable();
          inspected += 1;
          inspectNext();
        });
      };
      inspectNext();
    },
  );
  check();
  for (const item of prepared) if (legacyBackupState(item) !== null) throw unavailable();
  return result;
}
