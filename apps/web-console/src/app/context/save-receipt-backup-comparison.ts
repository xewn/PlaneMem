'use client';

import {
  PACK_RECEIPT_BACKUP_FILE_BYTES,
  PACK_RECEIPT_MAX_VOLUMES,
  PACK_RECEIPT_VOLUMES_SET_BYTES,
  parsePackSaveBinding,
  syncJsonSnapshot,
  type PackSaveBinding,
} from '@planemem/contracts';
import {
  compareContextPackReceiptBackups,
  CONTEXT_PACK_BACKUP_COMPARISON_BYTES,
} from '@planemem/sdk/context-pack-receipt-backup-comparison';

const INPUT_METADATA_BYTES = 512 * 1024;
interface SelectedFile {
  file: File;
  name: string;
  size: number;
}

/** Capture one selection before reading; file names do not identify unique observations. */
export function capturePackReceiptBackupFiles(files: readonly File[]): SelectedFile[] {
  if (
    !Array.isArray(files) ||
    files.length < 1 ||
    files.length > PACK_RECEIPT_MAX_VOLUMES + 1 ||
    new Set(files).size !== files.length
  )
    throw new TypeError();
  let total = 0;
  return files.map((file) => {
    if (!(file instanceof File)) throw new TypeError();
    const { name, size } = file;
    if (
      !name ||
      name.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(name) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > PACK_RECEIPT_BACKUP_FILE_BYTES
    )
      throw new TypeError();
    total += size;
    if (total > PACK_RECEIPT_VOLUMES_SET_BYTES) throw new TypeError();
    return { file, name, size };
  });
}

function expectedDigest(value: string) {
  const digest = value.trim();
  if (digest && !/^[a-f0-9]{64}$/.test(digest)) throw new TypeError();
  return digest || undefined;
}

/** Call under backupOperation so file reads, SDK inspection and report capture share one budget. */
export async function comparePackReceiptBackupFiles(
  fromFiles: readonly File[],
  toFiles: readonly File[],
  binding: PackSaveBinding,
  fromExpected: string,
  toExpected: string,
  signal: AbortSignal,
  check: () => void,
) {
  const ready = () => {
    check();
    if (signal.aborted) throw new TypeError();
  };
  ready();
  const expected = parsePackSaveBinding(binding);
  const fromDigest = expectedDigest(fromExpected);
  const toDigest = expectedDigest(toExpected);
  const fromSelection = capturePackReceiptBackupFiles(fromFiles);
  const toSelection = capturePackReceiptBackupFiles(toFiles);
  ready();
  const read = async (files: SelectedFile[]) => {
    const inputs: Uint8Array<ArrayBuffer>[] = [];
    const sources: { name: string; file_bytes: number; file_sha256: string }[] = [];
    for (const selected of files) {
      ready();
      const buffer = await selected.file.arrayBuffer();
      ready();
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== selected.size)
        throw new TypeError();
      const bytes = new Uint8Array(buffer);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      ready();
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
      const file_sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      inputs.push(bytes);
      sources.push({ name: selected.name, file_bytes: selected.size, file_sha256 });
    }
    return { inputs, sources };
  };
  const from = await read(fromSelection);
  const to = await read(toSelection);
  ready();
  const compared = await compareContextPackReceiptBackups(from.inputs, to.inputs, {
    trace_id: 'trace_web_context_backup_comparison',
    expected_binding: expected,
    ...(fromDigest === undefined ? {} : { expected_from_document_sha256: fromDigest }),
    ...(toDigest === undefined ? {} : { expected_to_document_sha256: toDigest }),
    signal,
  });
  ready();
  const metadata = {
    local_inputs: { from: from.sources, to: to.sources },
    expected_document_sha256: { from: fromDigest ?? null, to: toDigest ?? null },
    input_consistency: 'separate-file-reads' as const,
    storage_access: 'file-read-only' as const,
    browser_history_access: 'not-performed' as const,
    restore_state: 'not-started' as const,
  };
  syncJsonSnapshot(metadata, INPUT_METADATA_BYTES);
  const result = { ...compared, data: { ...compared.data, ...metadata } };
  const raw = syncJsonSnapshot(result, CONTEXT_PACK_BACKUP_COMPARISON_BYTES + INPUT_METADATA_BYTES);
  const detached = JSON.parse(raw) as typeof result;
  ready();
  return { result: detached, raw };
}

export type PackReceiptBackupFileComparison = Awaited<
  ReturnType<typeof comparePackReceiptBackupFiles>
>;
