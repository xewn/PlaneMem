import {
  parseSyncEventReceiptEnvelope,
  parseSyncEventReceiptQuery,
  SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
  type SyncEventReceiptEnvelope,
} from './sync-event-receipt.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export interface SyncEventReceiptDocument {
  schema_version: 1;
  kind: 'workctx.sync-event-receipt';
  /** Historical query only; this does not describe any local queue settlement. */
  receipt: SyncEventReceiptEnvelope;
}
export interface SyncEventReceiptFile {
  document: SyncEventReceiptDocument;
  document_sha256: string;
}
export const SYNC_EVENT_RECEIPT_DOCUMENT_BYTES = SYNC_EVENT_RECEIPT_RESPONSE_BYTES + 4096;
export const SYNC_EVENT_RECEIPT_FILE_BYTES = SYNC_EVENT_RECEIPT_DOCUMENT_BYTES + 4096;

function row(value: unknown, keys?: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (keys &&
      (Object.keys(value).length !== keys.length ||
        Object.keys(value).some((key) => !keys.includes(key))))
  )
    throw new TypeError('Invalid event receipt file fields');
  return value as Record<string, unknown>;
}

/** Self-consistency only; an offline document cannot authenticate a server response. */
export function parseSyncEventReceiptDocument(value: unknown): SyncEventReceiptDocument {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_EVENT_RECEIPT_DOCUMENT_BYTES)), [
    'schema_version',
    'kind',
    'receipt',
  ]);
  if (input.schema_version !== 1 || input.kind !== 'workctx.sync-event-receipt')
    throw new TypeError('Invalid event receipt document');
  const receipt = row(input.receipt);
  const data = row(receipt.data);
  if (typeof receipt.trace_id !== 'string') throw new TypeError('Missing query trace');
  const query = parseSyncEventReceiptQuery({ identity: data.identity, event: data.event });
  return {
    schema_version: 1,
    kind: 'workctx.sync-event-receipt',
    receipt: parseSyncEventReceiptEnvelope(receipt, query, receipt.trace_id),
  };
}
export function syncEventReceiptDocumentJson(value: unknown): string {
  return syncJsonSnapshot(parseSyncEventReceiptDocument(value), SYNC_EVENT_RECEIPT_DOCUMENT_BYTES);
}
/** Structural parsing only; file adapters must verify document_sha256 independently. */
export function parseSyncEventReceiptFile(value: unknown): SyncEventReceiptFile {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_EVENT_RECEIPT_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof input.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.document_sha256))
    throw new TypeError('Invalid receipt document digest');
  return {
    document: parseSyncEventReceiptDocument(input.document),
    document_sha256: input.document_sha256,
  };
}
