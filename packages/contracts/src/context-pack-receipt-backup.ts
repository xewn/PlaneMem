import {
  assertPackSaveBinding,
  parsePackSaveBinding,
  type PackSaveBinding,
} from './context-pack-save-original.js';
import {
  parseContextPackSaveReceiptFile,
  type ContextPackSaveReceiptFile,
} from './context-pack-save-receipt-file.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const PACK_RECEIPT_BACKUP_MAX_ENTRIES = 100;
export const PACK_RECEIPT_BACKUP_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const PACK_RECEIPT_BACKUP_FILE_BYTES = PACK_RECEIPT_BACKUP_DOCUMENT_BYTES + 1024;
export interface PackReceiptBackupDocument {
  schema_version: 1;
  kind: 'context-pack-save-history-backup';
  binding: PackSaveBinding;
  entries: ContextPackSaveReceiptFile[];
}
export interface PackReceiptBackupFile {
  document: PackReceiptBackupDocument;
  document_sha256: string;
}
export interface PackReceiptBackupCandidate {
  file: PackReceiptBackupFile;
  raw: string;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  return row;
}
/** Structure only. Storage/file adapters must verify every individual and outer checksum. */
export function parsePackReceiptBackupDocument(input: unknown): PackReceiptBackupDocument {
  const row = object(JSON.parse(syncJsonSnapshot(input, PACK_RECEIPT_BACKUP_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'binding',
    'entries',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'context-pack-save-history-backup' ||
    !Array.isArray(row.entries) ||
    row.entries.length > PACK_RECEIPT_BACKUP_MAX_ENTRIES
  )
    throw new TypeError();
  const binding = parsePackSaveBinding(row.binding);
  let previous: string | undefined;
  const entries = row.entries.map((value: unknown) => {
    const file = parseContextPackSaveReceiptFile(value);
    assertPackSaveBinding(file.document.original.binding, binding);
    if (previous !== undefined && file.document_sha256 <= previous) throw new TypeError();
    previous = file.document_sha256;
    return file;
  });
  return { schema_version: 1, kind: 'context-pack-save-history-backup', binding, entries };
}
export function packReceiptBackupDocumentJson(input: unknown) {
  return syncJsonSnapshot(
    parsePackReceiptBackupDocument(input),
    PACK_RECEIPT_BACKUP_DOCUMENT_BYTES,
  );
}
export function parsePackReceiptBackupFile(input: unknown): PackReceiptBackupFile {
  const row = object(JSON.parse(syncJsonSnapshot(input, PACK_RECEIPT_BACKUP_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
    throw new TypeError();
  return {
    document: parsePackReceiptBackupDocument(row.document),
    document_sha256: row.document_sha256,
  };
}
export function packReceiptBackupFileJson(input: unknown) {
  return syncJsonSnapshot(parsePackReceiptBackupFile(input), PACK_RECEIPT_BACKUP_FILE_BYTES);
}
