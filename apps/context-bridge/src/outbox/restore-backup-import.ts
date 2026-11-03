import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import type { OutboxScope } from './sqlite.js';
import { parseOutboxReadScope, outboxReadTransaction } from './reading.js';
import { OUTBOX_ARCHIVE_FILE_BYTES } from './archive.js';
import {
  verifyOutboxRestoreBackup,
  OUTBOX_RESTORE_BACKUP_DOCUMENT_BYTES,
  type OutboxRestoreBackupFile,
} from './restore-backup.js';
import {
  createOutboxRestoreReceiptTable,
  outboxRestoreReceiptTable,
  outboxRestoreStoredRecord,
  assertOutboxRestoreTrace,
} from './restore.js';
import {
  reconciliationTransaction,
  type ReconciliationTransactionState,
} from './reconciliation.js';

export interface OutboxRestoreBackupImportQuery {
  scope: OutboxScope;
  backup_sha256: string;
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
export function parseOutboxRestoreBackupImportQuery(
  input: unknown,
  trace: string,
): OutboxRestoreBackupImportQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).length !== 2 ||
      Object.keys(row).some((key) => !['scope', 'backup_sha256'].includes(key)) ||
      typeof row.backup_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.backup_sha256)
    )
      throw new TypeError();
    return { scope: parseOutboxReadScope(row.scope, trace), backup_sha256: row.backup_sha256 };
  } catch (error) {
    throw fail(
      'OUTBOX_RESTORE_BACKUP_IMPORT_QUERY_INVALID',
      'Supply the exact project scope and backup document SHA-256',
      trace,
      error instanceof ContractError
        ? { ...error.envelope.details, cause_code: error.envelope.code }
        : {},
    );
  }
}
function budget(trace: string) {
  const deadline = performance.now() + 90000;
  return () => {
    if (performance.now() >= deadline)
      throw fail(
        'OUTBOX_RESTORE_BACKUP_IMPORT_TIMEOUT',
        'The complete history import operation exceeded 90 seconds',
        trace,
      );
  };
}
function sourceFor(input: unknown, query: OutboxRestoreBackupImportQuery, trace: string) {
  const source = verifyOutboxRestoreBackup(input, trace);
  if (
    source.document_sha256 !== query.backup_sha256 ||
    !isDeepStrictEqual(source.document.scope, query.scope)
  )
    throw fail(
      'OUTBOX_RESTORE_BACKUP_IMPORT_SOURCE_MISMATCH',
      'The complete backup differs from the original import query',
      trace,
    );
  return source;
}
type Relation = 'missing' | 'identical' | 'different' | 'reserved-other-project';
/** Caller owns one transaction. Only selected history IDs are inspected; current queue/control are untouched. */
function targetPlan(
  db: DatabaseSync,
  source: OutboxRestoreBackupFile,
  trace: string,
  check: () => void,
  select: (id: string | null) => void,
) {
  check();
  const present = outboxRestoreReceiptTable(db, trace);
  const scope = source.document.scope;
  const metadata = present
    ? db.prepare(`SELECT
    CASE WHEN tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY THEN 1 ELSE 0 END AS in_scope,
    CASE WHEN typeof(query_json) = 'text' THEN length(CAST(query_json AS BLOB)) ELSE NULL END AS query_bytes,
    CASE WHEN typeof(archive_json) = 'text' THEN length(CAST(archive_json AS BLOB)) ELSE NULL END AS archive_bytes
    FROM main.local_outbox_restore_receipts WHERE restore_id = ? COLLATE BINARY LIMIT 2`)
    : null;
  const entries: { restore_id: string; relation: Relation }[] = [];
  let checked_target_bytes = 0;
  for (const original of source.document.records) {
    check();
    const restore_id = original.receipt.query.restore_id;
    select(restore_id);
    const rows =
      metadata?.all(scope.tenant_id, scope.workspace_id, scope.project_id, restore_id) ?? [];
    if (rows.length > 1)
      throw fail(
        'OUTBOX_RESTORE_BACKUP_IMPORT_TARGET_INVALID',
        'A selected restore ID is duplicated; preserve the destination history',
        trace,
      );
    const row = rows[0];
    if (!row) {
      entries.push({ restore_id, relation: 'missing' });
      continue;
    }
    if (row.in_scope !== 1) {
      entries.push({ restore_id, relation: 'reserved-other-project' });
      continue;
    }
    if (
      typeof row.query_bytes !== 'number' ||
      !Number.isSafeInteger(row.query_bytes) ||
      row.query_bytes < 1 ||
      row.query_bytes > 16384 ||
      typeof row.archive_bytes !== 'number' ||
      !Number.isSafeInteger(row.archive_bytes) ||
      row.archive_bytes < 1 ||
      row.archive_bytes > OUTBOX_ARCHIVE_FILE_BYTES
    )
      throw fail(
        'OUTBOX_RESTORE_BACKUP_IMPORT_TARGET_INVALID',
        'A selected history has invalid or oversized metadata',
        trace,
      );
    if (
      checked_target_bytes + row.query_bytes + row.archive_bytes >
      OUTBOX_RESTORE_BACKUP_DOCUMENT_BYTES
    )
      throw fail(
        'OUTBOX_RESTORE_BACKUP_IMPORT_TARGET_TOO_LARGE',
        'Selected destination history exceeds the 64 MiB read budget',
        trace,
        { checked_target_bytes },
      );
    check();
    const stored = outboxRestoreStoredRecord(db, { scope, restore_id }, trace, true);
    if (!stored)
      throw fail(
        'OUTBOX_RESTORE_BACKUP_IMPORT_TARGET_INVALID',
        'Selected destination history disappeared inside the snapshot',
        trace,
      );
    checked_target_bytes += row.query_bytes + row.archive_bytes;
    entries.push({
      restore_id,
      relation: isDeepStrictEqual(stored, original) ? 'identical' : 'different',
    });
    check();
  }
  select(null);
  check();
  return {
    receipt_storage: present ? ('present' as const) : ('not-present' as const),
    entries,
    missing_receipts: entries.filter((entry) => entry.relation === 'missing').length,
    identical_receipts: entries.filter((entry) => entry.relation === 'identical').length,
    conflicting_receipts: entries.filter(
      (entry) => entry.relation === 'different' || entry.relation === 'reserved-other-project',
    ).length,
    checked_target_bytes,
    target_byte_basis: 'selected-stored-query-and-source-archive-json-utf8' as const,
  };
}
function summary(source: OutboxRestoreBackupFile, query: OutboxRestoreBackupImportQuery) {
  return {
    scope: query.scope,
    query,
    backup_sha256: source.document_sha256,
    backup_observed_at: source.document.observed_at,
    backup_export_trace_id: source.document.export_trace_id,
    records: source.document.records.length,
    restored_events: 0 as const,
    merge_policy: 'missing-only-exact-history' as const,
    current_queue: 'not-read-or-modified' as const,
    current_control: 'not-read-or-modified' as const,
    server_delivery: 'not-checked' as const,
    source_authenticity: 'not-proven' as const,
    prior_import_commit: 'not-proven' as const,
    database_integrity: 'not-audited' as const,
  };
}
function bounded<T>(result: T, trace: string): T {
  try {
    syncJsonSnapshot(result, 128 * 1024);
  } catch {
    throw fail(
      'OUTBOX_RESTORE_BACKUP_IMPORT_RESULT_TOO_LARGE',
      'The complete history import result exceeds 128 KiB',
      trace,
    );
  }
  return result;
}

export function previewOutboxRestoreBackupImport(
  db: DatabaseSync,
  input: unknown,
  selection: unknown,
  trace: string,
) {
  const query = parseOutboxRestoreBackupImportQuery(selection, trace);
  const check = budget(trace);
  let stage = 'source';
  let target_restore_id: string | null = null;
  try {
    const source = sourceFor(input, query, trace);
    check();
    stage = 'target';
    const result = outboxReadTransaction(
      db,
      () => {
        const plan = targetPlan(db, source, trace, check, (id) => {
          target_restore_id = id;
        });
        stage = 'result';
        const result = bounded(
          {
            ...summary(source, query),
            ...plan,
            status: plan.conflicting_receipts ? ('conflict' as const) : ('compatible' as const),
            observation: 'current-history-import-preview' as const,
            local_commit: 'not-attempted' as const,
            observed_at: new Date().toISOString(),
          },
          trace,
        );
        check();
        return result;
      },
      trace,
    );
    check();
    return result;
  } catch (error) {
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'OUTBOX_RESTORE_BACKUP_IMPORT_PREVIEW_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete history import preview could not be read',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        stage,
        target_restore_id,
        local_commit: 'not-attempted',
      },
    );
  }
}

/** Missing history only, inserted and fully read back in one write transaction. No event restoration. */
export function importOutboxRestoreBackup(
  db: DatabaseSync,
  input: unknown,
  selection: unknown,
  trace: string,
) {
  const query = parseOutboxRestoreBackupImportQuery(selection, trace);
  assertOutboxRestoreTrace(trace);
  const check = budget(trace);
  const transaction: ReconciliationTransactionState = {
    settlement: 'not-committed',
    phase: 'not-started',
    rollback: 'not-needed',
  };
  let stage = 'source';
  let target_restore_id: string | null = null;
  let candidate_result: Record<string, unknown> | null = null;
  try {
    const source = sourceFor(input, query, trace);
    check();
    stage = 'target';
    const result = reconciliationTransaction(
      (sql) => db.exec(sql),
      () => {
        const plan = targetPlan(db, source, trace, check, (id) => {
          target_restore_id = id;
        });
        if (plan.conflicting_receipts)
          throw fail(
            'OUTBOX_RESTORE_BACKUP_IMPORT_CONFLICT',
            'Destination history conflicts with the backup; no history is replaced',
            trace,
            {
              conflicts: plan.entries.filter(
                (entry) =>
                  entry.relation === 'different' || entry.relation === 'reserved-other-project',
              ),
              missing_receipts: plan.missing_receipts,
              identical_receipts: plan.identical_receipts,
            },
          );
        const data = {
          ...summary(source, query),
          action: plan.missing_receipts ? ('imported' as const) : ('already-present' as const),
          inserted_receipts: plan.missing_receipts,
          identical_receipts: plan.identical_receipts,
        };
        candidate_result = bounded(
          { ...data, observation: 'unconfirmed-history-import' as const },
          trace,
        );
        if (plan.missing_receipts) {
          stage = 'initialize';
          if (plan.receipt_storage === 'not-present') createOutboxRestoreReceiptTable(db);
          const insert = db.prepare(`INSERT INTO main.local_outbox_restore_receipts
          (schema_version,restore_id,tenant_id,workspace_id,project_id,query_json,archive_json,restored_at,restore_trace_id,restored_document_sha256)
          VALUES (1,?,?,?,?,?,?,?,?,?)`);
          stage = 'insert';
          const missing = new Set(
            plan.entries
              .filter((entry) => entry.relation === 'missing')
              .map((entry) => entry.restore_id),
          );
          for (const record of source.document.records) {
            check();
            const receipt = record.receipt;
            if (!missing.has(receipt.query.restore_id)) continue;
            target_restore_id = receipt.query.restore_id;
            const changed = insert.run(
              receipt.query.restore_id,
              query.scope.tenant_id,
              query.scope.workspace_id,
              query.scope.project_id,
              syncJsonSnapshot(receipt.query, 16384),
              syncJsonSnapshot(record.source, OUTBOX_ARCHIVE_FILE_BYTES),
              receipt.restored_at,
              receipt.restore_trace_id,
              receipt.restored_document_sha256,
            );
            if (Number(changed.changes) !== 1)
              throw fail(
                'OUTBOX_RESTORE_BACKUP_IMPORT_WRITE_FAILED',
                'An original history could not be inserted exactly once',
                trace,
              );
          }
        }
        stage = 'readback';
        const after = targetPlan(db, source, trace, check, (id) => {
          target_restore_id = id;
        });
        if (
          after.identical_receipts !== source.document.records.length ||
          after.missing_receipts ||
          after.conflicting_receipts
        )
          throw fail(
            'OUTBOX_RESTORE_BACKUP_IMPORT_READBACK_FAILED',
            'The complete selected history did not read back exactly',
            trace,
          );
        const result = bounded(
          {
            ...data,
            observation: 'current-local-history-import' as const,
            observed_at: new Date().toISOString(),
            local_commit: 'committed' as const,
          },
          trace,
        );
        check();
        stage = 'commit';
        return result;
      },
      transaction,
      trace,
      check,
    );
    // Once COMMIT succeeds, neither a later deadline nor close failure can negate it.
    return result;
  } catch (error) {
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'OUTBOX_RESTORE_BACKUP_IMPORT_UNAVAILABLE',
      transaction.settlement === 'unknown'
        ? 'The history import commit is unknown; preserve the original query and backup, then preview the destination before continuing'
        : error instanceof ContractError
          ? error.envelope.message
          : 'The complete restore history backup could not be imported',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        stage,
        target_restore_id,
        candidate_result,
        local_commit: transaction.settlement,
        transaction: { phase: transaction.phase, rollback: transaction.rollback },
      },
    );
  }
}
