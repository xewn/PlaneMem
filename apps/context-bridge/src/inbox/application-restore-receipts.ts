import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { applicationDigest, applicationFailure, applicationTrace } from './application-model.js';
import {
  parseInboxApplicationRestoreQuery,
  type SyncInboxApplicationRestoreQuery,
  type restoreInboxApplicationHistory,
} from './application-restore.js';
import { parseInboxApplicationRestoreTarget } from './application-restore-target.js';
import { SYNC_INBOX_APPLICATION_RESTORE_RECEIPT_SCHEMA_V1 } from './application-restore-receipt-schema.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const schema = {
  sync_inbox_application_restore_receipt_schema: ['singleton', 'version'],
  sync_inbox_application_restore_receipts: [
    'consumer_key',
    'application_key',
    'restore_request_id',
    'request_sha256',
    'receipt_json',
    'receipt_sha256',
  ],
};
const objects = [
  ...Object.keys(schema).map((name) => [name, 'table'] as const),
  ['sync_inbox_application_restore_receipts_no_update', 'trigger'],
  ['sync_inbox_application_restore_receipts_no_delete', 'trigger'],
] as const;

export function parseInboxApplicationRestoreReceiptQuery(input: unknown, trace: string) {
  const query = parseInboxApplicationRestoreQuery(input, trace);
  if (query.restore_request_id === undefined)
    throw applicationFailure(
      'INBOX_APPLICATION_RESTORE_RECEIPT_QUERY_INVALID',
      'Supply the complete original restore query including restore_request_id',
      trace,
    );
  return { ...query, restore_request_id: query.restore_request_id };
}

function record(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(data, field))
  )
    throw new TypeError();
  return data;
}
function count(value: unknown, max: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new TypeError();
  return value;
}
/** Parse all persisted fields and relationships, then reconstruct the canonical receipt. */
function parseReceipt(input: unknown, trace: string) {
  const data = record(input, [
    'schema_version',
    'kind',
    'query',
    'request_sha256',
    'restore_trace_id',
    'outcome',
  ]);
  if (data.schema_version !== 1 || data.kind !== 'application-restore-receipt')
    throw new TypeError();
  const query = parseInboxApplicationRestoreReceiptQuery(data.query, trace);
  const request_sha256 = applicationDigest(data.request_sha256);
  if (hash(syncJsonSnapshot(query, 16384)) !== request_sha256) throw new TypeError();
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
    target_before: parseInboxApplicationRestoreTarget(raw.target_before),
    target_after: parseInboxApplicationRestoreTarget(raw.target_after),
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
    restore_trace_id: applicationTrace(data.restore_trace_id),
    outcome,
  };
}
export type SyncInboxApplicationRestoreReceipt = ReturnType<typeof parseReceipt>;

/** All operations use the caller's transaction. No nested transaction or implicit enable. */
export class InboxApplicationRestoreReceipts {
  constructor(private readonly db: DatabaseSync) {}
  require(trace: string) {
    try {
      for (const [name, type] of objects) {
        const rows = this.db
          .prepare('SELECT type, tbl_name FROM sqlite_master WHERE name = ? LIMIT 2')
          .all(name);
        if (
          rows.length !== 1 ||
          rows[0]?.type !== type ||
          rows[0]?.tbl_name !==
            (type === 'table' ? name : 'sync_inbox_application_restore_receipts')
        )
          throw new TypeError();
      }
      const versions = this.db
        .prepare(
          'SELECT singleton, version FROM sync_inbox_application_restore_receipt_schema LIMIT 2',
        )
        .all();
      if (versions.length !== 1 || versions[0]?.singleton !== 1 || versions[0]?.version !== 1)
        throw new TypeError();
      for (const [name, columns] of Object.entries(schema)) {
        const stored = this.db.prepare(`PRAGMA table_info(${name})`).all();
        const receiptTable = name === 'sync_inbox_application_restore_receipts';
        if (
          stored.length !== columns.length ||
          columns.some((column, index) => {
            const row = stored[index];
            return (
              !row ||
              row.name !== column ||
              row.type !== (receiptTable ? 'TEXT' : 'INTEGER') ||
              row.pk !== (receiptTable ? (index < 3 ? index + 1 : 0) : index === 0 ? 1 : 0) ||
              ((receiptTable || index > 0) && row.notnull !== 1)
            );
          })
        )
          throw new TypeError();
      }
    } catch {
      throw applicationFailure(
        'INBOX_APPLICATION_RESTORE_RECEIPT_SCHEMA_REQUIRED',
        'Explicitly enable the complete application restore receipt extension; partial schemas are never repaired',
        trace,
      );
    }
  }
  enable(trace: string) {
    const present = objects.some(([name]) =>
      this.db.prepare('SELECT 1 FROM sqlite_master WHERE name = ? LIMIT 1').get(name),
    );
    if (!present) this.db.exec(SYNC_INBOX_APPLICATION_RESTORE_RECEIPT_SCHEMA_V1);
    this.require(trace);
    return {
      status: present ? ('already-enabled' as const) : ('enabled' as const),
      version: 1 as const,
    };
  }
  read(
    key: { consumer: string; application: string },
    query: SyncInboxApplicationRestoreQuery,
    trace: string,
  ): SyncInboxApplicationRestoreReceipt | undefined {
    if (query.restore_request_id === undefined) return undefined;
    this.require(trace);
    const rows = this.db
      .prepare(
        `SELECT
      CASE WHEN typeof(consumer_key) = 'text' AND length(CAST(consumer_key AS BLOB)) = 64 THEN consumer_key END AS consumer_key,
      CASE WHEN typeof(application_key) = 'text' AND length(CAST(application_key AS BLOB)) = 64 THEN application_key END AS application_key,
      CASE WHEN typeof(restore_request_id) = 'text' AND length(CAST(restore_request_id AS BLOB)) <= 1020 THEN restore_request_id END AS restore_request_id,
      CASE WHEN typeof(request_sha256) = 'text' AND length(CAST(request_sha256 AS BLOB)) = 64 THEN request_sha256 END AS request_sha256,
      CASE WHEN typeof(receipt_sha256) = 'text' AND length(CAST(receipt_sha256 AS BLOB)) = 64 THEN receipt_sha256 END AS receipt_sha256,
      CASE WHEN typeof(receipt_json) = 'text' AND length(CAST(receipt_json AS BLOB)) <= 65536 THEN receipt_json END AS receipt_json
      FROM sync_inbox_application_restore_receipts
      WHERE consumer_key = ? AND application_key = ? AND restore_request_id = ? LIMIT 2`,
      )
      .all(key.consumer, key.application, query.restore_request_id);
    if (rows.length === 0) return undefined;
    let receipt: SyncInboxApplicationRestoreReceipt;
    try {
      const row = rows[0];
      if (
        rows.length !== 1 ||
        !row ||
        typeof row.receipt_json !== 'string' ||
        row.consumer_key !== key.consumer ||
        row.application_key !== key.application ||
        row.restore_request_id !== query.restore_request_id
      )
        throw new TypeError();
      receipt = parseReceipt(
        JSON.parse(syncJsonSnapshot(JSON.parse(row.receipt_json), 65536)),
        trace,
      );
      if (
        JSON.stringify(receipt) !== row.receipt_json ||
        hash(row.receipt_json) !== row.receipt_sha256 ||
        receipt.request_sha256 !== row.request_sha256 ||
        receipt.query.restore_request_id !== query.restore_request_id ||
        hash(JSON.stringify(receipt.query.expected_identity)) !== key.consumer ||
        hash(JSON.stringify(receipt.query.application)) !== key.application
      )
        throw new TypeError();
    } catch {
      throw applicationFailure(
        'INBOX_APPLICATION_RESTORE_RECEIPT_CORRUPT',
        'The selected historical restore receipt is inconsistent; preserve the inbox',
        trace,
      );
    }
    if (JSON.stringify(receipt.query) !== JSON.stringify(query))
      throw new ContractError(
        'INBOX_APPLICATION_RESTORE_REQUEST_ID_REUSED',
        'This restore_request_id already belongs to a different original query; use its complete original query to inspect the receipt',
        {
          trace_id: trace,
          retryable: false,
          details: {
            restore_request_id: query.restore_request_id,
            supplied_request_sha256: hash(syncJsonSnapshot(query, 16384)),
            recorded_request_sha256: receipt.request_sha256,
          },
        },
      );
    return receipt;
  }
  save(
    key: { consumer: string; application: string },
    query: SyncInboxApplicationRestoreQuery,
    restored: ReturnType<typeof restoreInboxApplicationHistory>,
    trace: string,
  ) {
    if (query.restore_request_id === undefined) return undefined;
    const receipt = parseReceipt(
      {
        schema_version: 1,
        kind: 'application-restore-receipt',
        query,
        request_sha256: hash(syncJsonSnapshot(query, 16384)),
        restore_trace_id: trace,
        outcome: {
          status: restored.status,
          added_received_pages: restored.sources.added_received_pages,
          added_application_pages: restored.added_application_pages,
          added_application_events: restored.added_application_events,
          application_page_count: restored.restored.checked_pages,
          application_event_count: restored.restored.checked_events,
          received_page_count: restored.sources.received_page_count,
          target_before: restored.target_before,
          target_after: restored.target_after,
        },
      },
      trace,
    );
    const json = syncJsonSnapshot(receipt, 65536);
    this.db
      .prepare(
        `INSERT INTO sync_inbox_application_restore_receipts
      (consumer_key, application_key, restore_request_id, request_sha256, receipt_json, receipt_sha256)
      VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        key.consumer,
        key.application,
        query.restore_request_id,
        receipt.request_sha256,
        json,
        hash(json),
      );
    const readback = this.read(key, query, trace);
    if (!readback || JSON.stringify(readback) !== json)
      throw applicationFailure(
        'INBOX_APPLICATION_RESTORE_RECEIPT_READBACK_FAILED',
        'The original restore receipt could not be confirmed before commit',
        trace,
      );
    return readback;
  }
}
