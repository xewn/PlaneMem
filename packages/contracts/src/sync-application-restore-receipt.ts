import { isSyncIdentifier } from './sync.js';
import { parseSyncCommandIdentity, type SyncCommandIdentity } from './sync-command-context.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const SYNC_APPLICATION_RESTORE_QUERY_BYTES = 16384;
export const SYNC_APPLICATION_RESTORE_RECEIPT_BYTES = 65536;
export const SYNC_APPLICATION_RESTORE_RECEIPT_DOCUMENT_BYTES = 65536 + 1024;
export const SYNC_APPLICATION_RESTORE_RECEIPT_FILE_BYTES = 65536 + 2048;
export interface SyncApplicationRestoreTarget {
  schema_version: 1;
  application_history_sha256: string;
  received_history_sha256: string;
}
export interface SyncApplicationRestoreQuery {
  expected_identity: SyncCommandIdentity;
  application: { name: string; version: string };
  timeout_ms: number;
  archive_document_sha256: string;
  restore_request_id?: string;
  expected_target?: SyncApplicationRestoreTarget;
}
function record(value: unknown, fields: readonly string[], exact = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const data = value as Record<string, unknown>;
  if (
    (exact && Object.keys(data).length !== fields.length) ||
    Object.keys(data).some((field) => !fields.includes(field))
  )
    throw new TypeError();
  return data;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError();
  return value;
}
function count(value: unknown, max: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new TypeError();
  return value;
}
function trace(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError();
  return value;
}
export function parseSyncApplicationRestoreTarget(value: unknown): SyncApplicationRestoreTarget {
  const row = record(JSON.parse(syncJsonSnapshot(value, 1024)), [
    'schema_version',
    'application_history_sha256',
    'received_history_sha256',
  ]);
  if (row.schema_version !== 1) throw new TypeError();
  return {
    schema_version: 1,
    application_history_sha256: digest(row.application_history_sha256),
    received_history_sha256: digest(row.received_history_sha256),
  };
}
/** Fixed ordering preserves the original Bridge v1 query fingerprints and persisted receipt JSON. */
export function parseSyncApplicationRestoreQuery(value: unknown): SyncApplicationRestoreQuery {
  const row = record(
    JSON.parse(syncJsonSnapshot(value, SYNC_APPLICATION_RESTORE_QUERY_BYTES)),
    [
      'expected_identity',
      'application',
      'timeout_ms',
      'archive_document_sha256',
      'restore_request_id',
      'expected_target',
    ],
    false,
  );
  const application = record(row.application, ['name', 'version']);
  if (
    !isSyncIdentifier(application.name) ||
    !isSyncIdentifier(application.version) ||
    (row.restore_request_id !== undefined && !isSyncIdentifier(row.restore_request_id))
  )
    throw new TypeError();
  const timeout_ms = count(row.timeout_ms === undefined ? 30000 : row.timeout_ms, 90000);
  if (timeout_ms < 1) throw new TypeError();
  return {
    expected_identity: parseSyncCommandIdentity(row.expected_identity),
    application: { name: application.name, version: application.version },
    timeout_ms,
    archive_document_sha256: digest(row.archive_document_sha256),
    ...(row.restore_request_id === undefined
      ? {}
      : { restore_request_id: row.restore_request_id as string }),
    ...(row.expected_target === undefined
      ? {}
      : { expected_target: parseSyncApplicationRestoreTarget(row.expected_target) }),
  };
}
export function syncApplicationRestoreQueryJson(value: unknown): string {
  return syncJsonSnapshot(
    parseSyncApplicationRestoreQuery(value),
    SYNC_APPLICATION_RESTORE_QUERY_BYTES,
  );
}
/** Structural/cross-field validation only. Adapters must independently verify request_sha256. */
export function parseSyncApplicationRestoreReceipt(input: unknown) {
  const data = record(JSON.parse(syncJsonSnapshot(input, SYNC_APPLICATION_RESTORE_RECEIPT_BYTES)), [
    'schema_version',
    'kind',
    'query',
    'request_sha256',
    'restore_trace_id',
    'outcome',
  ]);
  if (data.schema_version !== 1 || data.kind !== 'application-restore-receipt')
    throw new TypeError();
  const parsed = parseSyncApplicationRestoreQuery(data.query);
  if (parsed.restore_request_id === undefined) throw new TypeError();
  const query = { ...parsed, restore_request_id: parsed.restore_request_id };
  const request_sha256 = digest(data.request_sha256);
  const raw = record(data.outcome, [
    'status',
    'added_received_pages',
    'added_application_pages',
    'added_application_events',
    'application_page_count',
    'application_event_count',
    'received_page_count',
    'target_before',
    'target_after',
  ]);
  if (raw.status !== 'restored' && raw.status !== 'already-restored' && raw.status !== 'empty')
    throw new TypeError();
  const outcome = {
    status: raw.status as 'restored' | 'already-restored' | 'empty',
    added_received_pages: count(raw.added_received_pages, 1000),
    added_application_pages: count(raw.added_application_pages, 1000),
    added_application_events: count(raw.added_application_events, 500000),
    application_page_count: count(raw.application_page_count, 1000),
    application_event_count: count(raw.application_event_count, 500000),
    received_page_count: count(raw.received_page_count, 10000),
    target_before: parseSyncApplicationRestoreTarget(raw.target_before),
    target_after: parseSyncApplicationRestoreTarget(raw.target_after),
  };
  if (
    outcome.received_page_count < outcome.application_page_count ||
    outcome.added_received_pages > outcome.added_application_pages ||
    (query.expected_target !== undefined &&
      JSON.stringify(query.expected_target) !== JSON.stringify(outcome.target_before)) ||
    (outcome.status === 'restored'
      ? outcome.application_page_count === 0 ||
        outcome.added_application_pages !== outcome.application_page_count ||
        outcome.added_application_events !== outcome.application_event_count
      : outcome.added_received_pages !== 0 ||
        outcome.added_application_pages !== 0 ||
        outcome.added_application_events !== 0) ||
    (outcome.status === 'empty'
      ? outcome.application_page_count !== 0 || outcome.application_event_count !== 0
      : outcome.application_page_count === 0) ||
    (outcome.added_application_pages === 0) !==
      (outcome.target_before.application_history_sha256 ===
        outcome.target_after.application_history_sha256) ||
    (outcome.added_received_pages === 0) !==
      (outcome.target_before.received_history_sha256 ===
        outcome.target_after.received_history_sha256)
  )
    throw new TypeError();
  return {
    schema_version: 1 as const,
    kind: 'application-restore-receipt' as const,
    query,
    request_sha256,
    restore_trace_id: trace(data.restore_trace_id),
    outcome,
  };
}
export type SyncApplicationRestoreReceipt = ReturnType<typeof parseSyncApplicationRestoreReceipt>;
export interface SyncApplicationRestoreReceiptDocument {
  schema_version: 1;
  kind: 'workctx.sync-application-restore-receipt';
  receipt: SyncApplicationRestoreReceipt;
}
export interface SyncApplicationRestoreReceiptFile {
  document: SyncApplicationRestoreReceiptDocument;
  document_sha256: string;
}
export function parseSyncApplicationRestoreReceiptDocument(
  value: unknown,
): SyncApplicationRestoreReceiptDocument {
  const row = record(
    JSON.parse(syncJsonSnapshot(value, SYNC_APPLICATION_RESTORE_RECEIPT_DOCUMENT_BYTES)),
    ['schema_version', 'kind', 'receipt'],
  );
  if (row.schema_version !== 1 || row.kind !== 'workctx.sync-application-restore-receipt')
    throw new TypeError();
  return {
    schema_version: 1,
    kind: 'workctx.sync-application-restore-receipt',
    receipt: parseSyncApplicationRestoreReceipt(row.receipt),
  };
}
export function syncApplicationRestoreReceiptDocumentJson(value: unknown): string {
  return syncJsonSnapshot(
    parseSyncApplicationRestoreReceiptDocument(value),
    SYNC_APPLICATION_RESTORE_RECEIPT_DOCUMENT_BYTES,
  );
}
/** Structural parsing only; adapters must verify both document and original-query SHA-256. */
export function parseSyncApplicationRestoreReceiptFile(
  value: unknown,
): SyncApplicationRestoreReceiptFile {
  const row = record(
    JSON.parse(syncJsonSnapshot(value, SYNC_APPLICATION_RESTORE_RECEIPT_FILE_BYTES)),
    ['document', 'document_sha256'],
  );
  return {
    document: parseSyncApplicationRestoreReceiptDocument(row.document),
    document_sha256: digest(row.document_sha256),
  };
}
