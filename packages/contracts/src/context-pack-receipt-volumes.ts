import { parsePackSaveBinding, type PackSaveBinding } from './context-pack-save-original.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import {
  PACK_RECEIPT_BACKUP_MAX_ENTRIES,
  PACK_RECEIPT_BACKUP_FILE_BYTES,
  type PackReceiptBackupCandidate,
} from './context-pack-receipt-backup.js';

export const PACK_RECEIPT_MAX_VOLUMES = 10;
export const PACK_RECEIPT_VOLUMES_MAX_ENTRIES =
  PACK_RECEIPT_MAX_VOLUMES * PACK_RECEIPT_BACKUP_MAX_ENTRIES;
export const PACK_RECEIPT_VOLUMES_DOCUMENT_BYTES = 31 * 1024;
export const PACK_RECEIPT_VOLUMES_FILE_BYTES = 32 * 1024;
export const PACK_RECEIPT_VOLUMES_SET_BYTES =
  PACK_RECEIPT_MAX_VOLUMES * PACK_RECEIPT_BACKUP_FILE_BYTES + PACK_RECEIPT_VOLUMES_FILE_BYTES;
export interface PackReceiptVolumesDocument {
  schema_version: 1;
  kind: 'context-pack-save-history-volumes';
  binding: PackSaveBinding;
  total_entries: number;
  volumes: { index: number; entries: number; document_sha256: string }[];
}
export interface PackReceiptVolumesFile {
  document: PackReceiptVolumesDocument;
  document_sha256: string;
}
export interface PackReceiptVolumesCandidate {
  file: PackReceiptVolumesFile;
  raw: string;
  volumes: PackReceiptBackupCandidate[];
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  )
    throw new TypeError();
  return row;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError();
  return value;
}
/** Structure only; adapters must verify the manifest, all volumes and every observation digest. */
export function parsePackReceiptVolumesDocument(input: unknown): PackReceiptVolumesDocument {
  const row = object(JSON.parse(syncJsonSnapshot(input, PACK_RECEIPT_VOLUMES_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'binding',
    'total_entries',
    'volumes',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'context-pack-save-history-volumes' ||
    typeof row.total_entries !== 'number' ||
    !Number.isSafeInteger(row.total_entries) ||
    row.total_entries < 0 ||
    row.total_entries > PACK_RECEIPT_VOLUMES_MAX_ENTRIES ||
    !Array.isArray(row.volumes) ||
    row.volumes.length !==
      Math.max(1, Math.ceil(row.total_entries / PACK_RECEIPT_BACKUP_MAX_ENTRIES))
  )
    throw new TypeError();
  const total = row.total_entries;
  const seen = new Set<string>();
  const volumes = row.volumes.map((input: unknown, position: number) => {
    const volume = object(input, ['index', 'entries', 'document_sha256']);
    const count = Math.min(
      PACK_RECEIPT_BACKUP_MAX_ENTRIES,
      total - position * PACK_RECEIPT_BACKUP_MAX_ENTRIES,
    );
    const digest = hash(volume.document_sha256);
    if (volume.index !== position + 1 || volume.entries !== count || seen.has(digest))
      throw new TypeError();
    seen.add(digest);
    return { index: position + 1, entries: count, document_sha256: digest };
  });
  return {
    schema_version: 1,
    kind: 'context-pack-save-history-volumes',
    binding: parsePackSaveBinding(row.binding),
    total_entries: total,
    volumes,
  };
}
export function packReceiptVolumesDocumentJson(input: unknown) {
  return syncJsonSnapshot(
    parsePackReceiptVolumesDocument(input),
    PACK_RECEIPT_VOLUMES_DOCUMENT_BYTES,
  );
}
export function parsePackReceiptVolumesFile(input: unknown): PackReceiptVolumesFile {
  const row = object(JSON.parse(syncJsonSnapshot(input, PACK_RECEIPT_VOLUMES_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  return {
    document: parsePackReceiptVolumesDocument(row.document),
    document_sha256: hash(row.document_sha256),
  };
}
export function packReceiptVolumesFileJson(input: unknown) {
  return syncJsonSnapshot(parsePackReceiptVolumesFile(input), PACK_RECEIPT_VOLUMES_FILE_BYTES);
}
