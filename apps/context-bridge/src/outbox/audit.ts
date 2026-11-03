import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  MAX_SYNC_BATCH_BYTES,
  syncJsonSnapshot,
  isSyncIdentifier,
} from '@planemem/contracts';
import type { LocalEvent, OutboxScope } from './sqlite.js';
import {
  parseOutboxReadScope,
  outboxReadProjection,
  outboxRecordSummary,
  outboxReadTransaction,
} from './reading.js';

export interface OutboxAuditQuery {
  scope: OutboxScope;
  max_events: number;
  max_bytes: number;
  timeout_ms: number;
}
function fail(code: string, message: string, trace: string) {
  return new ContractError(code, message, { trace_id: trace, retryable: false });
}
export function parseOutboxAuditQuery(input: unknown, trace: string): OutboxAuditQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).some(
        (key) => !['scope', 'max_events', 'max_bytes', 'timeout_ms'].includes(key),
      )
    )
      throw new TypeError();
    const limit = (value: unknown, fallback: number, maximum: number) => {
      const supplied = value === undefined ? fallback : value;
      if (
        typeof supplied !== 'number' ||
        !Number.isSafeInteger(supplied) ||
        supplied < 1 ||
        supplied > maximum
      )
        throw new TypeError();
      return supplied;
    };
    return {
      scope: parseOutboxReadScope(row.scope, trace),
      max_events: limit(row.max_events, 1000, 10000),
      max_bytes: limit(row.max_bytes, 64 * 1024 * 1024, 512 * 1024 * 1024),
      timeout_ms: limit(row.timeout_ms, 30000, 90000),
    };
  } catch {
    throw fail(
      'OUTBOX_AUDIT_QUERY_INVALID',
      'Supply the original scope and optional max_events (1–10000), max_bytes (1–536870912) and timeout_ms (1–90000)',
      trace,
    );
  }
}

/** One selected-project snapshot. No partial success, remote check, sender claim or schema write. */
export function auditOutboxRecords(
  db: DatabaseSync,
  query: OutboxAuditQuery,
  trace: string,
  decode: (row: Record<string, unknown>, trace: string) => LocalEvent,
  collect?: (row: Record<string, unknown>) => void,
) {
  const deadline = performance.now() + query.timeout_ms;
  const observed = Date.now();
  let stage: 'count' | 'records' | 'read-commit' = 'count';
  let checked_events = 0;
  let checked_bytes = 0;
  let selected_event_id: string | null = null;
  const check = () => {
    if (performance.now() >= deadline)
      throw fail(
        'OUTBOX_AUDIT_TIMEOUT',
        'The complete queue audit exceeded its local deadline',
        trace,
      );
  };
  const budget = () =>
    fail(
      'OUTBOX_AUDIT_LIMIT_EXCEEDED',
      'The full selected queue exceeds the audit budget; no complete result is available',
      trace,
    );
  try {
    const result = outboxReadTransaction(
      db,
      () => {
        check();
        const scope = [query.scope.tenant_id, query.scope.workspace_id, query.scope.project_id];
        const count = db
          .prepare(
            `SELECT COUNT(*) AS total FROM (
        SELECT 1 FROM local_events WHERE tenant_id = ? AND workspace_id = ? AND project_id = ? LIMIT ?
      )`,
          )
          .get(...scope, query.max_events + 1)?.total;
        check();
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
          throw fail('OUTBOX_RECORD_CORRUPT', 'The selected queue count is invalid', trace);
        if (count > query.max_events) throw budget();
        stage = 'records';
        const ids = new Set<string>();
        const keys = new Set<string>();
        const statuses = { pending: 0, sending: 0, sent: 0, failed: 0, conflict: 0 };
        const send_leases = { active: 0, expired: 0, none: 0 };
        let legacy_payload_checksums = 0;
        let after: string | undefined;
        while (true) {
          check();
          selected_event_id = null;
          const rows = db
            .prepare(
              `SELECT ${outboxReadProjection(true)} FROM local_events
          WHERE tenant_id = ? AND workspace_id = ? AND project_id = ?
          ${after === undefined ? '' : 'AND local_events.event_id COLLATE BINARY > ?'}
          ORDER BY local_events.event_id COLLATE BINARY ASC LIMIT ?
        `,
            )
            .all(
              ...scope,
              ...(after === undefined ? [] : [after]),
              Math.min(20, count - checked_events + 1),
            );
          check();
          if (!rows.length) break;
          for (const row of rows) {
            check();
            selected_event_id = isSyncIdentifier(row.event_id) ? row.event_id : null;
            const summary = outboxRecordSummary(row, query.scope, observed, trace);
            selected_event_id = summary.event_id;
            if (checked_events >= count || ids.has(summary.event_id))
              throw fail(
                'OUTBOX_RECORD_CORRUPT',
                'The queue contains duplicate event IDs or inconsistent membership',
                trace,
              );
            if (
              summary.payload_bytes > MAX_SYNC_BATCH_BYTES ||
              summary.source_refs_bytes > MAX_SYNC_BATCH_BYTES
            )
              throw fail(
                'OUTBOX_RECORD_TOO_LARGE',
                'A complete original exceeds its per-record read limit',
                trace,
              );
            // All original text columns are included by the full projection, with no extra text aliases.
            const bytes = Object.values(row).reduce<number>(
              (total, value) =>
                total + (typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0),
              0,
            );
            if (!Number.isSafeInteger(bytes) || checked_bytes + bytes > query.max_bytes)
              throw budget();
            const event = decode(row, trace);
            check();
            if (event.event_id !== summary.event_id || keys.has(event.idempotency_key))
              throw fail(
                'OUTBOX_RECORD_CORRUPT',
                'The selected queue contains ambiguous original IDs or idempotency keys',
                trace,
              );
            collect?.(row);
            check();
            ids.add(event.event_id);
            keys.add(event.idempotency_key);
            statuses[summary.status] += 1;
            send_leases[summary.send_lease] += 1;
            if (event.checksum.length === 15) legacy_payload_checksums += 1;
            checked_bytes += bytes;
            checked_events += 1;
            after = event.event_id;
          }
        }
        if (checked_events !== count)
          throw fail(
            'OUTBOX_RECORD_CORRUPT',
            'The audit could not cover every selected queue row',
            trace,
          );
        check();
        stage = 'read-commit';
        selected_event_id = null;
        const data = {
          query,
          scope: query.scope,
          status: 'complete' as const,
          checked_events,
          checked_bytes,
          byte_basis: 'stored-text-columns-utf8' as const,
          statuses,
          send_leases,
          legacy_payload_checksums,
          observed_at: new Date(observed).toISOString(),
          consistency: 'single-project-read-snapshot' as const,
          original_content: 'validated' as const,
          server_delivery: 'not-checked' as const,
          database_integrity: 'not-audited' as const,
        };
        syncJsonSnapshot(data, 16384);
        check();
        return data;
      },
      trace,
    );
    check();
    return result;
  } catch (error) {
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete selected queue could not be audited',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          complete: false,
          stage,
          checked_events,
          checked_bytes,
          selected_event_id,
        },
      },
    );
  }
}
