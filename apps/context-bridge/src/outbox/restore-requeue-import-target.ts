import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { ContractError } from '@planemem/contracts';
import { OUTBOX_ARCHIVE_FILE_BYTES } from './archive.js';
import { outboxRestoreReceiptTable, outboxRestoreStoredRecord } from './restore.js';
import {
  outboxRequeueReceiptTable,
  outboxRequeueReceiptProjection,
  outboxRequeueReceiptMetadata,
  type OutboxRestoreRequeueReceipt,
} from './restore-requeue-receipt.js';
import type { OutboxRestoreRequeueFile } from './restore-requeue-file.js';

export type OutboxRequeueImportRelation =
  | 'missing'
  | 'identical'
  | 'different'
  | 'reserved-other-project';
function invalid(trace: string) {
  return new ContractError(
    'OUTBOX_REQUEUE_IMPORT_TARGET_INVALID',
    'Selected destination history is invalid or ambiguous; preserve it',
    { trace_id: trace, retryable: false },
  );
}
function bytes(value: unknown, maximum: number, trace: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw invalid(trace);
  return value;
}
/** Caller owns the transaction and supplies verified immutable source history. Reserve before body IO. */
export function inspectOutboxRequeueImportParent(
  db: DatabaseSync,
  parent: OutboxRestoreRequeueFile['document']['parent'],
  trace: string,
  check: () => void,
  reserve: (bytes: number) => void,
) {
  check();
  const { scope, restore_id } = parent.receipt.query;
  const present = outboxRestoreReceiptTable(db, trace);
  const rows = present
    ? db
        .prepare(
          `SELECT
    CASE WHEN tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY THEN 1 ELSE 0 END AS in_scope,
    CASE WHEN typeof(query_json) = 'text' THEN length(CAST(query_json AS BLOB)) ELSE NULL END AS query_bytes,
    CASE WHEN typeof(archive_json) = 'text' THEN length(CAST(archive_json AS BLOB)) ELSE NULL END AS archive_bytes
    FROM main.local_outbox_restore_receipts WHERE restore_id = ? COLLATE BINARY LIMIT 2
  `,
        )
        .all(scope.tenant_id, scope.workspace_id, scope.project_id, restore_id)
    : [];
  check();
  if (rows.length > 1) throw invalid(trace);
  let relation: OutboxRequeueImportRelation = 'missing';
  const row = rows[0];
  if (row) {
    if (row.in_scope !== 1) relation = 'reserved-other-project';
    else {
      reserve(
        bytes(row.query_bytes, 16384, trace) +
          bytes(row.archive_bytes, OUTBOX_ARCHIVE_FILE_BYTES, trace),
      );
      const stored = outboxRestoreStoredRecord(db, { scope, restore_id }, trace, true);
      if (!stored) throw invalid(trace);
      relation = isDeepStrictEqual(stored, parent) ? 'identical' : 'different';
      check();
    }
  }
  return { storage: present ? ('present' as const) : ('not-present' as const), relation };
}
/** Compare every stored batch field against a fully verified source, even if its target parent is missing. */
export function inspectOutboxRequeueImportReceipt(
  db: DatabaseSync,
  receipt: OutboxRestoreRequeueReceipt,
  trace: string,
  check: () => void,
  reserve: (bytes: number) => void,
) {
  check();
  const { scope, requeue_id } = receipt.query;
  const present = outboxRequeueReceiptTable(db, trace);
  const rows = present
    ? db
        .prepare(
          `SELECT
    CASE WHEN tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY THEN 1 ELSE 0 END AS in_scope,
    CASE WHEN typeof(query_json) = 'text' THEN length(CAST(query_json AS BLOB)) ELSE NULL END AS query_bytes
    FROM main.local_outbox_requeue_receipts WHERE requeue_id = ? COLLATE BINARY LIMIT 2
  `,
        )
        .all(scope.tenant_id, scope.workspace_id, scope.project_id, requeue_id)
    : [];
  check();
  if (rows.length > 1) throw invalid(trace);
  let relation: OutboxRequeueImportRelation = 'missing';
  const metadata = rows[0];
  if (metadata) {
    if (metadata.in_scope !== 1) relation = 'reserved-other-project';
    else {
      reserve(bytes(metadata.query_bytes, 16384, trace));
      const row = db
        .prepare(
          `SELECT ${outboxRequeueReceiptProjection()}
        FROM main.local_outbox_requeue_receipts WHERE requeue_id = ? COLLATE BINARY LIMIT 1`,
        )
        .get(requeue_id);
      if (!row) throw invalid(trace);
      const stored = outboxRequeueReceiptMetadata(row, { scope, requeue_id }, trace);
      relation = isDeepStrictEqual(stored, {
        original_query: receipt.query,
        query_sha256: receipt.query_sha256,
        restore_document_sha256: receipt.restore_document_sha256,
        restore_receipt_sha256: receipt.restore_receipt_sha256,
        before_sha256: receipt.before_sha256,
        after_sha256: receipt.after_sha256,
        requeued_at: receipt.requeued_at,
        requeue_trace_id: receipt.requeue_trace_id,
      })
        ? 'identical'
        : 'different';
      check();
    }
  }
  return { storage: present ? ('present' as const) : ('not-present' as const), relation };
}
export function outboxRequeueImportParentBinding(
  parent: OutboxRequeueImportRelation,
  receipt: OutboxRequeueImportRelation,
) {
  return parent === 'identical' && receipt === 'identical'
    ? ('matched' as const)
    : parent === 'missing' && receipt === 'identical'
      ? ('verified-against-source-only' as const)
      : ('not-matched' as const);
}
