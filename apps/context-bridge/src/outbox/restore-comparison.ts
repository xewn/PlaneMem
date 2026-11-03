import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  isSyncIdentifier,
  MAX_SYNC_BATCH_BYTES,
  syncJsonSnapshot,
} from '@planemem/contracts';
import type { OutboxScope } from './sqlite.js';
import { checkedOriginalEvent } from './original.js';
import {
  OUTBOX_STORED_COLUMNS,
  parseOutboxReadScope,
  parseOutboxStoredRow,
  outboxReadProjection,
  outboxReadTransaction,
  outboxRecordSummary,
} from './reading.js';
import {
  outboxRestoreBudget,
  outboxRestoreReceiptTable,
  outboxRestoreStoredRecord,
  outboxRestoreRecordV1,
} from './restore.js';

export interface OutboxRestoreComparisonQuery {
  scope: OutboxScope;
  restore_id: string;
  event_id: string;
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
export function parseOutboxRestoreComparisonQuery(
  input: unknown,
  trace: string,
): OutboxRestoreComparisonQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).length !== 3 ||
      Object.keys(row).some((key) => !['scope', 'restore_id', 'event_id'].includes(key)) ||
      !isSyncIdentifier(row.restore_id) ||
      !isSyncIdentifier(row.event_id)
    )
      throw new TypeError();
    return {
      scope: parseOutboxReadScope(row.scope, trace),
      restore_id: row.restore_id,
      event_id: row.event_id,
    };
  } catch (error) {
    throw fail(
      'OUTBOX_RESTORE_COMPARISON_QUERY_INVALID',
      'Supply the exact project scope, restore_id and original event_id',
      trace,
      error instanceof ContractError
        ? { ...error.envelope.details, cause_code: error.envelope.code }
        : {},
    );
  }
}

/** One snapshot compares content with a historical baseline; equality never proves provenance. */
export function compareOutboxRestoreRecord(db: DatabaseSync, input: unknown, trace: string) {
  const query = parseOutboxRestoreComparisonQuery(input, trace);
  const check = outboxRestoreBudget(trace);
  let stage = 'history';
  try {
    const comparison = outboxReadTransaction(
      db,
      () => {
        check();
        const stored = outboxRestoreStoredRecord(
          db,
          query,
          trace,
          outboxRestoreReceiptTable(db, trace),
        );
        check();
        if (!stored)
          throw fail(
            'OUTBOX_RESTORE_HISTORY_NOT_FOUND',
            'No restore history was observed for this project and ID',
            trace,
          );
        stage = 'archived-event';
        const archived = stored.source.document.records.find(
          (record) => record.event_id === query.event_id,
        );
        if (!archived)
          throw fail(
            'OUTBOX_RESTORE_EVENT_NOT_FOUND',
            'The selected event is absent from the verified source archive',
            trace,
          );
        const baseline = outboxRestoreRecordV1(archived);
        const archivedSummary = outboxRecordSummary(
          parseOutboxStoredRow(archived, trace),
          query.scope,
          Date.parse(stored.receipt.source_observed_at),
          trace,
        );
        const baselineSummary = outboxRecordSummary(
          parseOutboxStoredRow(baseline, trace),
          query.scope,
          Date.parse(stored.receipt.restored_at),
          trace,
        );
        check();
        stage = 'current-event';
        const rows = db
          .prepare(
            `SELECT ${outboxReadProjection(true)} FROM main.local_events
             WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY
             AND project_id = ? COLLATE BINARY AND event_id = ? COLLATE BINARY LIMIT 2`,
          )
          .all(
            query.scope.tenant_id,
            query.scope.workspace_id,
            query.scope.project_id,
            query.event_id,
          );
        check();
        if (rows.length > 1)
          throw fail(
            'OUTBOX_RECORD_CORRUPT',
            'The selected current event is ambiguous; preserve the queue',
            trace,
          );
        const row = rows[0];
        const now = Date.now();
        const currentSummary = row ? outboxRecordSummary(row, query.scope, now, trace) : null;
        if (row && currentSummary) {
          if (
            currentSummary.payload_bytes > MAX_SYNC_BATCH_BYTES ||
            currentSummary.source_refs_bytes > MAX_SYNC_BATCH_BYTES
          )
            throw fail(
              'OUTBOX_RECORD_TOO_LARGE',
              'The selected current event exceeds the complete read limit',
              trace,
            );
          const event = checkedOriginalEvent(row, trace);
          if (event.event_id !== query.event_id)
            throw fail(
              'OUTBOX_RECORD_CORRUPT',
              'The selected current event differs from the requested ID',
              trace,
            );
        }
        check();
        stage = 'comparison';
        // Compare the original stored strings, including whitespace and field order in JSON.
        const changed_columns = row
          ? OUTBOX_STORED_COLUMNS.filter((name) => row[name] !== baseline[name])
          : null;
        const result = {
          scope: query.scope,
          query,
          complete: true as const,
          receipt: stored.receipt,
          archived: {
            ...archivedSummary,
            original_content: 'validated' as const,
            observation: 'source-archive' as const,
            observed_at: stored.receipt.source_observed_at,
          },
          restored_baseline: {
            ...baselineSummary,
            original_content: 'validated' as const,
            observation: 'reconstructed-v1-restore' as const,
            observed_at: stored.receipt.restored_at,
          },
          current: currentSummary
            ? {
                ...currentSummary,
                original_content: 'validated' as const,
                observation: 'current-local-record' as const,
                observed_at: new Date(now).toISOString(),
              }
            : null,
          status:
            changed_columns === null
              ? ('current-not-observed' as const)
              : changed_columns.length
                ? ('changed' as const)
                : ('identical-to-restored-baseline' as const),
          compared_columns: [...OUTBOX_STORED_COLUMNS],
          changed_columns,
          comparison: 'exact-stored-column-values' as const,
          consistency: 'single-project-read-snapshot' as const,
          provenance: 'not-proven' as const,
          observed_at: new Date(now).toISOString(),
          archive_integrity: 'verified' as const,
          database_integrity: 'not-audited' as const,
          current_control: 'not-checked' as const,
          server_delivery: 'not-checked' as const,
        };
        stage = 'result';
        try {
          syncJsonSnapshot(result, 128 * 1024);
        } catch {
          throw fail(
            'OUTBOX_RESTORE_COMPARISON_TOO_LARGE',
            'The complete comparison exceeds 128 KiB',
            trace,
          );
        }
        check();
        return result;
      },
      trace,
    );
    check();
    return comparison;
  } catch (error) {
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'OUTBOX_RESTORE_COMPARISON_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete restore comparison could not be read',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        complete: false,
        stage,
        requested_event_id: query.event_id,
      },
    );
  }
}
