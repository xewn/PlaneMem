'use client';

import {
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  parseArtifactReceiptEnvelope,
  parseArtifactReceiptQuery,
  syncJsonSnapshot,
  type ArtifactReceiptEnvelope,
} from '@planemem/contracts';
import { readArtifactTransferBytes } from '../../../lib/artifact-transfer';
import { backupOperation } from '../../sync/receipt/backup-operation';

export const SAVED_ARTIFACT_RECEIPT_BYTES = 4 * 1024 * 1024;

export function inspectSavedArtifactReceipt(value: unknown) {
  const row = JSON.parse(syncJsonSnapshot(value, SAVED_ARTIFACT_RECEIPT_BYTES)) as Record<
    string,
    unknown
  >;
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    typeof row.trace_id !== 'string' ||
    !row.data ||
    typeof row.data !== 'object' ||
    Array.isArray(row.data)
  )
    throw new TypeError();
  const data = row.data as Record<string, unknown>;
  const original = parseArtifactReceiptQuery(
    JSON.parse(
      syncJsonSnapshot(
        { identity: data.identity, command: data.command },
        ARTIFACT_UPLOAD_REQUEST_BYTES,
      ),
    ),
  );
  const receipt = parseArtifactReceiptEnvelope(row, original, row.trace_id);
  return {
    receipt,
    original,
    receipt_json: syncJsonSnapshot(receipt, SAVED_ARTIFACT_RECEIPT_BYTES),
    original_json: syncJsonSnapshot(original, ARTIFACT_UPLOAD_REQUEST_BYTES),
  };
}

async function fileBytes(file: File, maximum: number, signal: AbortSignal) {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maximum)
    throw new TypeError();
  return readArtifactTransferBytes(file.stream(), maximum, signal, file.size);
}
async function digest(bytes: Uint8Array) {
  const result = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function loadSavedArtifactReceipt(file: File, signal: AbortSignal) {
  return backupOperation(signal, async (active, check) => {
    const bytes = await fileBytes(file, SAVED_ARTIFACT_RECEIPT_BYTES, active);
    check();
    const parsed = inspectSavedArtifactReceipt(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    check();
    const file_sha256 = await digest(bytes);
    check();
    return { ...parsed, file_name: file.name, file_bytes: bytes.byteLength, file_sha256 };
  });
}
export type SavedArtifactReceipt = Awaited<ReturnType<typeof loadSavedArtifactReceipt>>;

export function compareSavedArtifactOriginal(
  receipt: ArtifactReceiptEnvelope,
  file: File,
  signal: AbortSignal,
) {
  const snapshot = inspectSavedArtifactReceipt(receipt).receipt;
  return backupOperation(signal, async (active, check) => {
    const bytes = await fileBytes(file, ARTIFACT_UPLOAD_REQUEST_BYTES, active);
    check();
    const original = parseArtifactReceiptQuery(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    syncJsonSnapshot(original, ARTIFACT_UPLOAD_REQUEST_BYTES);
    let matches = false;
    try {
      parseArtifactReceiptEnvelope(snapshot, original, snapshot.trace_id);
      matches = true;
    } catch {
      // A valid but different original is distinct from a file that could not be read or parsed.
    }
    check();
    const file_sha256 = await digest(bytes);
    check();
    return { matches, file_name: file.name, file_sha256 };
  });
}
