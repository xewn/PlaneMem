import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import type { OutboxScope } from './sqlite.js';
import { OUTBOX_ARCHIVE_DOCUMENT_BYTES } from './archive.js';
import { isOutboxSendControlGeneration, outboxStoredSendControl } from './control.js';
import {
  OUTBOX_STORED_COLUMNS,
  outboxReadProjection,
  outboxReadTransaction,
  outboxRecordSummary,
  outboxStoredColumns,
} from './reading.js';
import {
  assertOutboxRestoreTrace,
  outboxRestoreBudget,
  outboxRestoreReceiptTable,
  outboxRestoreStoredRecord,
  outboxRestoreRecordV1,
  parseOutboxRestorePreparation,
} from './restore.js';
import {
  reconciliationTransaction,
  type ReconciliationTransactionState,
} from './reconciliation.js';

export interface OutboxRestoreRequeueQuery {
  scope: OutboxScope;
  restore_id: string;
  archive_sha256: string;
  expected_control_generation: string;
  event_ids: string[];
  reason: string;
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
export function parseOutboxRestoreRequeueQuery(
  input: unknown,
  trace: string,
): OutboxRestoreRequeueQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    const fields = [
      'scope',
      'restore_id',
      'archive_sha256',
      'expected_control_generation',
      'event_ids',
      'reason',
    ];
    if (
      Object.keys(row).length !== fields.length ||
      Object.keys(row).some((key) => !fields.includes(key)) ||
      typeof row.archive_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.archive_sha256) ||
      !isOutboxSendControlGeneration(row.expected_control_generation) ||
      !Array.isArray(row.event_ids) ||
      row.event_ids.length < 1 ||
      row.event_ids.length > 100 ||
      !row.event_ids.every(isSyncIdentifier) ||
      new Set(row.event_ids).size !== row.event_ids.length
    )
      throw new TypeError();
    const original = parseOutboxRestorePreparation(
      { scope: row.scope, restore_id: row.restore_id, reason: row.reason },
      trace,
    );
    return {
      scope: original.scope,
      restore_id: original.restore_id,
      archive_sha256: row.archive_sha256,
      expected_control_generation: row.expected_control_generation,
      event_ids: [...row.event_ids] as string[],
      reason: original.reason,
    };
  } catch {
    throw fail(
      'OUTBOX_RESTORE_REQUEUE_QUERY_INVALID',
      'Supply exact scope, restore_id, archive_sha256, paused generation, 1 to 100 unique event_ids and reason within 16 KiB',
      trace,
    );
  }
}

/** Both paths verify the complete original history and the selected baseline in their own transaction. */
export function requeueOutboxRestoreRecords(
  db: DatabaseSync,
  input: unknown,
  trace: string,
  preview: boolean,
) {
  const query = parseOutboxRestoreRequeueQuery(input, trace);
  assertOutboxRestoreTrace(trace);
  const check = outboxRestoreBudget(trace);
  const transaction: ReconciliationTransactionState = {
    settlement: 'not-committed',
    phase: 'not-started',
    rollback: 'not-needed',
  };
  let stage = 'transaction';
  let selected_event_id: string | null = null;
  let candidate: ReturnType<typeof prepare>['summary'] | null = null;
  const select = () =>
    db.prepare(`SELECT ${outboxReadProjection(true)} FROM main.local_events
    WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY
    AND project_id = ? COLLATE BINARY AND event_id = ? COLLATE BINARY LIMIT 2`);
  const scopeArgs = [query.scope.tenant_id, query.scope.workspace_id, query.scope.project_id];
  function control() {
    check();
    const current = outboxStoredSendControl(db, query.scope, trace);
    if (current.state !== 'paused' || current.generation !== query.expected_control_generation)
      throw fail(
        'OUTBOX_RESTORE_CONTROL_CHANGED',
        'The project must remain paused at the requested generation',
        trace,
        { current_control: current },
      );
    return current;
  }
  function history() {
    check();
    const stored = outboxRestoreStoredRecord(
      db,
      query,
      trace,
      outboxRestoreReceiptTable(db, trace),
    );
    if (!stored)
      throw fail(
        'OUTBOX_RESTORE_HISTORY_NOT_FOUND',
        'The complete original restore history is unavailable',
        trace,
      );
    if (stored.source.document_sha256 !== query.archive_sha256)
      throw fail(
        'OUTBOX_RESTORE_ARCHIVE_MISMATCH',
        'The selected restore history differs from the reviewed archive digest',
        trace,
      );
    check();
    return stored;
  }
  function prepare() {
    stage = 'history';
    const stored = history();
    stage = 'control';
    const current_control = control();
    stage = 'selected-events';
    const originals = new Map(stored.source.document.records.map((row) => [row.event_id, row]));
    const read = select();
    const changes: {
      event_id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[] = [];
    const events: { event_id: string; previous_attempt: number; previous_next_retry_at: string }[] =
      [];
    let checked_bytes = 0;
    const now = Date.now();
    for (const event_id of query.event_ids) {
      selected_event_id = event_id;
      check();
      const original = originals.get(event_id);
      if (!original)
        throw fail(
          'OUTBOX_RESTORE_EVENT_NOT_FOUND',
          'A selected event is absent from the verified original archive',
          trace,
        );
      if (original.status === 'sent' || original.status === 'conflict')
        throw fail(
          'OUTBOX_RESTORE_REQUEUE_TERMINAL',
          'Historical terminal events cannot be requeued through restore review',
          trace,
        );
      const baseline = outboxRestoreRecordV1(original);
      if (
        baseline.server_event_id !== null ||
        baseline.server_cursor !== null ||
        baseline.conflict_id !== null
      )
        throw fail(
          'OUTBOX_RESTORE_REQUEUE_DELIVERY_EVIDENCE',
          'The selected original contains delivery metadata; reconcile it explicitly before proceeding',
          trace,
        );
      const rows = read.all(...scopeArgs, event_id);
      if (rows.length !== 1)
        throw fail(
          'OUTBOX_RESTORE_REQUEUE_EVENT_CHANGED',
          'A selected current event is missing or ambiguous; review the current queue',
          trace,
        );
      const row = rows[0]!;
      outboxRecordSummary(row, query.scope, now, trace);
      const changed_columns = OUTBOX_STORED_COLUMNS.filter((name) => row[name] !== baseline[name]);
      if (changed_columns.length)
        throw fail(
          'OUTBOX_RESTORE_REQUEUE_EVENT_CHANGED',
          'A selected current event no longer matches its complete restored baseline',
          trace,
          { changed_columns },
        );
      checked_bytes += Buffer.byteLength(
        syncJsonSnapshot(outboxStoredColumns(row), OUTBOX_ARCHIVE_DOCUMENT_BYTES),
        'utf8',
      );
      if (checked_bytes > OUTBOX_ARCHIVE_DOCUMENT_BYTES)
        throw fail(
          'OUTBOX_RESTORE_REQUEUE_TOO_LARGE',
          'The complete selected records exceed 32 MiB',
          trace,
        );
      changes.push({
        event_id,
        before: baseline,
        after: {
          ...baseline,
          status: 'pending',
          attempt: 0,
          last_error: null,
          next_retry_at: new Date(0).toISOString(),
        },
      });
      events.push({
        event_id,
        previous_attempt: baseline.attempt as number,
        previous_next_retry_at: baseline.next_retry_at as string,
      });
    }
    selected_event_id = null;
    check();
    const summary = {
      scope: query.scope,
      query,
      restore_receipt: stored.receipt,
      observed_at: new Date(now).toISOString(),
      current_control,
      selected_records: changes.length,
      checked_bytes,
      events,
      assigned_columns: ['status', 'attempt', 'last_error', 'next_retry_at'],
      target_status: 'pending' as const,
      target_attempt: 0,
      target_next_retry_at: new Date(0).toISOString(),
      comparison: 'exact-restored-baseline-columns' as const,
      archive_integrity: 'verified' as const,
      provenance: 'not-proven' as const,
      server_delivery: 'not-checked' as const,
      sender_stopped: 'not-proven' as const,
      automatic_send: false as const,
      control_changed: false as const,
      durable_requeue_receipt: false as const,
    };
    syncJsonSnapshot(summary, 128 * 1024);
    return { summary, changes };
  }
  try {
    const run = () => {
      const prepared = prepare();
      candidate = prepared.summary;
      if (!preview) {
        stage = 'write';
        const read = select();
        const update = db.prepare(`UPDATE main.local_events SET status = 'pending', attempt = 0,
          last_error = NULL, next_retry_at = ? WHERE tenant_id = ? COLLATE BINARY
          AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY
          AND event_id = ? COLLATE BINARY AND status = 'failed' AND lease_token IS NULL`);
        for (const change of prepared.changes) {
          selected_event_id = change.event_id;
          check();
          // Earlier updates may fire triggers; never erase a change to a later selected record.
          const current = read.all(...scopeArgs, change.event_id);
          if (
            current.length !== 1 ||
            current[0]!.metadata_valid !== 1 ||
            OUTBOX_STORED_COLUMNS.some((name) => current[0]![name] !== change.before[name])
          )
            throw fail(
              'OUTBOX_RESTORE_REQUEUE_EVENT_CHANGED',
              'A selected record changed inside the requeue transaction',
              trace,
            );
          if (
            Number(
              update.run(change.after.next_retry_at as string, ...scopeArgs, change.event_id)
                .changes,
            ) !== 1
          )
            throw fail(
              'OUTBOX_RESTORE_REQUEUE_EVENT_CHANGED',
              'A selected restored event could not be requeued',
              trace,
            );
        }
        stage = 'readback';
        for (const change of prepared.changes) {
          selected_event_id = change.event_id;
          check();
          const rows = read.all(...scopeArgs, change.event_id);
          if (
            rows.length !== 1 ||
            rows[0]!.metadata_valid !== 1 ||
            OUTBOX_STORED_COLUMNS.some((name) => rows[0]![name] !== change.after[name])
          )
            throw fail(
              'OUTBOX_RESTORE_REQUEUE_READBACK_FAILED',
              'Complete requeued records could not be confirmed',
              trace,
            );
        }
        selected_event_id = null;
        stage = 'history-readback';
        const afterHistory = history();
        if (!isDeepStrictEqual(afterHistory.receipt, prepared.summary.restore_receipt))
          throw fail(
            'OUTBOX_RESTORE_REQUEUE_HISTORY_CHANGED',
            'The original restore history changed during requeue',
            trace,
          );
        stage = 'control-readback';
        if (!isDeepStrictEqual(control(), prepared.summary.current_control))
          throw fail(
            'OUTBOX_RESTORE_CONTROL_CHANGED',
            'The complete paused control changed during requeue',
            trace,
          );
      }
      stage = 'result';
      const result = {
        ...prepared.summary,
        mode: preview ? ('preview' as const) : ('requeue' as const),
        action: preview ? ('would-requeue' as const) : ('requeued' as const),
        local_commit: preview ? ('not-attempted' as const) : ('committed' as const),
        observation: preview
          ? ('local-restore-requeue-preview' as const)
          : ('committed-local-restore-requeue' as const),
        future_execution: 'rechecks-required' as const,
      };
      syncJsonSnapshot(result, 128 * 1024);
      check();
      return result;
    };
    return preview
      ? outboxReadTransaction(db, run, trace)
      : reconciliationTransaction((sql) => db.exec(sql), run, transaction, trace, check);
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_REQUEUE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete restore requeue outcome could not be confirmed',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        stage,
        selected_event_id,
        candidate,
        mode: preview ? 'preview' : 'requeue',
        local_commit: preview ? 'not-attempted' : transaction.settlement,
        transaction: preview ? null : { phase: transaction.phase, rollback: transaction.rollback },
      },
    );
  }
}
