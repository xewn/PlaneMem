'use client';

import {
  isSyncIdentifier,
  parseSyncCommandIdentity,
  SYNC_EVENT_RECEIPT_REQUEST_BYTES,
  parseSyncOriginalsBackupDocument,
  SYNC_ORIGINALS_BACKUP_MAX_ENTRIES,
  SYNC_ORIGINALS_BACKUP_DOCUMENT_BYTES,
  type SyncOriginalsBackupDocument,
  type SyncCommandIdentity,
  type SyncEventReceiptQuery,
} from '@planemem/contracts';
import { decodeSyncReceiptQuery, encodeSyncReceiptQuery } from './model';
import {
  inBrowserStores,
  readBrowserPair,
  removeBrowserPair,
  type BrowserRemovalResult,
} from './browser-store';

const originalDatabase = { databaseName: 'planemem-sync-originals', contentStore: 'originals' };

const metadataBytes = 16 * 1024;
const pageSize = 20;

interface OriginalMetadata {
  schema_version: 1;
  identity: SyncCommandIdentity;
  event_id: string;
  event_type: string;
  original_bytes: number;
}
export interface SavedSyncOriginal {
  key: string;
  metadata: OriginalMetadata;
}
export interface SavedSyncOriginalPage {
  entries: SavedSyncOriginal[];
  next: string | null;
}

function unavailable() {
  return new Error('Browser originals could not be read or committed. Keep the original copy.');
}
function bytes(raw: string) {
  return new TextEncoder().encode(raw).byteLength;
}
function slot(identity: SyncCommandIdentity, eventId: string) {
  return JSON.stringify([
    identity.tenant_id,
    identity.workspace_id,
    identity.project_id,
    identity.actor_id,
    identity.client_id,
    eventId,
  ]);
}
function checkedKey(value: unknown): string {
  if (typeof value !== 'string' || value.length > metadataBytes || bytes(value) > metadataBytes)
    throw unavailable();
  const fields: unknown = JSON.parse(value);
  if (!Array.isArray(fields) || fields.length !== 6 || !isSyncIdentifier(fields[5]))
    throw unavailable();
  const identity = parseSyncCommandIdentity({
    tenant_id: fields[0],
    workspace_id: fields[1],
    project_id: fields[2],
    actor_id: fields[3],
    client_id: fields[4],
  });
  if (slot(identity, fields[5]) !== value) throw unavailable();
  return value;
}
function metadata(original: SyncEventReceiptQuery, raw: string): OriginalMetadata {
  return {
    schema_version: 1,
    identity: original.identity,
    event_id: original.event.event_id,
    event_type: original.event.event_type,
    original_bytes: bytes(raw),
  };
}
function readMetadata(raw: unknown, key: unknown): SavedSyncOriginal {
  const checked = checkedKey(key);
  if (typeof raw !== 'string' || raw.length > metadataBytes || bytes(raw) > metadataBytes)
    throw unavailable();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const row = value as Record<string, unknown>;
  const fields = ['schema_version', 'identity', 'event_id', 'event_type', 'original_bytes'];
  if (
    Object.keys(row).length !== fields.length ||
    Object.keys(row).some((key) => !fields.includes(key)) ||
    row.schema_version !== 1 ||
    !isSyncIdentifier(row.event_id) ||
    !isSyncIdentifier(row.event_type) ||
    typeof row.original_bytes !== 'number' ||
    !Number.isSafeInteger(row.original_bytes) ||
    row.original_bytes <= 0 ||
    row.original_bytes > SYNC_EVENT_RECEIPT_REQUEST_BYTES
  )
    throw unavailable();
  const identity = parseSyncCommandIdentity(row.identity);
  if (slot(identity, row.event_id) !== checked) throw unavailable();
  return {
    key: checked,
    metadata: {
      schema_version: 1,
      identity,
      event_id: row.event_id,
      event_type: row.event_type,
      original_bytes: row.original_bytes,
    },
  };
}
function readOriginal(raw: unknown, summary: unknown, key: string) {
  const entry = readMetadata(summary, key);
  const original = decodeSyncReceiptQuery(raw);
  const encoded = encodeSyncReceiptQuery(original);
  if (
    encoded !== raw ||
    slot(original.identity, original.event.event_id) !== key ||
    JSON.stringify(metadata(original, encoded)) !== JSON.stringify(entry.metadata)
  )
    throw unavailable();
  return original;
}

export function preserveBrowserSyncOriginal(input: SyncEventReceiptQuery, signal: AbortSignal) {
  const raw = encodeSyncReceiptQuery(input);
  const original = decodeSyncReceiptQuery(raw);
  const key = slot(original.identity, original.event.event_id);
  const summary = JSON.stringify(metadata(original, raw));
  readMetadata(summary, key);
  return inBrowserStores<'saved' | 'already-saved'>(
    originalDatabase,
    'readwrite',
    signal,
    () => {
      throw unavailable();
    },
    (context) =>
      readBrowserPair(context, key, (existing, index, present) => {
        if (present) {
          if (encodeSyncReceiptQuery(readOriginal(existing, index, key)) !== raw)
            throw unavailable();
          context.accept('already-saved');
          return;
        }
        context.content.add(raw, key);
        context.directory.add(summary, key);
        readBrowserPair(context, key, (saved, savedIndex, exists) => {
          if (!exists || encodeSyncReceiptQuery(readOriginal(saved, savedIndex, key)) !== raw)
            throw unavailable();
          context.accept('saved');
        });
      }),
  );
}

export function loadBrowserSyncOriginal(selection: SavedSyncOriginal, signal: AbortSignal) {
  // Bind the loaded original to the exact directory entry the user selected.
  const selected = readMetadata(JSON.stringify(selection.metadata), selection.key);
  return inBrowserStores<SyncEventReceiptQuery | null>(
    originalDatabase,
    'readonly',
    signal,
    () => null,
    (context) =>
      readBrowserPair(context, selected.key, (raw, summary, present) => {
        if (!present) {
          context.accept(null);
          return;
        }
        const original = readOriginal(raw, summary, selected.key);
        if (
          JSON.stringify(metadata(original, encodeSyncReceiptQuery(original))) !==
          JSON.stringify(selected.metadata)
        )
          throw unavailable();
        context.accept(original);
      }),
  );
}

/** Only remove the exact original and directory metadata reviewed by the caller. */
export function removeBrowserSyncOriginal(
  selection: SavedSyncOriginal,
  expectedRaw: string,
  signal: AbortSignal,
) {
  const selected = readMetadata(JSON.stringify(selection.metadata), selection.key);
  const original = readOriginal(expectedRaw, JSON.stringify(selected.metadata), selected.key);
  if (encodeSyncReceiptQuery(original) !== expectedRaw) throw unavailable();
  return inBrowserStores<BrowserRemovalResult>(
    originalDatabase,
    'readwrite',
    signal,
    () => 'not-present',
    (context) =>
      readBrowserPair(context, selected.key, (raw, summary, present) => {
        if (!present) {
          context.accept('not-present');
          return;
        }
        if (
          encodeSyncReceiptQuery(readOriginal(raw, summary, selected.key)) !== expectedRaw ||
          JSON.stringify(readMetadata(summary, selected.key).metadata) !==
            JSON.stringify(selected.metadata)
        )
          throw unavailable();
        removeBrowserPair(context, selected.key);
      }),
    { create: false },
  );
}

/** Complete paired-store coverage in one snapshot; never returns a truncated backup. */
export function readBrowserSyncOriginalBackup(signal: AbortSignal) {
  const empty = (): SyncOriginalsBackupDocument => ({
    schema_version: 1,
    kind: 'workctx.sync-originals-backup',
    entries: [],
  });
  return inBrowserStores<SyncOriginalsBackupDocument>(
    originalDatabase,
    'readonly',
    signal,
    empty,
    (context) => {
      const originals = context.content.count();
      const directory = context.directory.count();
      directory.onsuccess = context.guard(() => {
        const count = originals.result;
        if (
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > SYNC_ORIGINALS_BACKUP_MAX_ENTRIES ||
          directory.result !== count
        )
          throw unavailable();
        const entries: SyncEventReceiptQuery[] = [];
        let totalBytes = 0;
        const request = context.content.openKeyCursor();
        request.onsuccess = context.guard(() => {
          const cursor = request.result;
          if (!cursor) {
            if (entries.length !== count) throw unavailable();
            context.accept(parseSyncOriginalsBackupDocument({ ...empty(), entries }));
            return;
          }
          if (entries.length >= count) throw unavailable();
          const key = checkedKey(cursor.primaryKey);
          readBrowserPair(context, key, (raw, summary, present) => {
            if (
              !present ||
              typeof raw !== 'string' ||
              raw.length > SYNC_EVENT_RECEIPT_REQUEST_BYTES
            )
              throw unavailable();
            totalBytes += bytes(raw);
            if (totalBytes > SYNC_ORIGINALS_BACKUP_DOCUMENT_BYTES) throw unavailable();
            entries.push(readOriginal(raw, summary, key));
            cursor.continue();
          });
        });
      });
    },
  );
}

export interface OriginalBackupRestoreResult {
  status: 'restored' | 'already-present' | 'empty';
  total: number;
  restored: number;
  already_present: number;
}
/** File adapters verify the digest before calling. Only missing exact slots are added. */
export function restoreBrowserSyncOriginalBackup(
  input: SyncOriginalsBackupDocument,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const document = parseSyncOriginalsBackupDocument(input);
  check();
  if (signal.aborted) throw unavailable();
  if (document.entries.length === 0)
    return Promise.resolve<OriginalBackupRestoreResult>({
      status: 'empty',
      total: 0,
      restored: 0,
      already_present: 0,
    });
  const prepared = document.entries.map((original) => {
    check();
    const raw = encodeSyncReceiptQuery(original);
    const key = slot(original.identity, original.event.event_id);
    const summary = JSON.stringify(metadata(original, raw));
    readOriginal(raw, summary, key);
    return { raw, key, summary };
  });
  check();
  return inBrowserStores<OriginalBackupRestoreResult>(
    originalDatabase,
    'readwrite',
    signal,
    () => {
      throw unavailable();
    },
    (context) => {
      const missing: typeof prepared = [];
      let checked = 0;
      let written = 0;
      // Queue the next request synchronously in each callback to keep this single transaction active.
      const writeNext = () => {
        check();
        const item = missing[written];
        if (!item) {
          context.accept({
            status: missing.length ? 'restored' : 'already-present',
            total: prepared.length,
            restored: missing.length,
            already_present: prepared.length - missing.length,
          });
          return;
        }
        context.content.add(item.raw, item.key);
        context.directory.add(item.summary, item.key);
        readBrowserPair(context, item.key, (raw, summary, present) => {
          if (!present || encodeSyncReceiptQuery(readOriginal(raw, summary, item.key)) !== item.raw)
            throw unavailable();
          written += 1;
          writeNext();
        });
      };
      const inspectNext = () => {
        check();
        const item = prepared[checked];
        if (!item) {
          writeNext();
          return;
        }
        readBrowserPair(context, item.key, (raw, summary, present) => {
          if (present) {
            if (encodeSyncReceiptQuery(readOriginal(raw, summary, item.key)) !== item.raw)
              throw unavailable();
          } else missing.push(item);
          checked += 1;
          inspectNext();
        });
      };
      inspectNext();
    },
  );
}

/** Metadata-only keyset page. A directory row does not establish original or remote validity. */
export function listBrowserSyncOriginals(after: string | null, signal: AbortSignal) {
  if (after !== null) checkedKey(after);
  return inBrowserStores<SavedSyncOriginalPage>(
    originalDatabase,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: SavedSyncOriginal[] = [];
      const request = context.directory.openCursor(
        after === null ? null : IDBKeyRange.lowerBound(after, true),
      );
      request.onsuccess = context.guard(() => {
        const cursor = request.result;
        if (!cursor) {
          context.accept({ entries, next: null });
          return;
        }
        const entry = readMetadata(cursor.value as unknown, cursor.primaryKey);
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
