'use client';

import {
  CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES,
  contextPackSaveReceiptDocumentJson,
  contextPackSaveReceiptFileJson,
  parseContextPackSaveReceiptFile,
  parsePackSaveBinding,
  assertPackSaveBinding,
  type ContextPackSaveReceiptDocument,
  type ContextPackSaveReceiptFile,
  type PackSaveBinding,
} from '@planemem/contracts';
import { backupHash } from '../sync/receipt/backup-operation';
import { withPackReceiptHistoryChange } from './save-receipt-changes';
import {
  inBrowserStores,
  readBrowserPair,
  removeBrowserPair,
  type BrowserRemovalResult,
} from '../sync/receipt/browser-store';
import {
  PACK_RECEIPT_HISTORY_PAGE_SIZE,
  PACK_RECEIPT_HISTORY_SCAN_LIMIT,
  matchesPackReceiptHistory,
  parsePackReceiptHistoryQuery,
  type PackReceiptHistoryQuery,
} from './save-receipt-query';
import {
  PACK_RECEIPT_BACKUP_FILE_BYTES,
  PACK_RECEIPT_BACKUP_MAX_ENTRIES,
  packReceiptBackupDocumentJson,
  packReceiptBackupFileJson,
  parsePackReceiptBackupFile,
  type PackReceiptBackupCandidate,
} from './save-receipt-backup-model';

const layout = { databaseName: 'planemem-context-pack-save-history', contentStore: 'observations' };
export interface PackReceiptCandidate {
  file: ContextPackSaveReceiptFile;
  raw: string;
}
export interface PackReceiptHistoryPage {
  query: PackReceiptHistoryQuery;
  entries: PackReceiptCandidate[];
  scanned: number;
  next: PackReceiptHistoryQuery | null;
}
function invalid(): never {
  throw new Error(
    'The complete historical observation could not be confirmed. Keep a separate copy.',
  );
}
function prefix(binding: PackSaveBinding) {
  return (
    'planemem:pack-save-observation:v1:' +
    JSON.stringify([parsePackSaveBinding(binding)]).slice(0, -1) +
    ','
  );
}
function slot(binding: PackSaveBinding, digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) return invalid();
  const key = prefix(binding) + JSON.stringify(digest) + ']';
  if (new TextEncoder().encode(key).byteLength > 16384) return invalid();
  return key;
}
function checkedKey(value: unknown, binding: PackSaveBinding): string {
  const start = prefix(binding);
  if (
    typeof value !== 'string' ||
    value.length > 16384 ||
    !value.startsWith(start) ||
    !value.endsWith(']')
  )
    return invalid();
  const digest: unknown = JSON.parse(value.slice(start.length, -1));
  if (typeof digest !== 'string' || slot(binding, digest) !== value) return invalid();
  return value;
}
function decode(raw: unknown) {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES
  )
    return invalid();
  return parseContextPackSaveReceiptFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
}
export async function preparePackReceiptHistory(
  document: ContextPackSaveReceiptDocument,
  check: () => void,
): Promise<PackReceiptCandidate> {
  check();
  const raw = contextPackSaveReceiptDocumentJson(document);
  const digest = await backupHash(raw);
  check();
  const file = parseContextPackSaveReceiptFile({
    document: JSON.parse(raw),
    document_sha256: digest,
  });
  return { file, raw: contextPackSaveReceiptFileJson(file) };
}
export async function inspectPackReceiptHistory(
  raw: string,
  input: PackSaveBinding,
  check: () => void,
): Promise<PackReceiptCandidate> {
  check();
  const binding = parsePackSaveBinding(input);
  const file = decode(raw);
  assertPackSaveBinding(file.document.original.binding, binding);
  const digest = await backupHash(contextPackSaveReceiptDocumentJson(file.document));
  check();
  if (digest !== file.document_sha256) return invalid();
  slot(binding, digest);
  return { file, raw: contextPackSaveReceiptFileJson(file) };
}
function pair(
  raw: unknown,
  digest: unknown,
  key: string,
  binding: PackSaveBinding,
): PackReceiptCandidate {
  const file = decode(raw);
  assertPackSaveBinding(file.document.original.binding, binding);
  if (
    contextPackSaveReceiptFileJson(file) !== raw ||
    file.document_sha256 !== digest ||
    slot(binding, file.document_sha256) !== checkedKey(key, binding)
  )
    return invalid();
  return { file, raw: raw as string };
}
/** Atomic missing-only insertion. Different observations use different immutable digest slots. */
export async function preservePackReceiptHistory(
  raw: string,
  input: PackSaveBinding,
  signal: AbortSignal,
  check: () => void,
) {
  const binding = parsePackSaveBinding(input);
  const candidate = await inspectPackReceiptHistory(raw, binding, check);
  const key = slot(binding, candidate.file.document_sha256);
  return withPackReceiptHistoryChange(binding, async () => {
    check();
    await inBrowserStores<void>(layout, 'readwrite', signal, invalid, (context) => {
      readBrowserPair(context, key, (saved, digest, exists) => {
        check();
        if (exists) {
          if (pair(saved, digest, key, binding).raw !== candidate.raw) return invalid();
          context.accept(undefined);
          return;
        }
        context.content.add(candidate.raw, key);
        context.directory.add(candidate.file.document_sha256, key);
        readBrowserPair(context, key, (saved, digest, exists) => {
          check();
          if (!exists || pair(saved, digest, key, binding).raw !== candidate.raw) return invalid();
          context.accept(undefined);
        });
      });
    });
    check();
    return candidate;
  });
}
/** Delete only the complete reviewed pair; absence never initializes the history database. */
export async function removePackReceiptHistory(
  raw: string,
  input: PackSaveBinding,
  signal: AbortSignal,
  check: () => void,
): Promise<BrowserRemovalResult> {
  check();
  const binding = parsePackSaveBinding(input);
  const candidate = await inspectPackReceiptHistory(raw, binding, check);
  const key = slot(binding, candidate.file.document_sha256);
  return withPackReceiptHistoryChange(binding, async () => {
    check();
    const result = await inBrowserStores<BrowserRemovalResult>(
      layout,
      'readwrite',
      signal,
      () => 'not-present',
      (context) => {
        readBrowserPair(context, key, (saved, digest, exists) => {
          check();
          if (!exists) {
            context.accept('not-present');
            return;
          }
          if (pair(saved, digest, key, binding).raw !== candidate.raw) return invalid();
          check();
          removeBrowserPair(context, key);
        });
      },
      { create: false },
    );
    check();
    return result;
  });
}
/** Verify every scanned pair, including nonmatches, before returning a bounded filtered page. */
export async function listPackReceiptHistory(
  input: PackSaveBinding,
  queryInput: PackReceiptHistoryQuery,
  signal: AbortSignal,
  check: () => void,
): Promise<PackReceiptHistoryPage> {
  check();
  const binding = parsePackSaveBinding(input);
  const query = parsePackReceiptHistoryQuery(queryInput);
  const { after } = query;
  const start = prefix(binding);
  slot(binding, '0'.repeat(64));
  if (after !== null) checkedKey(after, binding);
  const result = await inBrowserStores<{ entries: PackReceiptCandidate[]; next: string | null }>(
    layout,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: PackReceiptCandidate[] = [];
      let matches = 0;
      let last: string | null = null;
      const request = context.directory.openKeyCursor(
        IDBKeyRange.bound(after ?? start, start + '\uffff', after !== null, true),
      );
      request.onsuccess = context.guard(() => {
        check();
        const cursor = request.result;
        if (!cursor) {
          context.accept({ entries, next: null });
          return;
        }
        const key = checkedKey(cursor.primaryKey, binding);
        if (
          matches === PACK_RECEIPT_HISTORY_PAGE_SIZE ||
          entries.length === PACK_RECEIPT_HISTORY_SCAN_LIMIT
        ) {
          context.accept({ entries, next: last });
          return;
        }
        readBrowserPair(context, key, (raw, digest, exists) => {
          check();
          if (!exists) return invalid();
          const candidate = pair(raw, digest, key, binding);
          entries.push(candidate);
          if (matchesPackReceiptHistory(candidate.file.document, query)) matches += 1;
          last = key;
          cursor.continue();
        });
      });
    },
  );
  check();
  for (const entry of result.entries) {
    check();
    if (
      (await backupHash(contextPackSaveReceiptDocumentJson(entry.file.document))) !==
      entry.file.document_sha256
    )
      return invalid();
    check();
  }
  return {
    query,
    entries: result.entries.filter((entry) =>
      matchesPackReceiptHistory(entry.file.document, query),
    ),
    scanned: result.entries.length,
    next: result.next === null ? null : { ...query, after: result.next },
  };
}

export async function inspectPackReceiptBackup(
  raw: string,
  input: PackSaveBinding,
  check: () => void,
): Promise<PackReceiptBackupCandidate> {
  check();
  const binding = parsePackSaveBinding(input);
  slot(binding, '0'.repeat(64));
  if (
    !raw ||
    raw.length > PACK_RECEIPT_BACKUP_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > PACK_RECEIPT_BACKUP_FILE_BYTES
  )
    return invalid();
  const file = parsePackReceiptBackupFile(JSON.parse(raw.replace(/^\uFEFF/, '')));
  assertPackSaveBinding(file.document.binding, binding);
  if ((await backupHash(packReceiptBackupDocumentJson(file.document))) !== file.document_sha256)
    return invalid();
  check();
  for (const entry of file.document.entries) {
    await inspectPackReceiptHistory(contextPackSaveReceiptFileJson(entry), binding, check);
    check();
  }
  return { file, raw: packReceiptBackupFileJson(file) };
}

/** One complete unfiltered snapshot of both stores; never truncate or join separate list pages. */
export async function preparePackReceiptBackup(
  input: PackSaveBinding,
  signal: AbortSignal,
  check: () => void,
): Promise<PackReceiptBackupCandidate> {
  check();
  const binding = parsePackSaveBinding(input);
  slot(binding, '0'.repeat(64));
  const start = prefix(binding);
  const entries = await inBrowserStores<PackReceiptCandidate[]>(
    layout,
    'readonly',
    signal,
    () => [],
    (context) => {
      const entries: PackReceiptCandidate[] = [];
      const range = IDBKeyRange.bound(start, start + '\uffff', false, true);
      const request = context.content.openKeyCursor(range);
      request.onsuccess = context.guard(() => {
        check();
        const cursor = request.result;
        if (!cursor) {
          // A second scan in this transaction rejects directory-only orphan slots too.
          let position = 0;
          const directory = context.directory.openKeyCursor(range);
          directory.onsuccess = context.guard(() => {
            check();
            const cursor = directory.result;
            if (!cursor) {
              if (position !== entries.length) return invalid();
              context.accept(entries);
              return;
            }
            const expected = entries[position];
            if (
              !expected ||
              checkedKey(cursor.primaryKey, binding) !==
                slot(binding, expected.file.document_sha256)
            )
              return invalid();
            position += 1;
            cursor.continue();
          });
          return;
        }
        if (entries.length === PACK_RECEIPT_BACKUP_MAX_ENTRIES) return invalid();
        const key = checkedKey(cursor.primaryKey, binding);
        readBrowserPair(context, key, (raw, digest, exists) => {
          check();
          if (!exists) return invalid();
          entries.push(pair(raw, digest, key, binding));
          cursor.continue();
        });
      });
    },
  );
  check();
  for (const entry of entries) {
    await inspectPackReceiptHistory(entry.raw, binding, check);
    check();
  }
  const document = {
    schema_version: 1,
    kind: 'context-pack-save-history-backup',
    binding,
    entries: entries.map((entry) => entry.file),
  };
  const document_sha256 = await backupHash(packReceiptBackupDocumentJson(document));
  check();
  const file = parsePackReceiptBackupFile({ document, document_sha256 });
  return { file, raw: packReceiptBackupFileJson(file) };
}

export interface PackReceiptRestoreComparison {
  entries: {
    document_sha256: string;
    request_key: string;
    observed_at: string;
    status: 'missing' | 'identical' | 'conflict';
  }[];
  total: number;
  missing: number;
  identical: number;
  conflicting: number;
}

/** Compare only backup targets in one readonly snapshot; never accept partial results. */
export async function comparePackReceiptBackup(
  raw: string,
  input: PackSaveBinding,
  signal: AbortSignal,
  check: () => void,
): Promise<PackReceiptRestoreComparison> {
  const binding = parsePackSaveBinding(input);
  const candidate = await inspectPackReceiptBackup(raw, binding, check);
  const targets = candidate.file.document.entries.map((file) => ({
    key: slot(binding, file.document_sha256),
    raw: contextPackSaveReceiptFileJson(file),
    document_sha256: file.document_sha256,
    request_key: file.document.original.request_key,
    observed_at: file.document.observed_at,
  }));
  const row = (target: (typeof targets)[number], status: 'missing' | 'identical' | 'conflict') => ({
    document_sha256: target.document_sha256,
    request_key: target.request_key,
    observed_at: target.observed_at,
    status,
  });
  check();
  const entries = targets.length
    ? await inBrowserStores<PackReceiptRestoreComparison['entries']>(
        layout,
        'readonly',
        signal,
        () => targets.map((target) => row(target, 'missing')),
        (context) => {
          const rows: PackReceiptRestoreComparison['entries'] = [];
          const next = () => {
            check();
            const target = targets[rows.length];
            if (!target) {
              context.accept(rows);
              return;
            }
            // Read key presence too: an existing undefined value is a conflict, not absence.
            const contentKey = context.content.getKey(target.key);
            const directoryKey = context.directory.getKey(target.key);
            const content = context.content.get(target.key);
            const directory = context.directory.get(target.key);
            directory.onsuccess = context.guard(() => {
              check();
              const hasContent = contentKey.result !== undefined;
              const hasDirectory = directoryKey.result !== undefined;
              rows.push(
                row(
                  target,
                  !hasContent && !hasDirectory
                    ? 'missing'
                    : hasContent &&
                        hasDirectory &&
                        content.result === target.raw &&
                        directory.result === target.document_sha256
                      ? 'identical'
                      : 'conflict',
                ),
              );
              next();
            });
          };
          next();
        },
      )
    : [];
  check();
  return {
    entries,
    total: entries.length,
    missing: entries.filter((entry) => entry.status === 'missing').length,
    identical: entries.filter((entry) => entry.status === 'identical').length,
    conflicting: entries.filter((entry) => entry.status === 'conflict').length,
  };
}

/** Remove only the reviewed matching subset; never expand it to newly appearing backup targets. */
export async function removePackReceiptBackup(
  raw: string,
  input: PackSaveBinding,
  selectedDigests: readonly string[],
  signal: AbortSignal,
  check: () => void,
) {
  // Capture the caller's selection before hashing yields to other activity.
  if (!Array.isArray(selectedDigests) || selectedDigests.length > PACK_RECEIPT_BACKUP_MAX_ENTRIES)
    return invalid();
  const selected = [...selectedDigests];
  for (let index = 0; index < selected.length; index += 1) {
    const digest = selected[index];
    if (
      typeof digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      (index > 0 && selected[index - 1]! >= digest)
    )
      return invalid();
  }
  const binding = parsePackSaveBinding(input);
  const candidate = await inspectPackReceiptBackup(raw, binding, check);
  const requested = new Set(selected);
  const entries = candidate.file.document.entries
    .filter((file) => requested.has(file.document_sha256))
    .map((file) => ({
      key: slot(binding, file.document_sha256),
      raw: contextPackSaveReceiptFileJson(file),
    }));
  if (entries.length !== selected.length) return invalid();
  check();
  if (!entries.length) return { total: 0, removed: 0, already_absent: 0 };
  return withPackReceiptHistoryChange(binding, async () => {
    check();
    const result = await inBrowserStores<{
      total: number;
      removed: number;
      already_absent: number;
    }>(
      layout,
      'readwrite',
      signal,
      () => ({ total: entries.length, removed: 0, already_absent: entries.length }),
      (context) => {
        const matching: typeof entries = [];
        let position = 0;
        let verified = 0;
        const readback = () => {
          check();
          const entry = entries[verified];
          if (!entry) {
            context.accept({
              total: entries.length,
              removed: matching.length,
              already_absent: entries.length - matching.length,
            });
            return;
          }
          readBrowserPair(context, entry.key, (_raw, _digest, exists) => {
            check();
            if (exists) return invalid();
            verified += 1;
            readback();
          });
        };
        const preflight = () => {
          check();
          const entry = entries[position];
          if (!entry) {
            for (const item of matching) {
              check();
              context.content.delete(item.key);
              context.directory.delete(item.key);
            }
            readback();
            return;
          }
          readBrowserPair(context, entry.key, (raw, digest, exists) => {
            check();
            if (exists) {
              if (pair(raw, digest, entry.key, binding).raw !== entry.raw) return invalid();
              matching.push(entry);
            }
            position += 1;
            preflight();
          });
        };
        preflight();
      },
      { create: false },
    );
    check();
    return result;
  });
}

/** Preflight every target in one transaction before adding any missing immutable observation. */
export async function restorePackReceiptBackup(
  raw: string,
  input: PackSaveBinding,
  signal: AbortSignal,
  check: () => void,
) {
  const binding = parsePackSaveBinding(input);
  const candidate = await inspectPackReceiptBackup(raw, binding, check);
  const entries = candidate.file.document.entries.map((file) => ({
    key: slot(binding, file.document_sha256),
    raw: contextPackSaveReceiptFileJson(file),
    digest: file.document_sha256,
  }));
  check();
  if (!entries.length) return { total: 0, added: 0, already_present: 0 };
  return withPackReceiptHistoryChange(binding, async () => {
    check();
    const result = await inBrowserStores<{ total: number; added: number; already_present: number }>(
      layout,
      'readwrite',
      signal,
      invalid,
      (context) => {
        const missing: typeof entries = [];
        let position = 0;
        let verified = 0;
        const readback = () => {
          check();
          const entry = entries[verified];
          if (!entry) {
            context.accept({
              total: entries.length,
              added: missing.length,
              already_present: entries.length - missing.length,
            });
            return;
          }
          readBrowserPair(context, entry.key, (raw, digest, exists) => {
            check();
            if (!exists || pair(raw, digest, entry.key, binding).raw !== entry.raw)
              return invalid();
            verified += 1;
            readback();
          });
        };
        const preflight = () => {
          check();
          const entry = entries[position];
          if (!entry) {
            for (const item of missing) {
              check();
              context.content.add(item.raw, item.key);
              context.directory.add(item.digest, item.key);
            }
            readback();
            return;
          }
          readBrowserPair(context, entry.key, (raw, digest, exists) => {
            check();
            if (exists) {
              if (pair(raw, digest, entry.key, binding).raw !== entry.raw) return invalid();
            } else missing.push(entry);
            position += 1;
            preflight();
          });
        };
        preflight();
      },
    );
    check();
    return result;
  });
}
