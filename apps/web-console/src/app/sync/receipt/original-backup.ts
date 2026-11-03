'use client';

import {
  parseSyncOriginalsBackupFile,
  syncOriginalsBackupDocumentJson,
  syncJsonSnapshot,
  SYNC_ORIGINALS_BACKUP_FILE_BYTES,
  type SyncOriginalsBackupFile,
} from '@planemem/contracts';
import { backupOperation, backupHash } from './backup-operation';
import { readBrowserSyncOriginalBackup, restoreBrowserSyncOriginalBackup } from './original-store';

export interface ReviewedOriginalBackup {
  file: SyncOriginalsBackupFile;
  raw: string;
}
function unavailable() {
  return new Error('The originals backup could not be verified. Keep the complete file.');
}
async function inspect(raw: string, check: () => void): Promise<ReviewedOriginalBackup> {
  check();
  if (
    !raw ||
    raw.length > SYNC_ORIGINALS_BACKUP_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > SYNC_ORIGINALS_BACKUP_FILE_BYTES
  )
    throw unavailable();
  const file = parseSyncOriginalsBackupFile(JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown);
  const expected = await backupHash(syncOriginalsBackupDocumentJson(file.document));
  check();
  if (expected !== file.document_sha256) throw unavailable();
  return { file, raw: syncJsonSnapshot(file, SYNC_ORIGINALS_BACKUP_FILE_BYTES) };
}
export function prepareBrowserOriginalsBackup(signal: AbortSignal) {
  return backupOperation(signal, async (operationSignal, check) => {
    const document = await readBrowserSyncOriginalBackup(operationSignal);
    check();
    const document_sha256 = await backupHash(syncOriginalsBackupDocumentJson(document));
    check();
    const file = parseSyncOriginalsBackupFile({ document, document_sha256 });
    const raw = syncJsonSnapshot(file, SYNC_ORIGINALS_BACKUP_FILE_BYTES);
    check();
    return { file, raw };
  });
}
export function loadOriginalsBackup(source: File, signal: AbortSignal) {
  return backupOperation(signal, async (_operationSignal, check) => {
    if (source.size > SYNC_ORIGINALS_BACKUP_FILE_BYTES) throw unavailable();
    const bytes = await source.arrayBuffer();
    check();
    if (bytes.byteLength !== source.size || bytes.byteLength > SYNC_ORIGINALS_BACKUP_FILE_BYTES)
      throw unavailable();
    return inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), check);
  });
}
export function restoreOriginalsBackup(raw: string, signal: AbortSignal) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, check);
    check();
    const result = await restoreBrowserSyncOriginalBackup(
      reviewed.file.document,
      operationSignal,
      check,
    );
    check();
    return result;
  });
}
