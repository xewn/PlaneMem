import { parseSyncEventReceiptFile, type SyncEventReceiptFile } from './sync-event-receipt-file.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const SYNC_RECEIPTS_BACKUP_MAX_ENTRIES = 256;
export const SYNC_RECEIPTS_BACKUP_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const SYNC_RECEIPTS_BACKUP_FILE_BYTES = SYNC_RECEIPTS_BACKUP_DOCUMENT_BYTES + 8192;
export interface SyncReceiptsBackupDocument {
  schema_version: 1;
  kind: 'workctx.sync-receipts-backup';
  entries: SyncEventReceiptFile[];
}
export interface SyncReceiptsBackupFile {
  document: SyncReceiptsBackupDocument;
  document_sha256: string;
}
function object(input: unknown, fields: string[]) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new TypeError('Invalid receipts backup fields');
  return input as Record<string, unknown>;
}
/** Digest order matches browser receipt slots. It does not imply chronology. */
export function parseSyncReceiptsBackupDocument(input: unknown): SyncReceiptsBackupDocument {
  const value = object(JSON.parse(syncJsonSnapshot(input, SYNC_RECEIPTS_BACKUP_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'entries',
  ]);
  if (
    value.schema_version !== 1 ||
    value.kind !== 'workctx.sync-receipts-backup' ||
    !Array.isArray(value.entries) ||
    value.entries.length > SYNC_RECEIPTS_BACKUP_MAX_ENTRIES
  )
    throw new TypeError('Invalid receipts backup document');
  let previous: string | undefined;
  const entries = value.entries.map((raw) => {
    const file = parseSyncEventReceiptFile(raw);
    const key = file.document_sha256;
    if (previous !== undefined && key <= previous)
      throw new TypeError('Receipts backup slots must be unique and sorted');
    previous = key;
    return file;
  });
  return { schema_version: 1, kind: 'workctx.sync-receipts-backup', entries };
}
export function syncReceiptsBackupDocumentJson(input: unknown) {
  return syncJsonSnapshot(
    parseSyncReceiptsBackupDocument(input),
    SYNC_RECEIPTS_BACKUP_DOCUMENT_BYTES,
  );
}
/** Structural only. Consumers verify the collection SHA-256 and every inner receipt SHA-256. */
export function parseSyncReceiptsBackupFile(input: unknown): SyncReceiptsBackupFile {
  const value = object(JSON.parse(syncJsonSnapshot(input, SYNC_RECEIPTS_BACKUP_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof value.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.document_sha256))
    throw new TypeError('Invalid receipts backup digest');
  return {
    document: parseSyncReceiptsBackupDocument(value.document),
    document_sha256: value.document_sha256,
  };
}
