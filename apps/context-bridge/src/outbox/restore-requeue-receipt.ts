import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { OUTBOX_ARCHIVE_DOCUMENT_BYTES, type OutboxArchiveFile } from './archive.js';
import {
  assertOutboxRestoreTrace,
  outboxRestoreBudget,
  outboxRestoreReceiptTable,
  outboxRestoreStoredRecord,
  outboxRestoreRecordV1,
  type OutboxRestoreReceipt,
} from './restore.js';
import { outboxReadTransaction } from './reading.js';
import {
  parseOutboxRestoreRequeueReceiptQuery,
  parseOutboxRestoreRequeueSelection,
  type OutboxRestoreRequeueQuery,
  type OutboxRestoreRequeueReceiptQuery,
  type OutboxRestoreRequeueSelection,
} from './restore-requeue-query.js';

const TABLE = 'local_outbox_requeue_receipts';
const QUERY_BYTES = 16384;
const RECEIPT_FIELDS: readonly [string, number][] = [
  ['query_json', QUERY_BYTES],
  ['query_sha256', 64],
  ['restore_document_sha256', 64],
  ['restore_receipt_sha256', 64],
  ['before_sha256', 64],
  ['after_sha256', 64],
  ['requeued_at', 64],
  ['requeue_trace_id', 4096],
];
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Fixed bounded projection shared by metadata discovery and complete history verification. */
export function outboxRequeueReceiptProjection() {
  return (
    `CASE WHEN typeof(schema_version) = 'integer' AND schema_version = 1 THEN 1 ELSE NULL END AS schema_version, ` +
    RECEIPT_FIELDS.map(
      ([name, max]) =>
        `CASE WHEN typeof(${name}) = 'text' AND length(CAST(${name} AS BLOB)) <= ${max} THEN ${name} ELSE NULL END AS ${name}`,
    ).join(', ')
  );
}
export function outboxRequeueReceiptMetadata(
  row: Record<string, unknown>,
  selection: OutboxRestoreRequeueSelection,
  trace: string,
) {
  try {
    if (row.schema_version !== 1 || RECEIPT_FIELDS.some(([name]) => typeof row[name] !== 'string'))
      throw new TypeError();
    const original = parseOutboxRestoreRequeueReceiptQuery(
      JSON.parse(row.query_json as string),
      trace,
    );
    if (
      original.requeue_id !== selection.requeue_id ||
      original.scope.tenant_id !== selection.scope.tenant_id ||
      original.scope.workspace_id !== selection.scope.workspace_id ||
      original.scope.project_id !== selection.scope.project_id ||
      digest(syncJsonSnapshot(original, QUERY_BYTES)) !== row.query_sha256 ||
      ['restore_document_sha256', 'restore_receipt_sha256', 'before_sha256', 'after_sha256'].some(
        (name) => !/^[a-f0-9]{64}$/.test(row[name] as string),
      ) ||
      !Number.isFinite(Date.parse(row.requeued_at as string)) ||
      new Date(row.requeued_at as string).toISOString() !== row.requeued_at
    )
      throw new TypeError();
    assertOutboxRestoreTrace(row.requeue_trace_id as string);
    return {
      original_query: original,
      query_sha256: row.query_sha256 as string,
      restore_document_sha256: row.restore_document_sha256 as string,
      restore_receipt_sha256: row.restore_receipt_sha256 as string,
      before_sha256: row.before_sha256 as string,
      after_sha256: row.after_sha256 as string,
      requeued_at: row.requeued_at as string,
      requeue_trace_id: row.requeue_trace_id as string,
    };
  } catch (error) {
    throw fail(
      'OUTBOX_REQUEUE_RECEIPT_INVALID',
      'The stored original requeue query or receipt metadata is invalid',
      trace,
      error instanceof ContractError
        ? { ...error.envelope.details, cause_code: error.envelope.code }
        : {},
    );
  }
}

/** Immutable requeue v1 selection and mapping, also used to verify historical receipts. */
export function outboxRequeueSelection(
  source: OutboxArchiveFile,
  query: OutboxRestoreRequeueQuery,
  trace: string,
  check: () => void,
  select: (event_id: string | null) => void = () => {},
) {
  const originals = new Map(source.document.records.map((row) => [row.event_id, row]));
  const changes: {
    event_id: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }[] = [];
  for (const event_id of query.event_ids) {
    select(event_id);
    check();
    const original = originals.get(event_id);
    if (!original)
      throw fail(
        'OUTBOX_RESTORE_EVENT_NOT_FOUND',
        'A selected event is absent from the verified original archive',
        trace,
        { selected_event_id: event_id },
      );
    if (original.status === 'sent' || original.status === 'conflict')
      throw fail(
        'OUTBOX_RESTORE_REQUEUE_TERMINAL',
        'Historical terminal events cannot be requeued through restore review',
        trace,
        { selected_event_id: event_id },
      );
    const before = outboxRestoreRecordV1(original);
    if (
      before.server_event_id !== null ||
      before.server_cursor !== null ||
      before.conflict_id !== null
    )
      throw fail(
        'OUTBOX_RESTORE_REQUEUE_DELIVERY_EVIDENCE',
        'The selected original contains delivery metadata; reconcile it explicitly before proceeding',
        trace,
        { selected_event_id: event_id },
      );
    changes.push({
      event_id,
      before,
      after: {
        ...before,
        status: 'pending',
        attempt: 0,
        last_error: null,
        next_retry_at: '1970-01-01T00:00:00.000Z',
      },
    });
  }
  select(null);
  check();
  return changes;
}

/** Optional schema inspection; callers own the transaction and never initialize on a read. */
export function outboxRequeueReceiptTable(db: DatabaseSync, trace: string) {
  const entries = db
    .prepare('SELECT type FROM main.sqlite_schema WHERE name = ? COLLATE NOCASE')
    .all(TABLE);
  if (!entries.length) return false;
  if (entries.length !== 1 || entries[0]!.type !== 'table')
    throw fail(
      'OUTBOX_REQUEUE_STORAGE_INVALID',
      'The requeue receipt name is not a unique table',
      trace,
    );
  const columns = new Set(
    db
      .prepare('PRAGMA main.table_info(local_outbox_requeue_receipts)')
      .all()
      .map((row) => row.name),
  );
  if (
    [
      'schema_version',
      'requeue_id',
      'tenant_id',
      'workspace_id',
      'project_id',
      'query_json',
      'query_sha256',
      'restore_document_sha256',
      'restore_receipt_sha256',
      'before_sha256',
      'after_sha256',
      'requeued_at',
      'requeue_trace_id',
    ].some((name) => !columns.has(name))
  )
    throw fail(
      'OUTBOX_REQUEUE_STORAGE_INVALID',
      'The requeue receipt table lacks required columns; preserve the queue',
      trace,
    );
  return true;
}
export function createOutboxRequeueReceiptTable(db: DatabaseSync) {
  db.exec(`CREATE TABLE main.local_outbox_requeue_receipts (
    schema_version INTEGER NOT NULL CHECK (schema_version = 1), requeue_id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
    query_json TEXT NOT NULL, query_sha256 TEXT NOT NULL, restore_document_sha256 TEXT NOT NULL, restore_receipt_sha256 TEXT NOT NULL,
    before_sha256 TEXT NOT NULL, after_sha256 TEXT NOT NULL,
    requeued_at TEXT NOT NULL, requeue_trace_id TEXT NOT NULL
  )`);
}
export function outboxRequeueReceiptCandidate(
  query: OutboxRestoreRequeueReceiptQuery,
  source: OutboxArchiveFile,
  restore_receipt: OutboxRestoreReceipt,
  requeued_at: string,
  requeue_trace_id: string,
  trace: string,
  check: () => void,
) {
  assertOutboxRestoreTrace(requeue_trace_id);
  if (
    !Number.isFinite(Date.parse(requeued_at)) ||
    new Date(requeued_at).toISOString() !== requeued_at ||
    !/^[a-f0-9]{64}$/.test(restore_receipt.restored_document_sha256)
  )
    throw fail('OUTBOX_REQUEUE_RECEIPT_INVALID', 'The original requeue metadata is invalid', trace);
  const changes = outboxRequeueSelection(source, query, trace, check);
  const before_sha256 = digest(
    syncJsonSnapshot(
      changes.map((change) => change.before),
      OUTBOX_ARCHIVE_DOCUMENT_BYTES,
    ),
  );
  check();
  const after_sha256 = digest(
    syncJsonSnapshot(
      changes.map((change) => change.after),
      OUTBOX_ARCHIVE_DOCUMENT_BYTES,
    ),
  );
  check();
  const receipt = {
    schema_version: 1 as const,
    query,
    query_sha256: digest(syncJsonSnapshot(query, QUERY_BYTES)),
    restore_document_sha256: restore_receipt.restored_document_sha256,
    restore_receipt_sha256: digest(syncJsonSnapshot(restore_receipt, 32 * 1024)),
    before_sha256,
    after_sha256,
    selected_records: query.event_ids.length,
    requeued_at,
    requeue_trace_id,
    observation: 'committed-local-restore-requeue-history' as const,
    mapping: 'restore-requeue/1' as const,
    control_at_requeue: { state: 'paused' as const, generation: query.expected_control_generation },
    current_queue: 'not-checked' as const,
    current_control: 'not-checked' as const,
    server_delivery: 'not-checked' as const,
    sender_stopped: 'not-proven' as const,
    source_authenticity: 'not-proven' as const,
  };
  syncJsonSnapshot(receipt, 64 * 1024);
  check();
  return receipt;
}
export type OutboxRestoreRequeueReceipt = ReturnType<typeof outboxRequeueReceiptCandidate>;

/** Exact global request identity lookup. No current event or send-control reads. */
export function outboxOriginalRequeueReceipt(
  db: DatabaseSync,
  query: OutboxRestoreRequeueReceiptQuery,
  trace: string,
  check: () => void,
): { present: boolean; recorded: OutboxRestoreRequeueReceipt | null } {
  const { present, recorded } = outboxStoredRequeueRecord(db, query, trace, check, query);
  return { present, recorded };
}

/** Shared full reader within the caller's transaction, including the verified parent for export. */
export function outboxStoredRequeueRecord(
  db: DatabaseSync,
  query: OutboxRestoreRequeueSelection,
  trace: string,
  check: () => void,
  expectedQuery?: OutboxRestoreRequeueReceiptQuery,
): {
  present: boolean;
  recorded: OutboxRestoreRequeueReceipt | null;
  history: ReturnType<typeof outboxRestoreStoredRecord>;
} {
  check();
  const present = outboxRequeueReceiptTable(db, trace);
  if (!present) return { present, recorded: null, history: null };
  const occupied = db
    .prepare(
      'SELECT 1 AS present FROM main.local_outbox_requeue_receipts WHERE requeue_id = ? COLLATE BINARY LIMIT 2',
    )
    .all(query.requeue_id);
  if (!occupied.length) return { present, recorded: null, history: null };
  if (occupied.length !== 1)
    throw fail(
      'OUTBOX_REQUEUE_RECEIPT_INVALID',
      'The requeue ID is ambiguous; preserve the queue',
      trace,
    );
  const rows = db
    .prepare(
      `SELECT ${outboxRequeueReceiptProjection()}
    FROM main.local_outbox_requeue_receipts WHERE requeue_id = ? COLLATE BINARY AND tenant_id = ? COLLATE BINARY
    AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY LIMIT 2`,
    )
    .all(query.requeue_id, query.scope.tenant_id, query.scope.workspace_id, query.scope.project_id);
  if (!rows.length)
    throw fail(
      'OUTBOX_REQUEUE_ID_UNAVAILABLE',
      'This requeue ID is already occupied by another project',
      trace,
    );
  const row = rows[0]!;
  if (rows.length !== 1)
    throw fail('OUTBOX_REQUEUE_RECEIPT_INVALID', 'The selected requeue ID is ambiguous', trace);
  const saved = outboxRequeueReceiptMetadata(row, query, trace).original_query;
  if (
    expectedQuery !== undefined &&
    syncJsonSnapshot(saved, QUERY_BYTES) !== syncJsonSnapshot(expectedQuery, QUERY_BYTES)
  )
    throw fail(
      'OUTBOX_REQUEUE_ID_REUSED',
      'This requeue ID belongs to a different original request; preserve that request',
      trace,
    );
  try {
    const history = outboxRestoreStoredRecord(
      db,
      saved,
      trace,
      outboxRestoreReceiptTable(db, trace),
    );
    if (
      !history ||
      history.source.document_sha256 !== saved.archive_sha256 ||
      history.receipt.restored_document_sha256 !== row.restore_document_sha256
    )
      throw new TypeError();
    const recorded = outboxRequeueReceiptCandidate(
      saved,
      history.source,
      history.receipt,
      row.requeued_at as string,
      row.requeue_trace_id as string,
      trace,
      check,
    );
    if (
      recorded.before_sha256 !== row.before_sha256 ||
      recorded.after_sha256 !== row.after_sha256 ||
      recorded.restore_receipt_sha256 !== row.restore_receipt_sha256
    )
      throw new TypeError();
    check();
    return { present, recorded, history };
  } catch (error) {
    if (error instanceof ContractError && error.envelope.code === 'OUTBOX_RESTORE_TIMEOUT')
      throw error;
    throw fail(
      'OUTBOX_REQUEUE_RECEIPT_INVALID',
      'The complete original requeue history or selected-record digests could not be verified',
      trace,
      error instanceof ContractError
        ? { ...error.envelope.details, cause_code: error.envelope.code }
        : {},
    );
  }
}

/** Explicit ID discovery never substitutes a new control generation or changes an original request. */
export function readOutboxRestoreRequeueRecord(db: DatabaseSync, input: unknown, trace: string) {
  const selection = parseOutboxRestoreRequeueSelection(input, trace);
  assertOutboxRestoreTrace(trace);
  const check = outboxRestoreBudget(trace);
  let historical_receipt: OutboxRestoreRequeueReceipt | null = null;
  try {
    return outboxReadTransaction(
      db,
      () => {
        const { recorded } = outboxStoredRequeueRecord(db, selection, trace, check);
        historical_receipt = recorded;
        const result = {
          scope: selection.scope,
          selection,
          status: recorded ? ('recorded' as const) : ('not-observed' as const),
          original_query: recorded?.query ?? null,
          receipt: recorded,
          observation: 'original-requeue-request-lookup' as const,
          current_queue: 'not-checked' as const,
          current_control: 'not-checked' as const,
          server_delivery: 'not-checked' as const,
          local_commit: 'not-attempted' as const,
          observed_at: new Date().toISOString(),
        };
        syncJsonSnapshot(result, 128 * 1024);
        check();
        return result;
      },
      trace,
    );
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_RECORD_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The original requeue request and receipt could not be read',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        selection,
        historical_receipt,
        local_commit: 'not-attempted',
      },
    );
  }
}

export function saveOutboxRequeueReceipt(
  db: DatabaseSync,
  receipt: OutboxRestoreRequeueReceipt,
  trace: string,
) {
  const query = receipt.query;
  const changed = db
    .prepare(
      `INSERT INTO main.local_outbox_requeue_receipts
    (schema_version, requeue_id, tenant_id, workspace_id, project_id, query_json, query_sha256, restore_document_sha256, restore_receipt_sha256,
     before_sha256, after_sha256, requeued_at, requeue_trace_id) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      query.requeue_id,
      query.scope.tenant_id,
      query.scope.workspace_id,
      query.scope.project_id,
      syncJsonSnapshot(query, QUERY_BYTES),
      receipt.query_sha256,
      receipt.restore_document_sha256,
      receipt.restore_receipt_sha256,
      receipt.before_sha256,
      receipt.after_sha256,
      receipt.requeued_at,
      receipt.requeue_trace_id,
    );
  if (Number(changed.changes) !== 1)
    throw fail(
      'OUTBOX_REQUEUE_RECEIPT_WRITE_FAILED',
      'The original requeue receipt was not saved exactly once',
      trace,
    );
}

export function readOutboxRestoreRequeueReceipt(db: DatabaseSync, input: unknown, trace: string) {
  const query = parseOutboxRestoreRequeueReceiptQuery(input, trace);
  assertOutboxRestoreTrace(trace);
  const check = outboxRestoreBudget(trace);
  let historical_receipt: OutboxRestoreRequeueReceipt | null = null;
  try {
    return outboxReadTransaction(
      db,
      () => {
        const { recorded } = outboxOriginalRequeueReceipt(db, query, trace, check);
        historical_receipt = recorded;
        const result = {
          scope: query.scope,
          query,
          receipt: recorded,
          status: recorded ? ('recorded' as const) : ('not-observed' as const),
          local_commit: 'not-attempted' as const,
          current_queue: 'not-checked' as const,
          current_control: 'not-checked' as const,
          server_delivery: 'not-checked' as const,
          observed_at: new Date().toISOString(),
        };
        syncJsonSnapshot(result, 128 * 1024);
        check();
        return result;
      },
      trace,
    );
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_RECEIPT_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The original requeue receipt could not be read',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        historical_receipt,
        local_commit: 'not-attempted',
      },
    );
  }
}
