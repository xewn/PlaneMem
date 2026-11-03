import type { DatabaseSync } from 'node:sqlite';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import {
  OUTBOX_ARCHIVE_DOCUMENT_BYTES,
  OUTBOX_ARCHIVE_FILE_BYTES,
  type OutboxArchiveFile,
} from './archive.js';
import { outboxReadTransaction } from './reading.js';
import {
  assertOutboxRestoreTrace,
  outboxRestoreBudget,
  outboxRestoreOriginalReceipt,
  outboxRestoreRecords,
  outboxRestoreSource,
  outboxRestoreTarget,
  parseOutboxRestoreQuery,
  type OutboxRestoreReceipt,
  type OutboxRestoreQuery,
} from './restore.js';

/** Caller owns the read snapshot and deadline. Shared immutable mapping and serialization bounds. */
export function outboxRestorePlan(
  source: OutboxArchiveFile,
  query: OutboxRestoreQuery,
  observed_at: string,
  trace: string,
  check: () => void,
) {
  const restored = outboxRestoreRecords(source, observed_at, trace);
  syncJsonSnapshot(query, 16384);
  syncJsonSnapshot(source, OUTBOX_ARCHIVE_FILE_BYTES);
  const normalized_document_bytes_at_preview = Buffer.byteLength(
    syncJsonSnapshot(restored.document, OUTBOX_ARCHIVE_DOCUMENT_BYTES),
    'utf8',
  );
  const source_statuses = { pending: 0, sending: 0, failed: 0, sent: 0, conflict: 0 };
  const restored_statuses = { pending: 0, sending: 0, failed: 0, sent: 0, conflict: 0 };
  let cleared_lease_tokens = 0;
  for (const record of source.document.records) {
    check();
    source_statuses[record.status as keyof typeof source_statuses] += 1;
    if (record.lease_token !== null) cleared_lease_tokens += 1;
  }
  for (const record of restored.document.records) {
    check();
    restored_statuses[record.status as keyof typeof restored_statuses] += 1;
  }
  check();
  return {
    records: restored.document.records.length,
    source_statuses,
    restored_statuses,
    held_records: restored_statuses.failed,
    historical_terminal_records: {
      sent: restored_statuses.sent,
      conflict: restored_statuses.conflict,
    },
    cleared_lease_tokens,
    normalized_document_bytes_at_preview,
    nonterminal_policy: 'failed-review-required' as const,
    automatic_send: false as const,
  };
}

/** Shares the restore preconditions and v1 mapping, but never reserves or writes anything. */
export function previewOutboxArchiveRestore(
  db: DatabaseSync,
  archive: unknown,
  input: unknown,
  trace: string,
) {
  const query = parseOutboxRestoreQuery(input, trace);
  assertOutboxRestoreTrace(trace);
  const check = outboxRestoreBudget(trace);
  let stage = 'archive';
  let selected_event_id: string | null = null;
  let historical_receipt: OutboxRestoreReceipt | null = null;
  function bounded<T>(result: T): T {
    syncJsonSnapshot(result, 128 * 1024);
    check();
    return result;
  }
  try {
    const source = outboxRestoreSource(archive, query, trace);
    check();
    stage = 'receipt';
    return outboxReadTransaction(
      db,
      () => {
        check();
        const { recorded } = outboxRestoreOriginalReceipt(db, query, trace);
        historical_receipt = recorded;
        check();
        const observed_at = new Date().toISOString();
        const common = {
          scope: query.scope,
          query,
          mode: 'preview' as const,
          observation: 'local-restore-preview' as const,
          observed_at,
          source_document_sha256: source.document_sha256,
          source_observed_at: source.document.observed_at,
          source_export_trace_id: source.document.export_trace_id,
          local_write: 'not-attempted' as const,
          future_execution: 'rechecks-required' as const,
          server_delivery: 'not-checked' as const,
          sender_stopped: 'not-proven' as const,
        };
        // Exact replay is historical: later queue/control changes must not force a new restore.
        if (recorded)
          return bounded({
            ...common,
            action: 'already-restored' as const,
            current_queue: 'not-checked' as const,
            current_control: null,
            historical_receipt: recorded,
            plan: null,
          });
        stage = 'target';
        const control = outboxRestoreTarget(db, source, query, trace, check, (event_id) => {
          selected_event_id = event_id;
        });
        stage = 'prepare';
        const plan = outboxRestorePlan(source, query, observed_at, trace, check);
        stage = 'result';
        return bounded({
          ...common,
          action: 'would-restore' as const,
          current_queue: 'checked-empty' as const,
          current_control: control,
          historical_receipt: null,
          plan,
        });
      },
      trace,
    );
  } catch (error) {
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_PREVIEW_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete restore preview could not be prepared',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          stage,
          selected_event_id:
            selected_event_id ??
            (error instanceof ContractError ? error.envelope.details?.selected_event_id : null) ??
            null,
          historical_receipt,
          mode: 'preview',
          local_write: 'not-attempted',
        },
      },
    );
  }
}
