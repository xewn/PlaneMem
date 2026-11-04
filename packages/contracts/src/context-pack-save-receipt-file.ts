import { syncJsonSnapshot } from './sync-upload-receipt.js';
import { parsePackSaveOriginal, type PackSaveOriginal } from './context-pack-save-original.js';
import {
  contextPackSaveReceiptQuery,
  parseContextPackSaveReceiptEnvelope,
  type ContextPackSaveReceiptEnvelope,
} from './context-pack-save-receipt.js';

export const CONTEXT_PACK_SAVE_RECEIPT_DOCUMENT_BYTES = 28 * 1024;
export const CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES = 32 * 1024;
export interface ContextPackSaveReceiptDocument {
  schema_version: 1;
  kind: 'context-pack-save-observation';
  /** Local query completion time, not a gateway signature or a new save time. */
  observed_at: string;
  original: PackSaveOriginal;
  receipt: ContextPackSaveReceiptEnvelope;
}
export interface ContextPackSaveReceiptFile {
  document: ContextPackSaveReceiptDocument;
  document_sha256: string;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  return row;
}
/** Self-consistency only. This does not authenticate the server or recheck current availability. */
export function parseContextPackSaveReceiptDocument(
  input: unknown,
): ContextPackSaveReceiptDocument {
  const row = object(
    JSON.parse(syncJsonSnapshot(input, CONTEXT_PACK_SAVE_RECEIPT_DOCUMENT_BYTES)),
    ['schema_version', 'kind', 'observed_at', 'original', 'receipt'],
  );
  if (
    row.schema_version !== 1 ||
    row.kind !== 'context-pack-save-observation' ||
    typeof row.observed_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.observed_at) ||
    row.observed_at.startsWith('0000') ||
    !Number.isFinite(Date.parse(row.observed_at)) ||
    new Date(row.observed_at).toISOString() !== row.observed_at
  )
    throw new TypeError();
  const original = parsePackSaveOriginal(row.original);
  const receipt = object(row.receipt, ['schema_version', 'trace_id', 'source_refs', 'data']);
  if (typeof receipt.trace_id !== 'string') throw new TypeError();
  return {
    schema_version: 1,
    kind: 'context-pack-save-observation',
    observed_at: row.observed_at,
    original,
    receipt: parseContextPackSaveReceiptEnvelope(
      receipt,
      contextPackSaveReceiptQuery(original),
      receipt.trace_id,
    ),
  };
}
export function contextPackSaveReceiptDocumentJson(input: unknown): string {
  return syncJsonSnapshot(
    parseContextPackSaveReceiptDocument(input),
    CONTEXT_PACK_SAVE_RECEIPT_DOCUMENT_BYTES,
  );
}
/** Structural parsing only. File adapters must calculate and compare document_sha256. */
export function parseContextPackSaveReceiptFile(input: unknown): ContextPackSaveReceiptFile {
  const row = object(JSON.parse(syncJsonSnapshot(input, CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
    throw new TypeError();
  return {
    document: parseContextPackSaveReceiptDocument(row.document),
    document_sha256: row.document_sha256,
  };
}
export function contextPackSaveReceiptFileJson(input: unknown): string {
  return syncJsonSnapshot(
    parseContextPackSaveReceiptFile(input),
    CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES,
  );
}
