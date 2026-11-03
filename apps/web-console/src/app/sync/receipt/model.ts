import {
  parseSyncEventReceiptQuery,
  parseSyncEventReceiptFile,
  parseSyncEventReceiptDocument,
  syncEventReceiptDocumentJson,
  syncJsonSnapshot,
  SYNC_EVENT_RECEIPT_REQUEST_BYTES,
  SYNC_EVENT_RECEIPT_FILE_BYTES,
  type SyncEventReceiptQuery,
  type SyncEventReceiptEnvelope,
  type SyncEventReceiptFile,
} from '@planemem/contracts';

export { SYNC_EVENT_RECEIPT_FILE_BYTES };
export const receiptMessages = {
  signin: 'Sign in as the original account and client, then check again. Keep the original event.',
  denied:
    'This session cannot read the original event in its saved project. Restore the original account, client and sync access.',
  mismatch:
    'This event ID is bound to different content. Recover the complete original event without changing its ID or identity.',
  invalid:
    'The complete original query or response could not be verified. Keep the original data for another explicit check.',
  busy: 'Receipt lookup is busy. The original event remains available for another explicit check.',
  timeout:
    'This lookup exceeded its local waiting period. Delivery remains unconfirmed by this lookup.',
  unavailable:
    'The original delivery could not be checked. This does not prove failure or allow a new event to replace it.',
} as const;
export type SyncReceiptReason = keyof typeof receiptMessages;
export interface SyncReceiptFailure {
  schema_version: 1;
  trace_id: string;
  error: { reason: SyncReceiptReason };
}
export interface LoadedSyncReceipt {
  query: SyncEventReceiptQuery;
  imported?: SyncEventReceiptFile;
}
export const validSyncReceiptTrace = (value: string) =>
  /^trace_web_sync_receipt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );

function decode(raw: unknown, maximum: number): unknown {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > maximum ||
    new TextEncoder().encode(raw).byteLength > maximum
  )
    throw new TypeError('Original JSON exceeds its read limit');
  return JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
}
export function decodeSyncReceiptQuery(raw: unknown) {
  return parseSyncEventReceiptQuery(decode(raw, SYNC_EVENT_RECEIPT_REQUEST_BYTES));
}
export function encodeSyncReceiptQuery(value: unknown) {
  return syncJsonSnapshot(parseSyncEventReceiptQuery(value), SYNC_EVENT_RECEIPT_REQUEST_BYTES);
}
async function hash(raw: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** Import does not query a server or promote an archived receipt to a new observation. */
export async function loadSyncReceiptInput(raw: unknown): Promise<LoadedSyncReceipt> {
  const value = decode(raw, SYNC_EVENT_RECEIPT_FILE_BYTES);
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'document')
  ) {
    const saved = parseSyncEventReceiptFile(value);
    if ((await hash(syncEventReceiptDocumentJson(saved.document))) !== saved.document_sha256)
      throw new TypeError('Receipt file digest differs');
    const receipt = saved.document.receipt;
    return {
      query: parseSyncEventReceiptQuery({
        identity: receipt.data.identity,
        event: receipt.data.event,
      }),
      imported: saved,
    };
  }
  return { query: parseSyncEventReceiptQuery(value) };
}
export async function encodeSyncReceiptArchive(receipt: SyncEventReceiptEnvelope) {
  const document = parseSyncEventReceiptDocument({
    schema_version: 1,
    kind: 'workctx.sync-event-receipt',
    receipt,
  });
  return syncJsonSnapshot(
    { document, document_sha256: await hash(syncEventReceiptDocumentJson(document)) },
    SYNC_EVENT_RECEIPT_FILE_BYTES,
  );
}
export function parseSyncReceiptFailure(value: unknown, trace: string): SyncReceiptFailure {
  const snapshot: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError();
  const row = snapshot as Record<string, unknown>;
  if (
    Object.keys(row).length !== 3 ||
    Object.keys(row).some((key) => !['schema_version', 'trace_id', 'error'].includes(key)) ||
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !row.error ||
    typeof row.error !== 'object' ||
    Array.isArray(row.error)
  )
    throw new TypeError();
  const error = row.error as Record<string, unknown>;
  if (
    Object.keys(error).length !== 1 ||
    typeof error.reason !== 'string' ||
    !Object.hasOwn(receiptMessages, error.reason)
  )
    throw new TypeError();
  return {
    schema_version: 1,
    trace_id: trace,
    error: { reason: error.reason as SyncReceiptReason },
  };
}
