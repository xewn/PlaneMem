import type { DatabaseSync } from 'node:sqlite';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import { assertOutboxRestoreTrace, outboxRestoreBudget } from './restore.js';
import { outboxReadTransaction } from './reading.js';
import { parseOutboxRestoreRequeueHistoryQuery } from './restore-requeue-query.js';
import {
  outboxRequeueReceiptTable,
  outboxRequeueReceiptProjection,
  outboxRequeueReceiptMetadata,
} from './restore-requeue-receipt.js';

/** Discover bounded receipt metadata; linked archive bodies are reserved for explicit get/receipt. */
export function listOutboxRestoreRequeueReceipts(db: DatabaseSync, input: unknown, trace: string) {
  const query = parseOutboxRestoreRequeueHistoryQuery(input, trace);
  assertOutboxRestoreTrace(trace);
  const check = outboxRestoreBudget(trace);
  let selected_requeue_id: string | null = null;
  try {
    return outboxReadTransaction(
      db,
      () => {
        check();
        const present = outboxRequeueReceiptTable(db, trace);
        const rows = present
          ? db
              .prepare(
                `SELECT
        CASE WHEN typeof(requeue_id) = 'text' AND length(CAST(requeue_id AS BLOB)) <= 1020 THEN requeue_id ELSE NULL END AS requeue_id,
        ${outboxRequeueReceiptProjection()} FROM main.local_outbox_requeue_receipts
        WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY
        ${query.after_requeue_id === undefined ? '' : 'AND requeue_id > ? COLLATE BINARY'}
        ORDER BY local_outbox_requeue_receipts.requeue_id COLLATE BINARY LIMIT ?`,
              )
              .all(
                query.scope.tenant_id,
                query.scope.workspace_id,
                query.scope.project_id,
                ...(query.after_requeue_id === undefined ? [] : [query.after_requeue_id]),
                query.limit + 1,
              )
          : [];
        const unique = present
          ? db.prepare(
              'SELECT 1 AS present FROM main.local_outbox_requeue_receipts WHERE requeue_id = ? COLLATE BINARY LIMIT 2',
            )
          : null;
        let previous = query.after_requeue_id;
        const page = rows.map((row) => {
          check();
          selected_requeue_id = isSyncIdentifier(row.requeue_id) ? row.requeue_id : null;
          if (
            !isSyncIdentifier(row.requeue_id) ||
            (previous !== undefined &&
              Buffer.compare(Buffer.from(previous), Buffer.from(row.requeue_id)) >= 0) ||
            unique!.all(row.requeue_id).length !== 1
          )
            throw new ContractError(
              'OUTBOX_REQUEUE_HISTORY_INVALID',
              'The selected requeue catalog contains an invalid, duplicated or unordered ID',
              { trace_id: trace },
            );
          previous = row.requeue_id;
          const get_query = { scope: query.scope, requeue_id: row.requeue_id };
          const metadata = outboxRequeueReceiptMetadata(row, get_query, trace);
          const original = metadata.original_query;
          return {
            requeue_id: original.requeue_id,
            restore_id: original.restore_id,
            query_sha256: metadata.query_sha256,
            archive_sha256: original.archive_sha256,
            restore_receipt_sha256: metadata.restore_receipt_sha256,
            restore_document_sha256: metadata.restore_document_sha256,
            before_sha256: metadata.before_sha256,
            after_sha256: metadata.after_sha256,
            selected_records: original.event_ids.length,
            requeued_at: metadata.requeued_at,
            requeue_trace_id: metadata.requeue_trace_id,
            metadata_integrity: 'validated' as const,
            linked_history_integrity: 'not-verified' as const,
            selected_content_integrity: 'not-verified' as const,
            get_query,
          };
        });
        selected_requeue_id = null;
        const records = page.slice(0, query.limit);
        const has_more = page.length > query.limit;
        const result = {
          scope: query.scope,
          query,
          audit_query: { scope: query.scope },
          records,
          has_more,
          next_query: has_more
            ? { ...query, after_requeue_id: records[records.length - 1]!.requeue_id }
            : null,
          storage: present ? ('available' as const) : ('not-configured' as const),
          observation: 'local-requeue-receipt-metadata' as const,
          consistency: 'single-read-snapshot' as const,
          cross_page_snapshot: 'not-preserved' as const,
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
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_HISTORY_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete selected requeue catalog page could not be read',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          selected_requeue_id,
          complete: false,
          local_commit: 'not-attempted',
        },
      },
    );
  }
}
