import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { OUTBOX_ARCHIVE_FILE_BYTES } from './archive.js';
import { outboxReadTransaction } from './reading.js';
import {
  assertOutboxRestoreTrace,
  outboxRestoreBudget,
  createOutboxRestoreReceiptTable,
} from './restore.js';
import {
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
import {
  inspectOutboxRequeueImportParent,
  inspectOutboxRequeueImportReceipt,
  outboxRequeueImportParentBinding,
} from './restore-requeue-import-target.js';

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
  let checked_target_bytes = 0;
  const reserve = (size: number) => {
    checked_target_bytes += size;
  };
  select('restore');
  const parent = inspectOutboxRequeueImportParent(
    db,
    source.document.parent,
    trace,
    check,
    reserve,
  );
  select('requeue');
  const receipt = inspectOutboxRequeueImportReceipt(
    db,
    source.document.receipt,
    trace,
    check,
    reserve,
  );
  select(null);
  const compatible = [parent.relation, receipt.relation].every(
    (relation) => relation === 'missing' || relation === 'identical',
  );
  return {
    parent_storage: parent.storage,
    receipt_storage: receipt.storage,
    parent_relation: parent.relation,
    receipt_relation: receipt.relation,
    compatible,
    missing_restore_histories: parent.relation === 'missing' ? 1 : 0,
    missing_requeue_receipts: receipt.relation === 'missing' ? 1 : 0,
    target_parent_binding: outboxRequeueImportParentBinding(parent.relation, receipt.relation),
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
