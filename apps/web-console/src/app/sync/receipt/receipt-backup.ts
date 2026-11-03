'use client';

import {
  parseSyncReceiptsBackupFile,
  syncReceiptsBackupDocumentJson,
  syncEventReceiptDocumentJson,
  syncJsonSnapshot,
  SYNC_RECEIPTS_BACKUP_FILE_BYTES,
  type SyncReceiptsBackupDocument,
  type SyncReceiptsBackupFile,
} from '@planemem/contracts';
import { backupOperation, backupHash } from './backup-operation';
import { readBrowserSyncReceiptBackup, restoreBrowserSyncReceiptBackup } from './receipt-store';

export interface ReviewedReceiptBackup {
  file: SyncReceiptsBackupFile;
  raw: string;
}
function unavailable() {
  return new Error('The historical receipts backup could not be verified. Keep the complete file.');
}
/** Do not trust an outer collection digest as proof that each inner receipt digest matches. */
async function verifyReceipts(document: SyncReceiptsBackupDocument, check: () => void) {
  for (const file of document.entries) {
    check();
    const expected = await backupHash(syncEventReceiptDocumentJson(file.document));
    check();
    if (expected !== file.document_sha256) throw unavailable();
  }
}
async function inspect(raw: string, check: () => void): Promise<ReviewedReceiptBackup> {
  check();
  if (
    !raw ||
    raw.length > SYNC_RECEIPTS_BACKUP_FILE_BYTES ||
    new TextEncoder().encode(raw).byteLength > SYNC_RECEIPTS_BACKUP_FILE_BYTES
  )
    throw unavailable();
  const file = parseSyncReceiptsBackupFile(JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown);
  const expected = await backupHash(syncReceiptsBackupDocumentJson(file.document));
  check();
  if (expected !== file.document_sha256) throw unavailable();
  await verifyReceipts(file.document, check);
  check();
  return { file, raw: syncJsonSnapshot(file, SYNC_RECEIPTS_BACKUP_FILE_BYTES) };
}
export function prepareBrowserReceiptsBackup(signal: AbortSignal) {
  return backupOperation(signal, async (operationSignal, check) => {
    const document = await readBrowserSyncReceiptBackup(operationSignal, check);
    check();
    await verifyReceipts(document, check);
    check();
    const document_sha256 = await backupHash(syncReceiptsBackupDocumentJson(document));
    check();
    const file = parseSyncReceiptsBackupFile({ document, document_sha256 });
    const raw = syncJsonSnapshot(file, SYNC_RECEIPTS_BACKUP_FILE_BYTES);
    check();
    return { file, raw };
  });
}
export function loadReceiptsBackup(source: File, signal: AbortSignal) {
  return backupOperation(signal, async (_operationSignal, check) => {
    if (source.size > SYNC_RECEIPTS_BACKUP_FILE_BYTES) throw unavailable();
    const bytes = await source.arrayBuffer();
    check();
    if (bytes.byteLength !== source.size || bytes.byteLength > SYNC_RECEIPTS_BACKUP_FILE_BYTES)
      throw unavailable();
    return inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), check);
  });
}
export function restoreReceiptsBackup(raw: string, signal: AbortSignal) {
  return backupOperation(signal, async (operationSignal, check) => {
    const reviewed = await inspect(raw, check);
    check();
    const result = await restoreBrowserSyncReceiptBackup(
      reviewed.file.document,
      operationSignal,
      check,
    );
    check();
    return result;
  });
}
