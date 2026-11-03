import { parseSyncEventReceiptQuery, type SyncEventReceiptQuery } from './sync-event-receipt.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const SYNC_ORIGINALS_BACKUP_MAX_ENTRIES = 256;
export const SYNC_ORIGINALS_BACKUP_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const SYNC_ORIGINALS_BACKUP_FILE_BYTES = SYNC_ORIGINALS_BACKUP_DOCUMENT_BYTES + 8192;
export interface SyncOriginalsBackupDocument {
  schema_version: 1;
  kind: 'workctx.sync-originals-backup';
  entries: SyncEventReceiptQuery[];
}
export interface SyncOriginalsBackupFile {
  document: SyncOriginalsBackupDocument;
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
    throw new TypeError('Invalid originals backup fields');
  return input as Record<string, unknown>;
}
/** Query order matches the existing browser original-slot key. No event fields are reordered. */
export function parseSyncOriginalsBackupDocument(input: unknown): SyncOriginalsBackupDocument {
  const value = object(JSON.parse(syncJsonSnapshot(input, SYNC_ORIGINALS_BACKUP_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'entries',
  ]);
  if (
    value.schema_version !== 1 ||
    value.kind !== 'workctx.sync-originals-backup' ||
    !Array.isArray(value.entries) ||
    value.entries.length > SYNC_ORIGINALS_BACKUP_MAX_ENTRIES
  )
    throw new TypeError('Invalid originals backup document');
  let previous: string | undefined;
  const entries = value.entries.map((raw) => {
    const query = parseSyncEventReceiptQuery(raw);
    const identity = query.identity;
    const key = JSON.stringify([
      identity.tenant_id,
      identity.workspace_id,
      identity.project_id,
      identity.actor_id,
      identity.client_id,
      query.event.event_id,
    ]);
    if (previous !== undefined && key <= previous)
      throw new TypeError('Originals backup slots must be unique and sorted');
    previous = key;
    return query;
  });
  return { schema_version: 1, kind: 'workctx.sync-originals-backup', entries };
}
export function syncOriginalsBackupDocumentJson(input: unknown) {
  return syncJsonSnapshot(
    parseSyncOriginalsBackupDocument(input),
    SYNC_ORIGINALS_BACKUP_DOCUMENT_BYTES,
  );
}
/** Structural parsing only. File consumers independently verify the canonical document SHA-256. */
export function parseSyncOriginalsBackupFile(input: unknown): SyncOriginalsBackupFile {
  const value = object(JSON.parse(syncJsonSnapshot(input, SYNC_ORIGINALS_BACKUP_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof value.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.document_sha256))
    throw new TypeError('Invalid originals backup digest');
  return {
    document: parseSyncOriginalsBackupDocument(value.document),
    document_sha256: value.document_sha256,
  };
}
