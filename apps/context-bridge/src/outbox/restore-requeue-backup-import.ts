import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { OUTBOX_ARCHIVE_FILE_BYTES } from './archive.js';
import { outboxReadTransaction } from './reading.js';
import {
  assertOutboxRestoreTrace,
  outboxRestoreBudget,
  outboxRestoreReceiptTable,
  createOutboxRestoreReceiptTable,
} from './restore.js';
import {
  outboxRequeueReceiptTable,
  createOutboxRequeueReceiptTable,
  saveOutboxRequeueReceipt,
  type OutboxRestoreRequeueReceipt,
} from './restore-requeue-receipt.js';
import {
  reconciliationTransaction,
  type ReconciliationTransactionState,
} from './reconciliation.js';
import {
  verifyOutboxRestoreRequeueBackup,
  parseOutboxRestoreRequeueBackupImportQuery,
  outboxRestoreRequeueBackupSummary,
} from './restore-requeue-backup.js';
import {
  inspectOutboxRequeueImportParent,
  inspectOutboxRequeueImportReceipt,
  outboxRequeueImportParentBinding,
  type OutboxRequeueImportRelation,
} from './restore-requeue-import-target.js';

const PASS_BYTES = 64 * 1024 * 1024;
const TOTAL_BYTES = 256 * 1024 * 1024;
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function bounded<T>(input: T, trace: string): T {
  try {
    syncJsonSnapshot(input, 128 * 1024);
  } catch {
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_IMPORT_RESULT_TOO_LARGE',
      'The complete import metadata exceeds 128 KiB',
      trace,
    );
  }
  return input;
}
const conflict = (relation: OutboxRequeueImportRelation) =>
  relation === 'different' || relation === 'reserved-other-project';

/** One transaction for the complete collection. Only missing immutable histories are inserted. */
export function importOutboxRestoreRequeueBackup(
  db: DatabaseSync,
  input: unknown,
  selection: unknown,
  trace: string,
  preview = false,
) {
  const query = parseOutboxRestoreRequeueBackupImportQuery(selection, trace);
  assertOutboxRestoreTrace(trace);
  const check = outboxRestoreBudget(trace);
  const transaction: ReconciliationTransactionState = {
    settlement: 'not-committed',
    phase: 'not-started',
    rollback: 'not-needed',
  };
  let stage = 'source';
  let target_restore_id: string | null = null;
  let target_requeue_id: string | null = null;
  let selected_source_receipt: OutboxRestoreRequeueReceipt | null = null;
  let source_history: ReturnType<typeof outboxRestoreRequeueBackupSummary> | null = null;
  let candidate_plan: Record<string, unknown> | null = null;
  let candidate_result: Record<string, unknown> | null = null;
  let read_pass = 'not-started';
  let pass_reserved_bytes = 0;
  let total_reserved_bytes = 0;
  let checked_parents = 0;
  let checked_receipts = 0;
  const reserve = (bytes: number) => {
    check();
    if (pass_reserved_bytes + bytes > PASS_BYTES || total_reserved_bytes + bytes > TOTAL_BYTES)
      throw fail(
        'OUTBOX_REQUEUE_BACKUP_IMPORT_TARGET_TOO_LARGE',
        'Selected target history exceeds the 64 MiB comparison or 256 MiB operation budget',
        trace,
        { requested_target_bytes: bytes },
      );
    pass_reserved_bytes += bytes;
    total_reserved_bytes += bytes;
  };
  const startPass = (name: string) => {
    read_pass = name;
    pass_reserved_bytes = 0;
    checked_parents = 0;
    checked_receipts = 0;
    target_restore_id = null;
    target_requeue_id = null;
    selected_source_receipt = null;
    check();
  };
  try {
    const source = verifyOutboxRestoreRequeueBackup(input, trace);
    if (
      source.document_sha256 !== query.backup_sha256 ||
      !isDeepStrictEqual(source.document.scope, query.scope)
    )
      throw fail(
        'OUTBOX_REQUEUE_BACKUP_IMPORT_SOURCE_MISMATCH',
        'The complete backup differs from the original import query',
        trace,
      );
    source_history = outboxRestoreRequeueBackupSummary(source);
    check();
    const summary = {
      scope: query.scope,
      query,
      backup_sha256: source.document_sha256,
      backup_observed_at: source.document.observed_at,
      backup_export_trace_id: source.document.export_trace_id,
      receipts: source.document.receipts.length,
      parent_histories: source.document.parents.length,
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
    const inspect = (name: string) => {
      startPass(name);
      const parentPresent = outboxRestoreReceiptTable(db, trace);
      const receiptPresent = outboxRequeueReceiptTable(db, trace);
      const parentRelations = new Map<string, OutboxRequeueImportRelation>();
      const parents = source.document.parents.map((parent) => {
        target_restore_id = parent.receipt.query.restore_id;
        const target = inspectOutboxRequeueImportParent(db, parent, trace, check, reserve);
        parentRelations.set(target_restore_id, target.relation);
        checked_parents += 1;
        return { restore_id: target_restore_id, relation: target.relation };
      });
      const receipts = source.document.receipts.map((receipt) => {
        target_restore_id = receipt.query.restore_id;
        target_requeue_id = receipt.query.requeue_id;
        selected_source_receipt = receipt;
        const target = inspectOutboxRequeueImportReceipt(db, receipt, trace, check, reserve);
        const parent = parentRelations.get(receipt.query.restore_id);
        if (parent === undefined) throw new TypeError();
        checked_receipts += 1;
        return {
          requeue_id: receipt.query.requeue_id,
          restore_id: receipt.query.restore_id,
          relation: target.relation,
          target_parent_binding: outboxRequeueImportParentBinding(parent, target.relation),
        };
      });
      target_restore_id = null;
      target_requeue_id = null;
      selected_source_receipt = null;
      check();
      return bounded(
        {
          parent_storage: parentPresent ? ('present' as const) : ('not-present' as const),
          receipt_storage: receiptPresent ? ('present' as const) : ('not-present' as const),
          parents,
          receipts,
          compatible:
            parents.every((item) => !conflict(item.relation)) &&
            receipts.every((item) => !conflict(item.relation)),
          missing_restore_histories: parents.filter((item) => item.relation === 'missing').length,
          missing_requeue_receipts: receipts.filter((item) => item.relation === 'missing').length,
          identical_restore_histories: parents.filter((item) => item.relation === 'identical')
            .length,
          identical_requeue_receipts: receipts.filter((item) => item.relation === 'identical')
            .length,
          conflicting_restore_histories: parents.filter((item) => conflict(item.relation)).length,
          conflicting_requeue_receipts: receipts.filter((item) => conflict(item.relation)).length,
          checked_target_bytes: pass_reserved_bytes,
          target_byte_basis:
            'distinct-parent-query-archive-and-batch-query-utf8-per-comparison' as const,
        },
        trace,
      );
    };
    const run = () => {
      stage = 'target';
      const plan = inspect('initial');
      candidate_plan = plan;
      check();
      if (preview) {
        stage = 'preview-result';
        return bounded(
          {
            ...summary,
            plan,
            status: plan.compatible ? ('compatible' as const) : ('conflict' as const),
            observation: 'current-requeue-backup-import-preview' as const,
            local_commit: 'not-attempted' as const,
            observed_at: new Date().toISOString(),
          },
          trace,
        );
      }
      if (!plan.compatible)
        throw fail(
          'OUTBOX_REQUEUE_BACKUP_IMPORT_CONFLICT',
          'The backup conflicts with selected destination histories; no existing content is replaced',
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
        identical_restore_histories: plan.identical_restore_histories,
        identical_requeue_receipts: plan.identical_requeue_receipts,
      };
      candidate_result = bounded(
        { ...data, observation: 'unconfirmed-requeue-backup-import' },
        trace,
      );
      stage = 'initialize';
      check();
      if (plan.missing_restore_histories && plan.parent_storage === 'not-present')
        createOutboxRestoreReceiptTable(db);
      check();
      if (plan.missing_requeue_receipts && plan.receipt_storage === 'not-present')
        createOutboxRequeueReceiptTable(db);
      const missingParents = new Set(
        plan.parents.filter((item) => item.relation === 'missing').map((item) => item.restore_id),
      );
      const missingReceipts = new Set(
        plan.receipts.filter((item) => item.relation === 'missing').map((item) => item.requeue_id),
      );
      startPass('before-parent-writes');
      for (const parent of source.document.parents) {
        if (!missingParents.has(parent.receipt.query.restore_id)) continue;
        target_restore_id = parent.receipt.query.restore_id;
        stage = 'before-parent';
        const before = inspectOutboxRequeueImportParent(db, parent, trace, check, reserve);
        if (before.relation !== 'missing')
          throw fail(
            'OUTBOX_REQUEUE_BACKUP_IMPORT_TARGET_CHANGED',
            'A planned missing parent changed during import',
            trace,
            { observed_relation: before.relation },
          );
        checked_parents += 1;
        stage = 'insert-parent';
        check();
        const receipt = parent.receipt;
        const changed = db
          .prepare(
            `INSERT INTO main.local_outbox_restore_receipts
          (schema_version,restore_id,tenant_id,workspace_id,project_id,query_json,archive_json,restored_at,restore_trace_id,restored_document_sha256)
          VALUES (1,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            receipt.query.restore_id,
            query.scope.tenant_id,
            query.scope.workspace_id,
            query.scope.project_id,
            syncJsonSnapshot(receipt.query, 16384),
            syncJsonSnapshot(parent.source, OUTBOX_ARCHIVE_FILE_BYTES),
            receipt.restored_at,
            receipt.restore_trace_id,
            receipt.restored_document_sha256,
          );
        if (Number(changed.changes) !== 1)
          throw fail(
            'OUTBOX_REQUEUE_BACKUP_IMPORT_WRITE_FAILED',
            'A parent history was not inserted exactly once',
            trace,
          );
      }
      stage = 'before-batches';
      const before = inspect('after-parent-writes');
      const planned = new Map(plan.receipts.map((item) => [item.requeue_id, item.relation]));
      if (
        before.parents.some((item) => item.relation !== 'identical') ||
        before.receipts.some((item) => item.relation !== planned.get(item.requeue_id))
      )
        throw fail(
          'OUTBOX_REQUEUE_BACKUP_IMPORT_TARGET_CHANGED',
          'Selected histories changed after parent insertion',
          trace,
          { observed_plan: before },
        );
      startPass('before-batch-writes');
      for (const receipt of source.document.receipts) {
        if (!missingReceipts.has(receipt.query.requeue_id)) continue;
        target_restore_id = receipt.query.restore_id;
        target_requeue_id = receipt.query.requeue_id;
        selected_source_receipt = receipt;
        stage = 'before-batch';
        const before = inspectOutboxRequeueImportReceipt(db, receipt, trace, check, reserve);
        if (before.relation !== 'missing')
          throw fail(
            'OUTBOX_REQUEUE_BACKUP_IMPORT_TARGET_CHANGED',
            'A planned missing batch changed during import',
            trace,
            { observed_relation: before.relation },
          );
        checked_receipts += 1;
        stage = 'insert-batch';
        check();
        saveOutboxRequeueReceipt(db, receipt, trace);
      }
      stage = 'readback';
      // All parent bodies are fully verified once here. Every batch field must equal its verified
      // source, whose parent/query/before/after bindings were verified before entering this transaction.
      // This closes every link without repeatedly loading shared parent bodies per batch.
      const after = inspect('final-readback');
      if (
        after.parents.some((item) => item.relation !== 'identical') ||
        after.receipts.some((item) => item.relation !== 'identical')
      )
        throw fail(
          'OUTBOX_REQUEUE_BACKUP_IMPORT_READBACK_FAILED',
          'The entire selected history did not read back exactly',
          trace,
          { observed_plan: after },
        );
      const result = bounded(
        {
          ...data,
          readback: 'all-selected-parent-histories-and-batch-bindings' as const,
          checked_target_bytes: after.checked_target_bytes,
          total_target_bytes: total_reserved_bytes,
          target_byte_basis: after.target_byte_basis,
          observation: 'current-local-requeue-backup-import' as const,
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
    if (preview) check();
    return result;
  } catch (error) {
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'OUTBOX_REQUEUE_BACKUP_IMPORT_UNAVAILABLE',
      !preview && transaction.settlement === 'unknown'
        ? 'The backup history import commit is unknown; preserve the original backup/query and inspect the target before continuing'
        : error instanceof ContractError
          ? error.envelope.message
          : 'The complete backup import could not be confirmed',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        stage,
        target_restore_id,
        target_requeue_id,
        selected_source_receipt,
        source_history,
        candidate_plan,
        candidate_result,
        read_pass,
        pass_reserved_bytes,
        total_reserved_bytes,
        checked_parents,
        checked_receipts,
        local_commit: preview ? 'not-attempted' : transaction.settlement,
        ...(preview
          ? {}
          : { transaction: { phase: transaction.phase, rollback: transaction.rollback } }),
      },
    );
  }
}
