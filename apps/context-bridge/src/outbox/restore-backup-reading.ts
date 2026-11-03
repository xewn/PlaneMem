import type { DatabaseSync } from 'node:sqlite';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { auditOutboxRestoreReceipts } from './restore-audit.js';
import {
  createOutboxRestoreBackup,
  parseOutboxRestoreBackupQuery,
  OUTBOX_RESTORE_BACKUP_DOCUMENT_BYTES,
  type OutboxRestoreBackupRecord,
} from './restore-backup.js';

/** Collect only a complete audited project snapshot. Never creates a file or mutates local history. */
export function readOutboxRestoreBackup(db: DatabaseSync, input: unknown, trace: string) {
  const query = parseOutboxRestoreBackupQuery(input, trace);
  const deadline = performance.now() + query.timeout_ms;
  const records: OutboxRestoreBackupRecord[] = [];
  let encoded_bytes = 0;
  let stage = 'audit';
  let audit_complete = false;
  const check = () => {
    if (performance.now() >= deadline)
      throw new ContractError(
        'OUTBOX_RESTORE_BACKUP_TIMEOUT',
        'The complete history backup exceeded its preparation deadline',
        {
          trace_id: trace,
          retryable: false,
        },
      );
  };
  try {
    const audited = auditOutboxRestoreReceipts(db, query, trace, (record) => {
      check();
      encoded_bytes += Buffer.byteLength(
        syncJsonSnapshot(record, OUTBOX_RESTORE_BACKUP_DOCUMENT_BYTES),
        'utf8',
      );
      if (encoded_bytes > OUTBOX_RESTORE_BACKUP_DOCUMENT_BYTES)
        throw new ContractError(
          'OUTBOX_RESTORE_BACKUP_TOO_LARGE',
          'The entire history cannot fit in one backup; no partial file is available',
          {
            trace_id: trace,
            retryable: false,
          },
        );
      records.push(record);
    });
    audit_complete = true;
    check();
    stage = 'backup';
    const file = createOutboxRestoreBackup(
      {
        schema_version: 1,
        kind: 'workctx.sync-outbox-restore-history',
        scope: query.scope,
        observed_at: audited.observed_at,
        export_trace_id: trace,
        records,
      },
      trace,
      check,
    );
    check();
    return file;
  } catch (error) {
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_BACKUP_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete restore history backup could not be prepared',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          complete: false,
          backup_stage: stage,
          audit_complete,
          collected_receipts: records.length,
          encoded_record_bytes: encoded_bytes,
        },
      },
    );
  }
}
