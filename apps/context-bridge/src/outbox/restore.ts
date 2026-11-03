import type { DatabaseSync } from 'node:sqlite';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import type { OutboxScope } from './sqlite.js';
import {
  OUTBOX_ARCHIVE_FILE_BYTES,
  createOutboxArchive,
  verifyOutboxArchive,
  type OutboxArchiveFile,
} from './archive.js';
import {
  OUTBOX_STORED_COLUMNS,
  parseOutboxReadScope,
  outboxStoredColumns,
  outboxReadProjection,
  outboxReadTransaction,
} from './reading.js';
import { isOutboxSendControlGeneration, outboxStoredSendControl } from './control.js';
import {
  reconciliationTransaction,
  type ReconciliationTransactionState,
} from './reconciliation.js';

const TABLE = 'local_outbox_restore_receipts';
const HOLD = 'OUTBOX_RESTORED_REVIEW_REQUIRED';
const DIGEST = /^[a-f0-9]{64}$/;
const QUERY_BYTES = 16384;
export interface OutboxRestoreQuery {
  scope: OutboxScope;
  restore_id: string;
  archive_sha256: string;
  expected_control_generation: string;
  reason: string;
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function validText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
function canonicalTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function sameScope(left: OutboxScope, right: OutboxScope) {
  return (
    left.tenant_id === right.tenant_id &&
    left.workspace_id === right.workspace_id &&
    left.project_id === right.project_id
  );
}
export function outboxRestoreBudget(trace: string) {
  const deadline = performance.now() + 90000;
  return () => {
    if (performance.now() >= deadline)
      throw fail(
        'OUTBOX_RESTORE_TIMEOUT',
        'The complete local restore operation exceeded 90 seconds',
        trace,
      );
  };
}
export function parseOutboxRestoreQuery(input: unknown, trace: string): OutboxRestoreQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, QUERY_BYTES));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    const fields = [
      'scope',
      'restore_id',
      'archive_sha256',
      'expected_control_generation',
      'reason',
    ];
    if (
      Object.keys(row).length !== fields.length ||
      Object.keys(row).some((key) => !fields.includes(key)) ||
      !isSyncIdentifier(row.restore_id) ||
      typeof row.archive_sha256 !== 'string' ||
      !DIGEST.test(row.archive_sha256) ||
      !isOutboxSendControlGeneration(row.expected_control_generation) ||
      !validText(row.reason)
    )
      throw new TypeError();
    return {
      scope: parseOutboxReadScope(row.scope, trace),
      restore_id: row.restore_id,
      archive_sha256: row.archive_sha256,
      expected_control_generation: row.expected_control_generation,
      reason: row.reason,
    };
  } catch {
    throw fail(
      'OUTBOX_RESTORE_QUERY_INVALID',
      'Supply the exact scope, original restore_id, archive_sha256, observed paused control generation and reason',
      trace,
    );
  }
}

/** Immutable v1 mapping: later format versions must not reinterpret an existing restore receipt. */
export function outboxRestoreRecordV1(record: Record<string, unknown>) {
  const terminal = record.status === 'sent' || record.status === 'conflict';
  return outboxStoredColumns({
    ...record,
    lease_token: null,
    ...(!terminal ? { status: 'failed', last_error: HOLD } : {}),
  });
}
export function outboxRestoreRecords(
  source: OutboxArchiveFile,
  restored_at: string,
  trace: string,
) {
  const records = source.document.records.map(outboxRestoreRecordV1);
  return createOutboxArchive(
    { ...source.document, observed_at: restored_at, export_trace_id: trace, records },
    trace,
  );
}
function receiptFor(
  query: OutboxRestoreQuery,
  source: OutboxArchiveFile,
  restored: OutboxArchiveFile,
) {
  let sent = 0;
  let conflict = 0;
  for (const record of source.document.records) {
    if (record.status === 'sent') sent += 1;
    if (record.status === 'conflict') conflict += 1;
  }
  return {
    schema_version: 1 as const,
    query,
    archive_sha256: source.document_sha256,
    restored_document_sha256: restored.document_sha256,
    records: source.document.records.length,
    held_records: source.document.records.length - sent - conflict,
    historical_terminal_records: { sent, conflict },
    restored_at: restored.document.observed_at,
    restore_trace_id: restored.document.export_trace_id,
    source_observed_at: source.document.observed_at,
    source_export_trace_id: source.document.export_trace_id,
    control_at_restore: { state: 'paused' as const, generation: query.expected_control_generation },
    observation: 'committed-local-restore-history' as const,
    current_queue: 'not-checked' as const,
    server_delivery: 'not-checked' as const,
    sender_stopped: 'not-proven' as const,
  };
}
export type OutboxRestoreReceipt = ReturnType<typeof receiptFor>;

/** Shared history verification for stored rows and detached backup files; performs no database IO. */
export function outboxVerifiedRestoreRecord(
  query: OutboxRestoreQuery,
  sourceInput: unknown,
  restored_at: unknown,
  restore_trace_id: unknown,
  restored_document_sha256: unknown,
  trace: string,
) {
  if (
    !canonicalTime(restored_at) ||
    !validText(restore_trace_id) ||
    typeof restored_document_sha256 !== 'string' ||
    !DIGEST.test(restored_document_sha256)
  )
    throw new TypeError();
  const source = verifyOutboxArchive(sourceInput, trace);
  if (
    !sameScope(source.document.scope, query.scope) ||
    source.document_sha256 !== query.archive_sha256
  )
    throw new TypeError();
  const restored = outboxRestoreRecords(source, restored_at, restore_trace_id);
  if (restored.document_sha256 !== restored_document_sha256) throw new TypeError();
  return { receipt: receiptFor(query, source, restored), source };
}
function unconfirmedReceipt(receipt: OutboxRestoreReceipt | null) {
  return receipt === null
    ? null
    : { ...receipt, observation: 'unconfirmed-restore-candidate' as const };
}

/** Explicit history writes only; the caller owns the write transaction and checked table absence. */
export function createOutboxRestoreReceiptTable(db: DatabaseSync) {
  db.exec(`CREATE TABLE main.local_outbox_restore_receipts (
    schema_version INTEGER NOT NULL CHECK (schema_version = 1), restore_id TEXT NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
    query_json TEXT NOT NULL, archive_json TEXT NOT NULL, restored_at TEXT NOT NULL,
    restore_trace_id TEXT NOT NULL, restored_document_sha256 TEXT NOT NULL
  )`);
}

/** Optional extension inspection never initializes storage. */
export function outboxRestoreReceiptTable(db: DatabaseSync, trace: string): boolean {
  const entries = db
    .prepare('SELECT type FROM main.sqlite_schema WHERE name = ? COLLATE NOCASE')
    .all(TABLE);
  if (!entries.length) return false;
  if (entries.length !== 1 || entries[0]!.type !== 'table')
    throw fail(
      'OUTBOX_RESTORE_STORAGE_INVALID',
      'The restore receipt name is not a unique table',
      trace,
    );
  const columns = new Set(
    db
      .prepare('PRAGMA main.table_info(local_outbox_restore_receipts)')
      .all()
      .map((row) => row.name),
  );
  if (
    [
      'schema_version',
      'restore_id',
      'tenant_id',
      'workspace_id',
      'project_id',
      'query_json',
      'archive_json',
      'restored_at',
      'restore_trace_id',
      'restored_document_sha256',
    ].some((name) => !columns.has(name))
  )
    throw fail(
      'OUTBOX_RESTORE_STORAGE_INVALID',
      'The restore receipt table lacks required columns; preserve the queue',
      trace,
    );
  return true;
}
export function outboxRestoreStoredRecord(
  db: DatabaseSync,
  query: { scope: OutboxScope; restore_id: string },
  trace: string,
  present: boolean,
): { receipt: OutboxRestoreReceipt; source: OutboxArchiveFile } | null {
  if (!present) return null;
  const fields: [string, number][] = [
    ['query_json', QUERY_BYTES],
    ['archive_json', OUTBOX_ARCHIVE_FILE_BYTES],
    ['restored_at', 64],
    ['restore_trace_id', 4096],
    ['restored_document_sha256', 64],
  ];
  const projection = fields
    .map(
      ([name, maximum]) =>
        `CASE WHEN typeof(${name}) = 'text' AND length(CAST(${name} AS BLOB)) <= ${maximum} THEN ${name} ELSE NULL END AS ${name}`,
    )
    .join(', ');
  const rows = db
    .prepare(
      `SELECT CASE WHEN typeof(schema_version) = 'integer' AND schema_version = 1 THEN 1 ELSE NULL END AS schema_version, ${projection}
    FROM main.local_outbox_restore_receipts WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY AND restore_id = ? COLLATE BINARY LIMIT 2`,
    )
    .all(query.scope.tenant_id, query.scope.workspace_id, query.scope.project_id, query.restore_id);
  if (!rows.length) return null;
  const row = rows[0]!;
  let savedQuery: OutboxRestoreQuery;
  let receipt: OutboxRestoreReceipt;
  let source: OutboxArchiveFile;
  try {
    if (
      rows.length !== 1 ||
      row.schema_version !== 1 ||
      typeof row.query_json !== 'string' ||
      typeof row.archive_json !== 'string' ||
      !canonicalTime(row.restored_at) ||
      !validText(row.restore_trace_id) ||
      typeof row.restored_document_sha256 !== 'string' ||
      !DIGEST.test(row.restored_document_sha256)
    )
      throw new TypeError();
    savedQuery = parseOutboxRestoreQuery(JSON.parse(row.query_json), trace);
    if (savedQuery.restore_id !== query.restore_id || !sameScope(savedQuery.scope, query.scope))
      throw new TypeError();
    const verified = outboxVerifiedRestoreRecord(
      savedQuery,
      JSON.parse(row.archive_json),
      row.restored_at,
      row.restore_trace_id,
      row.restored_document_sha256,
      trace,
    );
    source = verified.source;
    receipt = verified.receipt;
  } catch (error) {
    throw fail(
      'OUTBOX_RESTORE_RECEIPT_INVALID',
      'The complete original restore receipt or archived history cannot be verified; preserve the queue',
      trace,
      error instanceof ContractError
        ? { ...error.envelope.details, cause_code: error.envelope.code }
        : {},
    );
  }
  return { receipt, source };
}
function readReceipt(
  db: DatabaseSync,
  query: OutboxRestoreQuery,
  trace: string,
  present: boolean,
): OutboxRestoreReceipt | null {
  const stored = outboxRestoreStoredRecord(db, query, trace, present);
  if (!stored) return null;
  if (syncJsonSnapshot(stored.receipt.query, QUERY_BYTES) !== syncJsonSnapshot(query, QUERY_BYTES))
    throw fail(
      'OUTBOX_RESTORE_ID_REUSED',
      'This restore ID belongs to another original restore request; preserve the original request',
      trace,
    );
  return stored.receipt;
}

/** Shared by read-only preview and the actual write transaction; never initializes storage. */
export function outboxRestoreOriginalReceipt(
  db: DatabaseSync,
  query: OutboxRestoreQuery,
  trace: string,
) {
  const present = outboxRestoreReceiptTable(db, trace);
  const recorded = readReceipt(db, query, trace, present);
  if (
    !recorded &&
    present &&
    db
      .prepare(
        'SELECT 1 AS present FROM main.local_outbox_restore_receipts WHERE restore_id = ? COLLATE BINARY LIMIT 1',
      )
      .get(query.restore_id)
  )
    throw fail(
      'OUTBOX_RESTORE_ID_UNAVAILABLE',
      'This restore ID is unavailable; preserve the original request',
      trace,
    );
  return { present, recorded };
}

export function assertOutboxRestoreTrace(trace: string) {
  if (!validText(trace))
    throw fail(
      'OUTBOX_RESTORE_QUERY_INVALID',
      'Supply a valid restore trace',
      'trace_outbox_restore',
    );
}

export function outboxRestoreSource(archive: unknown, query: OutboxRestoreQuery, trace: string) {
  const source = verifyOutboxArchive(archive, trace);
  if (
    !sameScope(source.document.scope, query.scope) ||
    source.document_sha256 !== query.archive_sha256
  )
    throw fail(
      'OUTBOX_RESTORE_ARCHIVE_MISMATCH',
      'The complete archive differs from the exact original restore request',
      trace,
    );
  return source;
}

/** Caller owns one transaction. A successful read is not a lock or a promise about later writes. */
export function outboxRestoreTarget(
  db: DatabaseSync,
  source: OutboxArchiveFile,
  query: OutboxRestoreQuery,
  trace: string,
  check: () => void,
  select: (event_id: string | null) => void,
) {
  const control = outboxStoredSendControl(db, query.scope, trace);
  if (control.state !== 'paused' || control.generation !== query.expected_control_generation)
    throw fail(
      'OUTBOX_RESTORE_CONTROL_CHANGED',
      'The target must remain paused at the exact observed control generation',
      trace,
      { current_control: control },
    );
  if (
    db
      .prepare(
        'SELECT 1 AS present FROM local_events WHERE tenant_id = ? AND workspace_id = ? AND project_id = ? LIMIT 1',
      )
      .get(query.scope.tenant_id, query.scope.workspace_id, query.scope.project_id)
  )
    throw fail(
      'OUTBOX_RESTORE_TARGET_NOT_EMPTY',
      'The target project contains records; this restore never replaces or merges them',
      trace,
    );
  const conflict = db.prepare(
    'SELECT 1 AS present FROM local_events WHERE event_id = ? OR idempotency_key = ? LIMIT 1',
  );
  for (const record of source.document.records) {
    select(record.event_id as string);
    check();
    if (conflict.get(record.event_id as string, record.idempotency_key as string))
      throw fail(
        'OUTBOX_RESTORE_ORIGINAL_CONFLICT',
        'An original event ID or idempotency key is already present in the destination queue',
        trace,
      );
  }
  select(null);
  check();
  return control;
}

/** Historical receipt lookup never checks or changes the present rows/control. */
export function readOutboxRestoreReceipt(db: DatabaseSync, input: unknown, trace: string) {
  const query = parseOutboxRestoreQuery(input, trace);
  const check = outboxRestoreBudget(trace);
  try {
    return outboxReadTransaction(
      db,
      () => {
        check();
        const receipt = readReceipt(db, query, trace, outboxRestoreReceiptTable(db, trace));
        check();
        return {
          scope: query.scope,
          query,
          status: receipt ? ('recorded' as const) : ('not-observed' as const),
          receipt,
          observed_at: new Date().toISOString(),
          current_queue: 'not-checked' as const,
          server_delivery: 'not-checked' as const,
        };
      },
      trace,
    );
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_RECEIPT_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The original restore receipt could not be read',
      trace,
      { ...(error instanceof ContractError ? error.envelope.details : {}), query },
    );
  }
}

/** Empty, paused destination only. Original history and held records commit together, never a partial import. */
export function restoreOutboxArchive(
  db: DatabaseSync,
  archive: unknown,
  input: unknown,
  trace: string,
) {
  const query = parseOutboxRestoreQuery(input, trace);
  assertOutboxRestoreTrace(trace);
  const check = outboxRestoreBudget(trace);
  const transaction: ReconciliationTransactionState = {
    settlement: 'not-committed',
    phase: 'not-started',
    rollback: 'not-needed',
  };
  let candidate_receipt: OutboxRestoreReceipt | null = null;
  let historical_receipt: OutboxRestoreReceipt | null = null;
  let selected_event_id: string | null = null;
  let stage = 'archive';
  try {
    const source = outboxRestoreSource(archive, query, trace);
    check();
    stage = 'receipt';
    return reconciliationTransaction(
      (sql) => db.exec(sql),
      () => {
        check();
        const { present, recorded } = outboxRestoreOriginalReceipt(db, query, trace);
        historical_receipt = recorded;
        check();
        if (recorded)
          return {
            scope: query.scope,
            action: 'already-restored' as const,
            local_commit: 'historically-confirmed' as const,
            receipt: recorded,
          };
        stage = 'target';
        const control = outboxRestoreTarget(db, source, query, trace, check, (event_id) => {
          selected_event_id = event_id;
        });
        const scopeArgs = [query.scope.tenant_id, query.scope.workspace_id, query.scope.project_id];
        stage = 'prepare';
        const restored = outboxRestoreRecords(source, new Date().toISOString(), trace);
        candidate_receipt = receiptFor(query, source, restored);
        const queryJson = syncJsonSnapshot(query, QUERY_BYTES);
        const archiveJson = syncJsonSnapshot(source, OUTBOX_ARCHIVE_FILE_BYTES);
        check();
        if (!present) createOutboxRestoreReceiptTable(db);
        stage = 'records';
        const insert = db.prepare(
          `INSERT INTO local_events (${OUTBOX_STORED_COLUMNS.join(',')}) VALUES (${OUTBOX_STORED_COLUMNS.map(() => '?').join(',')})`,
        );
        const select = db.prepare(
          `SELECT ${outboxReadProjection(true)} FROM local_events WHERE tenant_id = ? AND workspace_id = ? AND project_id = ? AND event_id = ? LIMIT 2`,
        );
        for (const record of restored.document.records) {
          selected_event_id = record.event_id as string;
          check();
          const changed = insert.run(
            ...OUTBOX_STORED_COLUMNS.map((name) => record[name] as string | number | null),
          );
          if (Number(changed.changes) !== 1)
            throw fail(
              'OUTBOX_RESTORE_WRITE_FAILED',
              'An original could not be inserted exactly once',
              trace,
            );
        }
        stage = 'save-receipt';
        const saved = db
          .prepare(
            `INSERT INTO main.local_outbox_restore_receipts (schema_version,restore_id,tenant_id,workspace_id,project_id,query_json,archive_json,restored_at,restore_trace_id,restored_document_sha256)
        VALUES (1,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            query.restore_id,
            ...scopeArgs,
            queryJson,
            archiveJson,
            restored.document.observed_at,
            trace,
            restored.document_sha256,
          );
        if (Number(saved.changes) !== 1)
          throw fail(
            'OUTBOX_RESTORE_WRITE_FAILED',
            'The original restore receipt was not saved exactly once',
            trace,
          );
        // Check all rows after every write, including the receipt, before allowing COMMIT.
        stage = 'readback';
        for (const record of restored.document.records) {
          selected_event_id = record.event_id as string;
          check();
          const rows = select.all(...scopeArgs, selected_event_id);
          if (
            rows.length !== 1 ||
            rows[0]!.metadata_valid !== 1 ||
            syncJsonSnapshot(outboxStoredColumns(rows[0]!), OUTBOX_ARCHIVE_FILE_BYTES) !==
              syncJsonSnapshot(record, OUTBOX_ARCHIVE_FILE_BYTES)
          )
            throw fail(
              'OUTBOX_RESTORE_READBACK_FAILED',
              'The restored original did not read back exactly',
              trace,
            );
        }
        selected_event_id = null;
        const count = db
          .prepare(
            'SELECT COUNT(*) AS total FROM local_events WHERE tenant_id = ? AND workspace_id = ? AND project_id = ?',
          )
          .get(...scopeArgs);
        if (count?.total !== restored.document.records.length)
          throw fail(
            'OUTBOX_RESTORE_READBACK_FAILED',
            'The restored project contains an unexpected record set',
            trace,
          );
        const stored = readReceipt(db, query, trace, true);
        if (
          !stored ||
          syncJsonSnapshot(stored, QUERY_BYTES * 2) !==
            syncJsonSnapshot(candidate_receipt, QUERY_BYTES * 2)
        )
          throw fail(
            'OUTBOX_RESTORE_READBACK_FAILED',
            'The complete restore receipt did not read back exactly',
            trace,
          );
        const finalControl = outboxStoredSendControl(db, query.scope, trace);
        if (JSON.stringify(finalControl) !== JSON.stringify(control))
          throw fail(
            'OUTBOX_RESTORE_CONTROL_CHANGED',
            'The paused send control changed during restoration',
            trace,
          );
        check();
        stage = 'commit';
        return {
          scope: query.scope,
          action: 'restored' as const,
          local_commit: 'committed' as const,
          receipt: stored,
        };
      },
      transaction,
      trace,
      check,
    );
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_UNAVAILABLE',
      transaction.settlement === 'unknown'
        ? 'The restore commit could not be confirmed; keep the archive and original query, then read the restore receipt before continuing'
        : error instanceof ContractError
          ? error.envelope.message
          : 'The complete original archive could not be restored',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        stage,
        selected_event_id,
        candidate_receipt: unconfirmedReceipt(candidate_receipt),
        historical_receipt,
        local_commit: transaction.settlement,
        transaction: { phase: transaction.phase, rollback: transaction.rollback },
      },
    );
  }
}
