import type { DatabaseSync } from 'node:sqlite';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { verifyOutboxArchive } from './archive.js';
import { outboxStoredSendControl } from './control.js';
import { outboxReadTransaction } from './reading.js';
import { outboxRestorePlan } from './restore-preview.js';
import {
  assertOutboxRestoreTrace,
  outboxRestoreBudget,
  outboxRestoreReceiptTable,
  outboxRestoreTarget,
  parseOutboxRestorePreparation,
  parseOutboxRestoreQuery,
  type OutboxRestoreQuery,
} from './restore.js';

/** Prepares a new request from one read snapshot; never substitutes values in an old request. */
export function prepareOutboxArchiveRestore(
  db: DatabaseSync,
  archive: unknown,
  input: unknown,
  trace: string,
) {
  const preparation = parseOutboxRestorePreparation(input, trace);
  assertOutboxRestoreTrace(trace);
  const check = outboxRestoreBudget(trace);
  let stage = 'archive';
  let selected_event_id: string | null = null;
  let restore_query: OutboxRestoreQuery | null = null;
  try {
    const source = verifyOutboxArchive(archive, trace);
    const scope = preparation.scope;
    if (
      source.document.scope.tenant_id !== scope.tenant_id ||
      source.document.scope.workspace_id !== scope.workspace_id ||
      source.document.scope.project_id !== scope.project_id
    )
      throw new ContractError(
        'OUTBOX_RESTORE_ARCHIVE_MISMATCH',
        'The original archive belongs to another project',
        { trace_id: trace },
      );
    check();
    return outboxReadTransaction(
      db,
      () => {
        stage = 'restore-id';
        check();
        // An imported receipt occupies its ID too, even when the current event queue is empty.
        if (
          outboxRestoreReceiptTable(db, trace) &&
          db
            .prepare(
              'SELECT 1 AS present FROM main.local_outbox_restore_receipts WHERE restore_id = ? COLLATE BINARY LIMIT 1',
            )
            .get(preparation.restore_id)
        )
          throw new ContractError(
            'OUTBOX_RESTORE_ID_UNAVAILABLE',
            'A new restore request requires an unused restore ID; retain existing original requests',
            { trace_id: trace },
          );
        stage = 'control';
        const control = outboxStoredSendControl(db, scope, trace);
        if (control.state !== 'paused' || control.generation === null)
          throw new ContractError(
            'OUTBOX_RESTORE_CONTROL_CHANGED',
            'Pause the target explicitly before preparing a new restore request',
            {
              trace_id: trace,
              details: { current_control: control },
            },
          );
        restore_query = parseOutboxRestoreQuery(
          {
            ...preparation,
            archive_sha256: source.document_sha256,
            expected_control_generation: control.generation,
          },
          trace,
        );
        stage = 'target';
        outboxRestoreTarget(db, source, restore_query, trace, check, (event_id) => {
          selected_event_id = event_id;
        });
        stage = 'prepare';
        const observed_at = new Date().toISOString();
        const plan = outboxRestorePlan(source, restore_query, observed_at, trace, check);
        stage = 'result';
        const result = {
          scope,
          preparation,
          restore_query,
          mode: 'prepare' as const,
          observation: 'local-restore-preparation' as const,
          action: 'prepared' as const,
          observed_at,
          source_document_sha256: source.document_sha256,
          source_observed_at: source.document.observed_at,
          source_export_trace_id: source.document.export_trace_id,
          current_control: control,
          current_queue: 'checked-empty' as const,
          restore_id_reserved: false as const,
          local_write: 'not-attempted' as const,
          future_execution: 'rechecks-required' as const,
          server_delivery: 'not-checked' as const,
          sender_stopped: 'not-proven' as const,
          plan,
        };
        syncJsonSnapshot(result, 128 * 1024);
        check();
        return result;
      },
      trace,
    );
  } catch (error) {
    throw new ContractError(
      error instanceof ContractError
        ? error.envelope.code
        : 'OUTBOX_RESTORE_PREPARATION_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete new restore request could not be prepared',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          preparation,
          restore_query,
          stage,
          selected_event_id:
            selected_event_id ??
            (error instanceof ContractError ? error.envelope.details?.selected_event_id : null) ??
            null,
          mode: 'prepare',
          local_write: 'not-attempted',
        },
      },
    );
  }
}
