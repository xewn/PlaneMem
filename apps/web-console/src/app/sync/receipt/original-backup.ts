'use client';

import {
  parseSyncOriginalsBackupFile,
  syncOriginalsBackupDocumentJson,
  syncJsonSnapshot,
  SYNC_ORIGINALS_BACKUP_FILE_BYTES,
  type SyncOriginalsBackupFile,
} from '@planemem/contracts';
import { readBrowserSyncOriginalBackup, restoreBrowserSyncOriginalBackup } from './original-store';

export interface ReviewedOriginalBackup {
  file: SyncOriginalsBackupFile;
  raw: string;
}
function unavailable() {
  return new Error(
    'The complete originals backup operation could not be confirmed. Keep the backup copy.',
  );
}

/** Bound file reads, hashing and storage together; late work must not start another transaction. */
function operation<T>(
  signal: AbortSignal,
  run: (signal: AbortSignal, check: () => void) => Promise<T>,
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
    const check = () => {
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
        check();
        return run(controller.signal, check);
      })
      .then(
        (value) => {
          try {
            check();
            finish({ value });
          } catch {
            finish(null);
          }
        },
        () => finish(null),
      );
  });
}
async function hash(raw: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
  const expected = await hash(syncOriginalsBackupDocumentJson(file.document));
  check();
  if (expected !== file.document_sha256) throw unavailable();
  return { file, raw: syncJsonSnapshot(file, SYNC_ORIGINALS_BACKUP_FILE_BYTES) };
}
export function prepareBrowserOriginalsBackup(signal: AbortSignal) {
  return operation(signal, async (operationSignal, check) => {
    const document = await readBrowserSyncOriginalBackup(operationSignal);
    check();
    const document_sha256 = await hash(syncOriginalsBackupDocumentJson(document));
    check();
    const file = parseSyncOriginalsBackupFile({ document, document_sha256 });
    const raw = syncJsonSnapshot(file, SYNC_ORIGINALS_BACKUP_FILE_BYTES);
    check();
    return { file, raw };
  });
}
export function loadOriginalsBackup(source: File, signal: AbortSignal) {
  return operation(signal, async (_operationSignal, check) => {
    if (source.size > SYNC_ORIGINALS_BACKUP_FILE_BYTES) throw unavailable();
    const bytes = await source.arrayBuffer();
    check();
    if (bytes.byteLength !== source.size || bytes.byteLength > SYNC_ORIGINALS_BACKUP_FILE_BYTES)
      throw unavailable();
    return inspect(new TextDecoder('utf-8', { fatal: true }).decode(bytes), check);
  });
}
export function restoreOriginalsBackup(raw: string, signal: AbortSignal) {
  return operation(signal, async (operationSignal, check) => {
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
