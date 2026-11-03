import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import {
  auditOutboxRestoreRequeueReceipts,
  type OutboxRestoreRequeueHistoryRecord,
} from './restore-requeue-audit.js';
import {
  createOutboxRestoreRequeueBackup,
  parseOutboxRestoreRequeueBackupQuery,
  OUTBOX_REQUEUE_BACKUP_DOCUMENT_BYTES,
} from './restore-requeue-backup.js';

/** Collect one complete audited snapshot. No file publication or partial history escapes. */
export function readOutboxRestoreRequeueBackup(db: DatabaseSync, input: unknown, trace: string) {
  const query = parseOutboxRestoreRequeueBackupQuery(input, trace);
  const deadline = performance.now() + query.timeout_ms;
  const receipts: OutboxRestoreRequeueHistoryRecord['receipt'][] = [];
  const parents = new Map<string, OutboxRestoreRequeueHistoryRecord['parent']>();
  let encoded_record_bytes = 0;
  let audit_complete = false;
  let stage = 'audit';
  const check = () => {
    if (performance.now() >= deadline)
      throw new ContractError(
        'OUTBOX_REQUEUE_BACKUP_TIMEOUT',
        'Complete backup preparation exceeded its deadline',
        { trace_id: trace, retryable: false },
      );
  };
  const reserve = (input: unknown) => {
    encoded_record_bytes += Buffer.byteLength(
      syncJsonSnapshot(input, OUTBOX_REQUEUE_BACKUP_DOCUMENT_BYTES),
      'utf8',
    );
    if (encoded_record_bytes > OUTBOX_REQUEUE_BACKUP_DOCUMENT_BYTES)
      throw new ContractError(
        'OUTBOX_REQUEUE_BACKUP_TOO_LARGE',
        'The entire deduplicated history exceeds 64 MiB; no partial backup is available',
        { trace_id: trace, retryable: false },
      );
  };
  try {
    const audit = auditOutboxRestoreRequeueReceipts(db, query, trace, ({ receipt, parent }) => {
      check();
      const id = parent.receipt.query.restore_id;
      const existing = parents.get(id);
      if (existing && !isDeepStrictEqual(existing, parent))
        throw new ContractError(
          'OUTBOX_REQUEUE_BACKUP_PARENT_CHANGED',
          'A shared parent differs within the selected history snapshot',
          { trace_id: trace, retryable: false },
        );
      if (!existing) {
        reserve(parent);
        parents.set(id, parent);
      }
      reserve(receipt);
      receipts.push(receipt);
      check();
    });
    audit_complete = true;
    check();
    stage = 'backup';
    const file = createOutboxRestoreRequeueBackup(
      {
        schema_version: 1,
        kind: 'workctx.sync-outbox-requeue-history',
        scope: query.scope,
        observed_at: audit.observed_at,
        export_trace_id: trace,
        parents: [...parents.values()].sort((a, b) =>
          Buffer.compare(
            Buffer.from(a.receipt.query.restore_id),
            Buffer.from(b.receipt.query.restore_id),
          ),
        ),
        receipts,
      },
      trace,
      check,
    );
    check();
    return file;
  } catch (error) {
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_BACKUP_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete project requeue history could not be backed up',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          preparation_stage: stage,
          complete: false,
          audit_complete,
          collected_receipts: receipts.length,
          collected_parents: parents.size,
          encoded_record_bytes,
          local_commit: 'not-attempted',
        },
      },
    );
  }
}
