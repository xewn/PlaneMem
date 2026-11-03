import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { OUTBOX_ARCHIVE_FILE_BYTES } from './archive.js';
import { outboxReadTransaction } from './reading.js';
import {
  assertOutboxRestoreTrace,
  outboxRestoreBudget,
  outboxRestoreReceiptTable,
  outboxRestoreStoredRecord,
  createOutboxRestoreReceiptTable,
} from './restore.js';
import {
  outboxRequeueReceiptTable,
  outboxRequeueReceiptProjection,
  outboxRequeueReceiptMetadata,
  outboxStoredRequeueRecord,
  createOutboxRequeueReceiptTable,
  saveOutboxRequeueReceipt,
} from './restore-requeue-receipt.js';
import {
  verifyOutboxRestoreRequeueFile,
  parseOutboxRestoreRequeueImportQuery,
  outboxRestoreRequeueFileSummary,
  type OutboxRestoreRequeueFile,
} from './restore-requeue-file.js';
import {
  reconciliationTransaction,
  type ReconciliationTransactionState,
} from './reconciliation.js';

type Relation = 'missing' | 'identical' | 'different' | 'reserved-other-project';
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function targetPlan(
  db: DatabaseSync,
  source: OutboxRestoreRequeueFile,
  trace: string,
  check: () => void,
  select: (kind: 'restore' | 'requeue' | null) => void,
) {
  const { scope, parent, receipt } = source.document;
  const scopeArgs = [scope.tenant_id, scope.workspace_id, scope.project_id];
  const invalid = () =>
    fail(
      'OUTBOX_REQUEUE_IMPORT_TARGET_INVALID',
      'Selected destination history is invalid or ambiguous; preserve it',
      trace,
    );
  const bytes = (value: unknown, maximum: number) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw invalid();
    return value;
  };
  check();
  select('restore');
  const parentPresent = outboxRestoreReceiptTable(db, trace);
  const parentRows = parentPresent
    ? db
        .prepare(
          `SELECT
    CASE WHEN tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY THEN 1 ELSE 0 END AS in_scope,
    CASE WHEN typeof(query_json) = 'text' THEN length(CAST(query_json AS BLOB)) ELSE NULL END AS query_bytes,
    CASE WHEN typeof(archive_json) = 'text' THEN length(CAST(archive_json AS BLOB)) ELSE NULL END AS archive_bytes
    FROM main.local_outbox_restore_receipts WHERE restore_id = ? COLLATE BINARY LIMIT 2
  `,
        )
        .all(...scopeArgs, receipt.query.restore_id)
    : [];
  check();
  if (parentRows.length > 1) throw invalid();
  let parent_relation: Relation = 'missing';
  let checked_target_bytes = 0;
  const parentRow = parentRows[0];
  if (parentRow) {
    if (parentRow.in_scope !== 1) parent_relation = 'reserved-other-project';
    else {
      checked_target_bytes +=
        bytes(parentRow.query_bytes, 16384) +
        bytes(parentRow.archive_bytes, OUTBOX_ARCHIVE_FILE_BYTES);
      const stored = outboxRestoreStoredRecord(
        db,
        { scope, restore_id: receipt.query.restore_id },
        trace,
        true,
      );
      if (!stored) throw invalid();
      parent_relation = isDeepStrictEqual(stored, parent) ? 'identical' : 'different';
      check();
    }
  }
  select('requeue');
  const receiptPresent = outboxRequeueReceiptTable(db, trace);
  const receiptRows = receiptPresent
    ? db
        .prepare(
          `SELECT
    CASE WHEN tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY THEN 1 ELSE 0 END AS in_scope,
    CASE WHEN typeof(query_json) = 'text' THEN length(CAST(query_json AS BLOB)) ELSE NULL END AS query_bytes
    FROM main.local_outbox_requeue_receipts WHERE requeue_id = ? COLLATE BINARY LIMIT 2
  `,
        )
        .all(...scopeArgs, receipt.query.requeue_id)
    : [];
  check();
  if (receiptRows.length > 1) throw invalid();
  let receipt_relation: Relation = 'missing';
  const receiptRow = receiptRows[0];
  if (receiptRow) {
    if (receiptRow.in_scope !== 1) receipt_relation = 'reserved-other-project';
    else {
      checked_target_bytes += bytes(receiptRow.query_bytes, 16384);
      const row = db
        .prepare(
          `SELECT ${outboxRequeueReceiptProjection()}
        FROM main.local_outbox_requeue_receipts WHERE requeue_id = ? COLLATE BINARY LIMIT 1`,
        )
        .get(receipt.query.requeue_id);
      if (!row) throw invalid();
      const stored = outboxRequeueReceiptMetadata(
        row,
        { scope, requeue_id: receipt.query.requeue_id },
        trace,
      );
      receipt_relation = isDeepStrictEqual(stored, {
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
  select(null);
  const compatible = [parent_relation, receipt_relation].every(
    (relation) => relation === 'missing' || relation === 'identical',
  );
  return {
    parent_storage: parentPresent ? ('present' as const) : ('not-present' as const),
    receipt_storage: receiptPresent ? ('present' as const) : ('not-present' as const),
    parent_relation,
    receipt_relation,
    compatible,
    missing_restore_histories: parent_relation === 'missing' ? 1 : 0,
    missing_requeue_receipts: receipt_relation === 'missing' ? 1 : 0,
    target_parent_binding:
      parent_relation === 'identical' && receipt_relation === 'identical'
        ? ('matched' as const)
        : parent_relation === 'missing' && receipt_relation === 'identical'
          ? ('verified-against-source-only' as const)
          : ('not-matched' as const),
    checked_target_bytes,
    target_byte_basis:
      'selected-stored-requeue-query-and-parent-query-archive-utf8-per-inspection' as const,
  };
}
function bounded<T>(value: T, trace: string) {
  try {
    syncJsonSnapshot(value, 128 * 1024);
  } catch {
    throw fail(
      'OUTBOX_REQUEUE_IMPORT_RESULT_TOO_LARGE',
      'The complete import result exceeds 128 KiB',
      trace,
    );
  }
  return value;
}

/** Import immutable history only. Parent and batch are committed together; current events are untouched. */
export function importOutboxRestoreRequeueFile(
  db: DatabaseSync,
  input: unknown,
  selection: unknown,
  trace: string,
  preview = false,
) {
  const query = parseOutboxRestoreRequeueImportQuery(selection, trace);
  assertOutboxRestoreTrace(trace);
  const check = outboxRestoreBudget(trace);
  const transaction: ReconciliationTransactionState = {
    settlement: 'not-committed',
    phase: 'not-started',
    rollback: 'not-needed',
  };
  let stage = 'source';
  let target_kind: 'restore' | 'requeue' | null = null;
  let source_history: ReturnType<typeof outboxRestoreRequeueFileSummary> | null = null;
  let source_receipt: OutboxRestoreRequeueFile['document']['receipt'] | null = null;
  let candidate_plan: ReturnType<typeof targetPlan> | null = null;
  let candidate_result: Record<string, unknown> | null = null;
  try {
    const source = verifyOutboxRestoreRequeueFile(input, trace);
    if (
      source.document_sha256 !== query.document_sha256 ||
      source.document.receipt.query.requeue_id !== query.requeue_id ||
      !isDeepStrictEqual(source.document.scope, query.scope)
    )
      throw fail(
        'OUTBOX_REQUEUE_IMPORT_SOURCE_MISMATCH',
        'The complete receipt file differs from the original import query',
        trace,
      );
    source_history = outboxRestoreRequeueFileSummary(source);
    source_receipt = source.document.receipt;
    check();
    const summary = {
      scope: query.scope,
      query,
      requeue_id: query.requeue_id,
      restore_id: source.document.receipt.query.restore_id,
      document_sha256: source.document_sha256,
      source_observed_at: source.document.observed_at,
      source_export_trace_id: source.document.export_trace_id,
      merge_policy: 'missing-only-exact-history' as const,
      restored_events: 0 as const,
      requeued_events: 0 as const,
      current_queue: 'not-read-or-modified' as const,
      current_control: 'not-read-or-modified' as const,
      server_delivery: 'not-checked' as const,
      source_authenticity: 'not-proven' as const,
      prior_import_commit: 'not-proven' as const,
      database_integrity: 'not-audited' as const,
    };
    const inspect = () =>
      targetPlan(db, source, trace, check, (kind) => {
        target_kind = kind;
      });
    const run = () => {
      stage = 'target';
      const plan = inspect();
      candidate_plan = plan;
      check();
      if (preview) {
        stage = 'preview-result';
        return bounded(
          {
            ...summary,
            ...plan,
            status: plan.compatible ? ('compatible' as const) : ('conflict' as const),
            observation: 'current-requeue-history-import-preview' as const,
            local_commit: 'not-attempted' as const,
            observed_at: new Date().toISOString(),
          },
          trace,
        );
      }
      if (!plan.compatible)
        throw fail(
          'OUTBOX_REQUEUE_IMPORT_CONFLICT',
          'Destination history conflicts with the selected file; no existing history is replaced',
          trace,
          { plan },
        );
      const data = {
        ...summary,
        action:
          plan.missing_restore_histories || plan.missing_requeue_receipts
            ? ('imported' as const)
            : ('already-present' as const),
        inserted_restore_histories: plan.missing_restore_histories,
        inserted_requeue_receipts: plan.missing_requeue_receipts,
      };
      candidate_result = bounded(
        { ...data, observation: 'unconfirmed-requeue-history-import' },
        trace,
      );
      stage = 'initialize';
      if (plan.parent_storage === 'not-present') createOutboxRestoreReceiptTable(db);
      if (plan.receipt_storage === 'not-present') createOutboxRequeueReceiptTable(db);
      if (plan.missing_restore_histories) {
        stage = 'insert-parent';
        target_kind = 'restore';
        check();
        const original = source.document.parent;
        const parent = original.receipt;
        const changed = db
          .prepare(
            `INSERT INTO main.local_outbox_restore_receipts
          (schema_version,restore_id,tenant_id,workspace_id,project_id,query_json,archive_json,restored_at,restore_trace_id,restored_document_sha256)
          VALUES (1,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            parent.query.restore_id,
            query.scope.tenant_id,
            query.scope.workspace_id,
            query.scope.project_id,
            syncJsonSnapshot(parent.query, 16384),
            syncJsonSnapshot(original.source, OUTBOX_ARCHIVE_FILE_BYTES),
            parent.restored_at,
            parent.restore_trace_id,
            parent.restored_document_sha256,
          );
        if (Number(changed.changes) !== 1)
          throw fail(
            'OUTBOX_REQUEUE_IMPORT_WRITE_FAILED',
            'The original parent history was not inserted exactly once',
            trace,
          );
      }
      // A parent trigger must not silently create or alter the selected batch before its planned write.
      stage = 'before-batch';
      const before = inspect();
      if (
        before.parent_relation !== 'identical' ||
        before.receipt_relation !== plan.receipt_relation
      )
        throw fail(
          'OUTBOX_REQUEUE_IMPORT_TARGET_CHANGED',
          'Selected history changed during import; preserve the original file',
          trace,
          { observed_plan: before },
        );
      if (plan.missing_requeue_receipts) {
        stage = 'insert-batch';
        target_kind = 'requeue';
        check();
        saveOutboxRequeueReceipt(db, source.document.receipt, trace);
      }
      stage = 'readback';
      const after = inspect();
      if (after.parent_relation !== 'identical' || after.receipt_relation !== 'identical')
        throw fail(
          'OUTBOX_REQUEUE_IMPORT_READBACK_FAILED',
          'The complete selected histories did not read back exactly',
          trace,
          { observed_plan: after },
        );
      target_kind = 'requeue';
      const stored = outboxStoredRequeueRecord(
        db,
        source.document.receipt.query,
        trace,
        check,
        source.document.receipt.query,
      );
      if (
        !isDeepStrictEqual(stored.recorded, source.document.receipt) ||
        !isDeepStrictEqual(stored.history, source.document.parent)
      )
        throw fail(
          'OUTBOX_REQUEUE_IMPORT_READBACK_FAILED',
          'The final linked batch and parent history differ from the source',
          trace,
        );
      target_kind = null;
      const result = bounded(
        {
          ...data,
          observation: 'current-local-requeue-history-import' as const,
          local_commit: 'committed' as const,
          observed_at: new Date().toISOString(),
        },
        trace,
      );
      check();
      stage = 'commit';
      return result;
    };
    stage = 'transaction';
    const result = preview
      ? outboxReadTransaction(db, run, trace)
      : reconciliationTransaction((sql) => db.exec(sql), run, transaction, trace, check);
    if (preview) check(); // Successful write COMMIT must not be invalidated by a later deadline.
    return result;
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_IMPORT_UNAVAILABLE',
      !preview && transaction.settlement === 'unknown'
        ? 'The history import commit is unknown; preserve the original file/query and preview the destination before continuing'
        : error instanceof ContractError
          ? error.envelope.message
          : 'The complete requeue history import could not be confirmed',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        stage,
        target_kind,
        selected_requeue_id: query.requeue_id,
        selected_restore_id: source_receipt?.query.restore_id ?? null,
        source_history,
        source_receipt,
        candidate_plan,
        candidate_result,
        local_commit: preview ? 'not-attempted' : transaction.settlement,
        ...(preview
          ? {}
          : { transaction: { phase: transaction.phase, rollback: transaction.rollback } }),
      },
    );
  }
}
