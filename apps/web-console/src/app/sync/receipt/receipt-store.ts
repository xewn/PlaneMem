'use client';

import {
  isSyncIdentifier,
  parseSyncCommandIdentity,
  parseSyncEventReceiptFile,
  syncJsonSnapshot,
  SYNC_EVENT_RECEIPT_FILE_BYTES,
  type SyncCommandIdentity,
  type SyncEventReceiptEnvelope,
  type SyncEventReceiptFile,
} from '@planemem/contracts';
import {
  inBrowserStores,
  readBrowserPair,
  removeBrowserPair,
  type BrowserRemovalResult,
} from './browser-store';
import { encodeSyncReceiptArchive, loadSyncReceiptInput } from './model';

const receiptDatabase = { databaseName: 'planemem-sync-receipts', contentStore: 'receipts' };
const metadataBytes = 16 * 1024;
const pageSize = 20;

interface ReceiptMetadata {
  schema_version: 1;
  identity: SyncCommandIdentity;
  event_id: string;
  event_type: string;
  query_trace: string;
  outcome: 'accepted' | 'conflict' | 'not-observed';
  file_bytes: number;
}
export interface SavedSyncReceipt {
  digest: string;
  metadata: ReceiptMetadata;
}
export interface SavedSyncReceiptPage {
  entries: SavedSyncReceipt[];
  next: string | null;
}
function unavailable() {
  return new Error(
    'The complete historical receipt could not be saved or verified. Keep a separate copy.',
  );
}
function bytes(raw: string) {
  return new TextEncoder().encode(raw).byteLength;
}
function digestKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw unavailable();
  return value;
}
function metadata(file: SyncEventReceiptFile, raw: string): ReceiptMetadata {
  const receipt = file.document.receipt;
  return {
    schema_version: 1,
    identity: receipt.data.identity,
    event_id: receipt.data.event.event_id,
    event_type: receipt.data.event.event_type,
    query_trace: receipt.trace_id,
    outcome:
      receipt.data.status === 'not-observed'
        ? 'not-observed'
        : receipt.data.receipt.accepted
          ? 'accepted'
          : 'conflict',
    file_bytes: bytes(raw),
  };
}
function readMetadata(raw: unknown, digest: unknown): SavedSyncReceipt {
  const key = digestKey(digest);
  if (typeof raw !== 'string' || raw.length > metadataBytes || bytes(raw) > metadataBytes)
    throw unavailable();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const row = value as Record<string, unknown>;
  const fields = [
    'schema_version',
    'identity',
    'event_id',
    'event_type',
    'query_trace',
    'outcome',
    'file_bytes',
  ];
  if (
    Object.keys(row).length !== fields.length ||
    Object.keys(row).some((key) => !fields.includes(key)) ||
    row.schema_version !== 1 ||
    !isSyncIdentifier(row.event_id) ||
    !isSyncIdentifier(row.event_type) ||
    typeof row.query_trace !== 'string' ||
    !row.query_trace.trim() ||
    row.query_trace.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.query_trace) ||
    (row.outcome !== 'accepted' && row.outcome !== 'conflict' && row.outcome !== 'not-observed') ||
    typeof row.file_bytes !== 'number' ||
    !Number.isSafeInteger(row.file_bytes) ||
    row.file_bytes <= 0 ||
    row.file_bytes > SYNC_EVENT_RECEIPT_FILE_BYTES
  )
    throw unavailable();
  return {
    digest: key,
    metadata: {
      schema_version: 1,
      identity: parseSyncCommandIdentity(row.identity),
      event_id: row.event_id,
      event_type: row.event_type,
      query_trace: row.query_trace,
      outcome: row.outcome,
      file_bytes: row.file_bytes,
    },
  };
}
/** Structural read only. Digest verification takes place outside the active IDB transaction. */
function readFile(raw: unknown, summary: unknown, key: string) {
  const entry = readMetadata(summary, key);
  if (
    typeof raw !== 'string' ||
    raw.length > SYNC_EVENT_RECEIPT_FILE_BYTES ||
    bytes(raw) > SYNC_EVENT_RECEIPT_FILE_BYTES
  )
    throw unavailable();
  const file = parseSyncEventReceiptFile(JSON.parse(raw) as unknown);
  if (
    file.document_sha256 !== key ||
    syncJsonSnapshot(file, SYNC_EVENT_RECEIPT_FILE_BYTES) !== raw ||
    JSON.stringify(metadata(file, raw)) !== JSON.stringify(entry.metadata)
  )
    throw unavailable();
  return { file, raw };
}

/** Bound digest preparation as well as storage. Late crypto completion must not start a transaction. */
function receiptOperation<T>(
  signal: AbortSignal,
  run: (signal: AbortSignal, checkpoint: () => void) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const deadline = performance.now() + 30_000;
    let settled = false;
    const finish = (result: { value: T } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      controller.abort();
      if (result) resolve(result.value);
      else reject(unavailable());
    };
    const cancel = () => finish(null);
    const timer = setTimeout(cancel, 30_000);
    const checkpoint = () => {
      if (settled || signal.aborted || controller.signal.aborted || performance.now() >= deadline)
        throw unavailable();
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    void Promise.resolve()
      .then(() => {
        checkpoint();
        return run(controller.signal, checkpoint);
      })
      .then(
        (value) => {
          try {
            checkpoint();
            finish({ value });
          } catch {
            finish(null);
          }
        },
        () => finish(null),
      );
  });
}

/** Each distinct complete document gets an immutable slot; neither query results nor imports autosave. */
export function preserveBrowserSyncReceipt(
  receipt: SyncEventReceiptEnvelope,
  signal: AbortSignal,
  expectedDigest?: string,
) {
  return receiptOperation(signal, async (operationSignal, checkpoint) => {
    const raw = await encodeSyncReceiptArchive(receipt);
    checkpoint();
    const file = parseSyncEventReceiptFile(JSON.parse(raw) as unknown);
    const key = file.document_sha256;
    if (expectedDigest !== undefined && digestKey(expectedDigest) !== key) throw unavailable();
    const summary = JSON.stringify(metadata(file, raw));
    readFile(raw, summary, key);
    checkpoint();
    return inBrowserStores<'saved' | 'already-saved'>(
      receiptDatabase,
      'readwrite',
      operationSignal,
      () => {
        throw unavailable();
      },
      (context) =>
        readBrowserPair(context, key, (existing, index, present) => {
          if (present) {
            // Equality to the freshly hashed complete file verifies existing content without async work.
            if (readFile(existing, index, key).raw !== raw) throw unavailable();
            context.accept('already-saved');
            return;
          }
          context.content.add(raw, key);
          context.directory.add(summary, key);
          readBrowserPair(context, key, (saved, savedIndex, exists) => {
            if (!exists || readFile(saved, savedIndex, key).raw !== raw) throw unavailable();
            context.accept('saved');
          });
        }),
    );
  });
}

export function loadBrowserSyncReceipt(selection: SavedSyncReceipt, signal: AbortSignal) {
  const selected = readMetadata(JSON.stringify(selection.metadata), selection.digest);
  return receiptOperation<SyncEventReceiptFile | null>(
    signal,
    async (operationSignal, checkpoint) => {
      const raw = await inBrowserStores<string | null>(
        receiptDatabase,
        'readonly',
        operationSignal,
        () => null,
        (context) =>
          readBrowserPair(context, selected.digest, (stored, summary, present) => {
            if (!present) {
              context.accept(null);
              return;
            }
            const complete = readFile(stored, summary, selected.digest);
            if (
              JSON.stringify(metadata(complete.file, complete.raw)) !==
              JSON.stringify(selected.metadata)
            )
              throw unavailable();
            context.accept(complete.raw);
          }),
      );
      checkpoint();
      if (raw === null) return null;
      const loaded = await loadSyncReceiptInput(raw);
      checkpoint();
      if (!loaded.imported || loaded.imported.document_sha256 !== selected.digest)
        throw unavailable();
      return loaded.imported;
    },
  );
}

/** Hash the reviewed file before opening a write transaction, then compare the full saved bytes. */
export function removeBrowserSyncReceipt(
  selection: SavedSyncReceipt,
  expectedRaw: string,
  signal: AbortSignal,
) {
  const selected = readMetadata(JSON.stringify(selection.metadata), selection.digest);
  return receiptOperation<BrowserRemovalResult>(signal, async (operationSignal, checkpoint) => {
    const expected = readFile(expectedRaw, JSON.stringify(selected.metadata), selected.digest);
    const loaded = await loadSyncReceiptInput(expected.raw);
    checkpoint();
    if (!loaded.imported || loaded.imported.document_sha256 !== selected.digest)
      throw unavailable();
    return inBrowserStores<BrowserRemovalResult>(
      receiptDatabase,
      'readwrite',
      operationSignal,
      () => 'not-present',
      (context) =>
        readBrowserPair(context, selected.digest, (raw, summary, present) => {
          if (!present) {
            context.accept('not-present');
            return;
          }
          const stored = readFile(raw, summary, selected.digest);
          if (
            stored.raw !== expected.raw ||
            JSON.stringify(metadata(stored.file, stored.raw)) !== JSON.stringify(selected.metadata)
          )
            throw unavailable();
          removeBrowserPair(context, selected.digest);
        }),
      { create: false },
    );
  });
}

/** Digest order is stable, not chronological. No full receipt or digest calculation is read here. */
export function listBrowserSyncReceipts(after: string | null, signal: AbortSignal) {
  if (after !== null) digestKey(after);
  return inBrowserStores<SavedSyncReceiptPage>(
    receiptDatabase,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: SavedSyncReceipt[] = [];
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
          context.accept({ entries, next: entries[entries.length - 1]!.digest });
          return;
        }
        entries.push(entry);
        cursor.continue();
      });
    },
  );
}
