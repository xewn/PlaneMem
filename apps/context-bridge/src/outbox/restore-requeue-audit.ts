import type { DatabaseSync } from 'node:sqlite';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import { OUTBOX_ARCHIVE_FILE_BYTES } from './archive.js';
import { outboxReadTransaction } from './reading.js';
import { assertOutboxRestoreTrace, outboxRestoreReceiptTable } from './restore.js';
import { parseOutboxRestoreAuditQuery, type OutboxRestoreAuditQuery } from './restore-audit.js';
import {
  outboxRequeueReceiptTable,
  outboxRequeueReceiptProjection,
  outboxRequeueReceiptMetadata,
  outboxOriginalRequeueReceipt,
} from './restore-requeue-receipt.js';

export type OutboxRestoreRequeueAuditQuery = OutboxRestoreAuditQuery;

export function parseOutboxRestoreRequeueAuditQuery(
  input: unknown,
  trace: string,
): OutboxRestoreRequeueAuditQuery {
  try {
    return parseOutboxRestoreAuditQuery(input, trace);
  } catch (error) {
    throw new ContractError(
      'OUTBOX_REQUEUE_AUDIT_QUERY_INVALID',
      'Supply scope and optional max_receipts (1–1000), max_bytes (1–536870912) and timeout_ms (1–90000)',
      {
        trace_id: trace,
        retryable: false,
        details:
          error instanceof ContractError
            ? { ...error.envelope.details, cause_code: error.envelope.code }
            : {},
      },
    );
  }
}

/** Complete selected-project history audit; callers never receive partially verified receipts. */
export function auditOutboxRestoreRequeueReceipts(db: DatabaseSync, input: unknown, trace: string) {
  const query = parseOutboxRestoreRequeueAuditQuery(input, trace);
  assertOutboxRestoreTrace(trace);
  const deadline = performance.now() + query.timeout_ms;
  let stage = 'schema';
  let selected_requeue_id: string | null = null;
  let selected_restore_id: string | null = null;
  let counted_receipts: number | null = null;
  let checked_receipts = 0;
  let checked_query_bytes = 0;
  let checked_restore_query_bytes = 0;
  let checked_archive_bytes = 0;
  let budgeted_bytes = 0;
  const fail = (code: string, message: string) =>
    new ContractError(code, message, { trace_id: trace, retryable: false });
  const check = () => {
    // Use the shared reader's timeout code so it cannot be relabelled as corrupt history.
    if (performance.now() >= deadline)
      throw fail(
        'OUTBOX_RESTORE_TIMEOUT',
        'The complete requeue history audit exceeded its deadline',
      );
  };
  const corrupt = () =>
    fail(
      'OUTBOX_REQUEUE_AUDIT_STORAGE_INVALID',
      'The selected requeue history contains invalid, missing or ambiguous records; preserve the queue',
    );
  const exceeded = () =>
    fail(
      'OUTBOX_REQUEUE_AUDIT_LIMIT_EXCEEDED',
      'The complete selected requeue history exceeds the audit budget',
    );
  const bytes = (value: unknown, maximum: number): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw corrupt();
    return value;
  };
  const reserve = (size: number) => {
    if (budgeted_bytes + size > query.max_bytes) throw exceeded();
    budgeted_bytes += size;
  };
  try {
    const result = outboxReadTransaction(
      db,
      () => {
        check();
        const present = outboxRequeueReceiptTable(db, trace);
        const scope = [query.scope.tenant_id, query.scope.workspace_id, query.scope.project_id];
        stage = 'count';
        const count = present
          ? db
              .prepare(
                `SELECT COUNT(*) AS total FROM (
        SELECT 1 FROM main.local_outbox_requeue_receipts
        WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY LIMIT ?
      )`,
              )
              .get(...scope, query.max_receipts + 1)?.total
          : 0;
        check();
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw corrupt();
        counted_receipts = count;
        if (count > query.max_receipts) throw exceeded();
        let selected_record_appearances = 0;
        const restoreIds = new Set<string>();
        if (count > 0) {
          stage = 'parent-schema';
          if (!outboxRestoreReceiptTable(db, trace)) throw corrupt();
          const uniqueRequeue = db.prepare(
            'SELECT 1 AS present FROM main.local_outbox_requeue_receipts WHERE requeue_id = ? COLLATE BINARY LIMIT 2',
          );
          const uniqueRestore = db.prepare(
            'SELECT 1 AS present FROM main.local_outbox_restore_receipts WHERE restore_id = ? COLLATE BINARY LIMIT 2',
          );
          const metadata = db.prepare(`SELECT ${outboxRequeueReceiptProjection()}
          FROM main.local_outbox_requeue_receipts
          WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY AND requeue_id = ? COLLATE BINARY LIMIT 1`);
          const parentSize = db.prepare(`SELECT
          CASE WHEN typeof(query_json) = 'text' THEN length(CAST(query_json AS BLOB)) ELSE NULL END AS query_bytes,
          CASE WHEN typeof(archive_json) = 'text' THEN length(CAST(archive_json AS BLOB)) ELSE NULL END AS archive_bytes
          FROM main.local_outbox_restore_receipts
          WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY AND restore_id = ? COLLATE BINARY LIMIT 1`);
          let after: string | undefined;
          while (true) {
            stage = 'metadata';
            selected_requeue_id = null;
            selected_restore_id = null;
            check();
            // Read lengths before any query or archive body; count+1 detects inconsistent membership.
            const rows = db
              .prepare(
                `SELECT
            CASE WHEN typeof(r.requeue_id) = 'text' AND length(CAST(r.requeue_id AS BLOB)) <= 1020 THEN r.requeue_id ELSE NULL END AS requeue_id,
            CASE WHEN typeof(r.query_json) = 'text' THEN length(CAST(r.query_json AS BLOB)) ELSE NULL END AS query_bytes
            FROM main.local_outbox_requeue_receipts AS r
            WHERE r.tenant_id = ? COLLATE BINARY AND r.workspace_id = ? COLLATE BINARY AND r.project_id = ? COLLATE BINARY
            ${after === undefined ? '' : 'AND r.requeue_id > ? COLLATE BINARY'}
            ORDER BY r.requeue_id COLLATE BINARY LIMIT ?
          `,
              )
              .all(
                ...scope,
                ...(after === undefined ? [] : [after]),
                Math.min(20, count - checked_receipts + 1),
              );
            check();
            if (!rows.length) break;
            for (const row of rows) {
              stage = 'metadata';
              selected_requeue_id = isSyncIdentifier(row.requeue_id) ? row.requeue_id : null;
              selected_restore_id = null;
              check();
              if (
                checked_receipts >= count ||
                !isSyncIdentifier(row.requeue_id) ||
                (after !== undefined &&
                  Buffer.compare(Buffer.from(after), Buffer.from(row.requeue_id)) >= 0) ||
                uniqueRequeue.all(row.requeue_id).length !== 1
              )
                throw corrupt();
              const queryBytes = bytes(row.query_bytes, 16384);
              reserve(queryBytes);
              const stored = metadata.get(...scope, row.requeue_id);
              check();
              if (!stored) throw corrupt();
              const original = outboxRequeueReceiptMetadata(
                stored,
                { scope: query.scope, requeue_id: row.requeue_id },
                trace,
              ).original_query;
              selected_restore_id = original.restore_id;
              stage = 'parent-budget';
              if (uniqueRestore.all(original.restore_id).length !== 1) throw corrupt();
              const parent = parentSize.get(...scope, original.restore_id);
              check();
              if (!parent) throw corrupt();
              const parentQueryBytes = bytes(parent.query_bytes, 16384);
              const archiveBytes = bytes(parent.archive_bytes, OUTBOX_ARCHIVE_FILE_BYTES);
              // Each batch revalidates its parent: shared parents consume the budget on every appearance.
              reserve(parentQueryBytes + archiveBytes);
              stage = 'receipt';
              const { recorded } = outboxOriginalRequeueReceipt(db, original, trace, check);
              if (!recorded) throw corrupt();
              check();
              checked_receipts += 1;
              checked_query_bytes += queryBytes;
              checked_restore_query_bytes += parentQueryBytes;
              checked_archive_bytes += archiveBytes;
              selected_record_appearances += recorded.selected_records;
              restoreIds.add(original.restore_id);
              after = row.requeue_id;
            }
          }
        }
        if (checked_receipts !== count) throw corrupt();
        stage = 'read-commit';
        selected_requeue_id = null;
        selected_restore_id = null;
        check();
        const data = {
          scope: query.scope,
          query,
          status: 'complete' as const,
          receipt_storage: present ? ('present' as const) : ('not-present' as const),
          checked_receipts,
          checked_query_bytes,
          checked_restore_query_bytes,
          checked_archive_bytes,
          checked_bytes: checked_query_bytes + checked_restore_query_bytes + checked_archive_bytes,
          byte_basis: 'stored-requeue-query-and-parent-query-archive-per-batch-utf8' as const,
          selected_record_appearances,
          distinct_restore_histories: restoreIds.size,
          record_count_basis: 'appearances-across-requeue-receipts' as const,
          receipt_integrity: checked_receipts
            ? ('verified' as const)
            : ('no-records-observed' as const),
          observation: 'verified-local-requeue-history' as const,
          consistency: 'single-project-read-snapshot' as const,
          current_queue: 'not-checked' as const,
          current_control: 'not-checked' as const,
          server_delivery: 'not-checked' as const,
          source_authenticity: 'not-proven' as const,
          sender_stopped: 'not-proven' as const,
          database_integrity: 'not-audited' as const,
          local_commit: 'not-attempted' as const,
          observed_at: new Date().toISOString(),
        };
        syncJsonSnapshot(data, 128 * 1024);
        check();
        return data;
      },
      trace,
    );
    check();
    return result;
  } catch (error) {
    const timeout =
      error instanceof ContractError && error.envelope.code === 'OUTBOX_RESTORE_TIMEOUT';
    throw new ContractError(
      timeout
        ? 'OUTBOX_REQUEUE_AUDIT_TIMEOUT'
        : error instanceof ContractError
          ? error.envelope.code
          : 'OUTBOX_REQUEUE_AUDIT_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete selected requeue history could not be audited',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          ...(timeout ? { cause_code: 'OUTBOX_RESTORE_TIMEOUT' } : {}),
          query,
          complete: false,
          stage,
          selected_requeue_id,
          selected_restore_id,
          counted_receipts,
          count_basis: 'at-most-max-receipts-plus-one',
          checked_receipts,
          checked_query_bytes,
          checked_restore_query_bytes,
          checked_archive_bytes,
          checked_bytes: checked_query_bytes + checked_restore_query_bytes + checked_archive_bytes,
          budgeted_bytes,
          local_commit: 'not-attempted',
        },
      },
    );
  }
}
