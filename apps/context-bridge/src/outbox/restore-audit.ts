import type { DatabaseSync } from 'node:sqlite';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import type { OutboxScope } from './sqlite.js';
import { OUTBOX_ARCHIVE_FILE_BYTES } from './archive.js';
import { parseOutboxReadScope, outboxReadTransaction } from './reading.js';
import { outboxRestoreReceiptTable, outboxRestoreStoredRecord } from './restore.js';

export interface OutboxRestoreAuditQuery {
  scope: OutboxScope;
  max_receipts: number;
  max_bytes: number;
  timeout_ms: number;
}
function fail(code: string, message: string, trace: string) {
  return new ContractError(code, message, { trace_id: trace, retryable: false });
}
export function parseOutboxRestoreAuditQuery(
  input: unknown,
  trace: string,
): OutboxRestoreAuditQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).some(
        (key) => !['scope', 'max_receipts', 'max_bytes', 'timeout_ms'].includes(key),
      )
    )
      throw new TypeError();
    const limit = (value: unknown, fallback: number, maximum: number) => {
      const supplied = value === undefined ? fallback : value;
      if (
        typeof supplied !== 'number' ||
        !Number.isSafeInteger(supplied) ||
        supplied < 1 ||
        supplied > maximum
      )
        throw new TypeError();
      return supplied;
    };
    return {
      scope: parseOutboxReadScope(row.scope, trace),
      max_receipts: limit(row.max_receipts, 100, 1000),
      max_bytes: limit(row.max_bytes, 64 * 1024 * 1024, 512 * 1024 * 1024),
      timeout_ms: limit(row.timeout_ms, 30000, 90000),
    };
  } catch {
    throw fail(
      'OUTBOX_RESTORE_AUDIT_QUERY_INVALID',
      'Supply scope and optional max_receipts (1–1000), max_bytes (1–536870912) and timeout_ms (1–90000)',
      trace,
    );
  }
}

/** Complete project snapshot. Without a collector, verified archives are released after each item. */
export function auditOutboxRestoreReceipts(
  db: DatabaseSync,
  input: unknown,
  trace: string,
  collect?: (record: NonNullable<ReturnType<typeof outboxRestoreStoredRecord>>) => void,
) {
  const query = parseOutboxRestoreAuditQuery(input, trace);
  const deadline = performance.now() + query.timeout_ms;
  let stage = 'schema';
  let selected_restore_id: string | null = null;
  let checked_receipts = 0;
  let checked_query_bytes = 0;
  let checked_archive_bytes = 0;
  let counted_receipts: number | null = null;
  const check = () => {
    if (performance.now() >= deadline)
      throw fail(
        'OUTBOX_RESTORE_AUDIT_TIMEOUT',
        'The complete restore history audit exceeded its local deadline',
        trace,
      );
  };
  const exceeded = () =>
    fail(
      'OUTBOX_RESTORE_AUDIT_LIMIT_EXCEEDED',
      'The full selected restore history exceeds the audit budget; no complete result is available',
      trace,
    );
  const corrupt = () =>
    fail(
      'OUTBOX_RESTORE_AUDIT_STORAGE_INVALID',
      'The selected restore history contains invalid metadata or inconsistent membership; preserve the queue',
      trace,
    );
  try {
    const result = outboxReadTransaction(
      db,
      () => {
        check();
        const present = outboxRestoreReceiptTable(db, trace);
        const scope = [query.scope.tenant_id, query.scope.workspace_id, query.scope.project_id];
        stage = 'count';
        const count = present
          ? db
              .prepare(
                `SELECT COUNT(*) AS total FROM (
        SELECT 1 FROM main.local_outbox_restore_receipts
        WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY LIMIT ?
      )`,
              )
              .get(...scope, query.max_receipts + 1)?.total
          : 0;
        check();
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw corrupt();
        counted_receipts = count;
        if (count > query.max_receipts) throw exceeded();
        let archived_records = 0;
        let held_records = 0;
        const historical_terminal_records = { sent: 0, conflict: 0 };
        if (present) {
          const unique = db.prepare(`SELECT COUNT(*) AS total FROM (
          SELECT 1 FROM main.local_outbox_restore_receipts
          WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY AND restore_id = ? COLLATE BINARY LIMIT 2
        )`);
          let after: string | undefined;
          while (true) {
            check();
            stage = 'metadata';
            selected_restore_id = null;
            const rows = db
              .prepare(
                `SELECT
            CASE WHEN typeof(r.restore_id) = 'text' AND length(CAST(r.restore_id AS BLOB)) <= 1020 THEN r.restore_id ELSE NULL END AS restore_id,
            CASE WHEN typeof(r.query_json) = 'text' THEN length(CAST(r.query_json AS BLOB)) ELSE NULL END AS query_bytes,
            CASE WHEN typeof(r.archive_json) = 'text' THEN length(CAST(r.archive_json AS BLOB)) ELSE NULL END AS archive_bytes
            FROM main.local_outbox_restore_receipts AS r
            WHERE r.tenant_id = ? COLLATE BINARY AND r.workspace_id = ? COLLATE BINARY AND r.project_id = ? COLLATE BINARY
            ${after === undefined ? '' : 'AND r.restore_id > ? COLLATE BINARY'}
            ORDER BY r.restore_id COLLATE BINARY LIMIT ?`,
              )
              .all(
                ...scope,
                ...(after === undefined ? [] : [after]),
                Math.min(20, count - checked_receipts + 1),
              );
            check();
            if (!rows.length) break;
            for (const row of rows) {
              check();
              selected_restore_id = isSyncIdentifier(row.restore_id) ? row.restore_id : null;
              if (
                checked_receipts >= count ||
                !isSyncIdentifier(row.restore_id) ||
                typeof row.query_bytes !== 'number' ||
                !Number.isSafeInteger(row.query_bytes) ||
                row.query_bytes < 1 ||
                row.query_bytes > 16384 ||
                typeof row.archive_bytes !== 'number' ||
                !Number.isSafeInteger(row.archive_bytes) ||
                row.archive_bytes < 1 ||
                row.archive_bytes > OUTBOX_ARCHIVE_FILE_BYTES
              )
                throw corrupt();
              if (
                after !== undefined &&
                Buffer.compare(Buffer.from(after), Buffer.from(row.restore_id)) >= 0
              )
                throw corrupt();
              if (
                checked_query_bytes + checked_archive_bytes + row.query_bytes + row.archive_bytes >
                query.max_bytes
              )
                throw exceeded();
              // Reject duplicate selected IDs before the full reader can materialize two archive bodies.
              if (unique.get(...scope, row.restore_id)?.total !== 1) throw corrupt();
              check();
              stage = 'receipt';
              const stored = outboxRestoreStoredRecord(
                db,
                { scope: query.scope, restore_id: row.restore_id },
                trace,
                true,
              );
              if (!stored) throw corrupt();
              check();
              if (collect) {
                stage = 'collect';
                collect(stored);
                check();
              }
              archived_records += stored.receipt.records;
              held_records += stored.receipt.held_records;
              historical_terminal_records.sent += stored.receipt.historical_terminal_records.sent;
              historical_terminal_records.conflict +=
                stored.receipt.historical_terminal_records.conflict;
              checked_query_bytes += row.query_bytes;
              checked_archive_bytes += row.archive_bytes;
              checked_receipts += 1;
              after = row.restore_id;
              stage = 'metadata';
            }
          }
        }
        if (checked_receipts !== count) throw corrupt();
        check();
        stage = 'read-commit';
        selected_restore_id = null;
        const data = {
          scope: query.scope,
          query,
          status: 'complete' as const,
          receipt_storage: present ? ('present' as const) : ('not-present' as const),
          checked_receipts,
          checked_query_bytes,
          checked_archive_bytes,
          checked_bytes: checked_query_bytes + checked_archive_bytes,
          byte_basis: 'stored-query-and-source-archive-json-utf8' as const,
          archived_records,
          held_records,
          historical_terminal_records,
          record_count_basis: 'appearances-across-restore-receipts' as const,
          observed_at: new Date().toISOString(),
          consistency: 'single-project-read-snapshot' as const,
          observation: 'verified-local-restore-history' as const,
          archive_integrity:
            checked_receipts === 0 ? ('no-records-observed' as const) : ('verified' as const),
          current_queue: 'not-checked' as const,
          server_delivery: 'not-checked' as const,
          source_authenticity: 'not-proven' as const,
          database_integrity: 'not-audited' as const,
        };
        syncJsonSnapshot(data, 16384);
        check();
        return data;
      },
      trace,
    );
    check();
    return result;
  } catch (error) {
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_AUDIT_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete selected restore history could not be audited',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          complete: false,
          stage,
          selected_restore_id,
          counted_receipts,
          count_basis: 'at-most-max-receipts-plus-one',
          checked_receipts,
          checked_query_bytes,
          checked_archive_bytes,
          checked_bytes: checked_query_bytes + checked_archive_bytes,
        },
      },
    );
  }
}
