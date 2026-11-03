import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  isUlid,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type SyncCommandIdentity,
  type SyncInboxAcknowledgement,
  type SyncInboxAcknowledgementDispatch,
  type SyncInboxAcknowledgementRecovery,
} from '@planemem/contracts';

export interface SyncInboxAckAuditQuery {
  expected_identity: SyncCommandIdentity;
  max_entries: number;
}
export function parseInboxAckAuditQuery(value: unknown, trace: string): SyncInboxAckAuditQuery {
  try {
    const snapshot: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError();
    const input = snapshot as Record<string, unknown>;
    if (Object.keys(input).some((key) => key !== 'expected_identity' && key !== 'max_entries'))
      throw new TypeError();
    const max_entries = input.max_entries === undefined ? 1000 : input.max_entries;
    if (typeof max_entries !== 'number' || !Number.isSafeInteger(max_entries) || max_entries < 1)
      throw new TypeError();
    return { expected_identity: parseSyncCommandIdentity(input.expected_identity), max_entries };
  } catch {
    throw new ContractError(
      'INBOX_ACK_AUDIT_QUERY_INVALID',
      'Supply the complete original identity and optional positive safe-integer max_entries',
      {
        trace_id: trace,
        retryable: false,
        audit_completed: false,
        acknowledgement_dispatch_state: 'not-sent',
      },
    );
  }
}
const sources = {
  records: { table: 'sync_inbox_acknowledgements', id: 'record_id', order: 'attempt_sequence' },
  dispatches: { table: 'sync_inbox_ack_dispatches', id: 'dispatch_id', order: 'dispatch_sequence' },
  recoveries: { table: 'sync_inbox_ack_recoveries', id: 'record_id', order: 'record_id' },
} as const;
type Kind = keyof typeof sources;
function count(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new TypeError();
  return BigInt(value);
}

/** All metadata batches and complete reads must share the owner's read transaction. */
export function auditInboxAcknowledgements(
  db: DatabaseSync,
  key: string,
  query: SyncInboxAckAuditQuery,
  extensions: { dispatch: boolean; recovery: boolean },
  trace: string,
  reads: {
    record(id: string): SyncInboxAcknowledgement | null;
    dispatch(id: string): SyncInboxAcknowledgementDispatch | null;
    recovery(recordId: string): SyncInboxAcknowledgementRecovery | null;
  },
) {
  const checked = { records: 0, dispatches: 0, recoveries: 0 };
  const fail = (code: string, message: string, details: Record<string, unknown>) =>
    new ContractError(code, message, {
      trace_id: trace,
      retryable: false,
      details: {
        audit_scope: 'consumer-acknowledgement-journals',
        audit_completed: false,
        checked: { ...checked },
        max_entries: query.max_entries,
        ...details,
        acknowledgement_dispatch_state: 'not-sent',
      },
    });
  const corrupt = (reason: string, details: Record<string, unknown> = {}) =>
    fail(
      'INBOX_ACK_AUDIT_CORRUPT',
      'The selected acknowledgement history is inconsistent; preserve the inbox',
      { reason, ...details },
    );
  function checkedRead<T>(kind: Kind, id: string, operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (
        error instanceof ContractError &&
        [
          'INBOX_ACK_CORRUPT',
          'INBOX_ACK_DISPATCH_CORRUPT',
          'INBOX_ACK_RECOVERY_CORRUPT',
          'INBOX_CORRUPT',
          'INBOX_NOT_FOUND',
        ].includes(error.envelope.code)
      )
        throw corrupt('invalid-record-or-reference', { kind, id, cause_code: error.envelope.code });
      throw error;
    }
  }
  const counts = { records: 0n, dispatches: 0n, recoveries: 0n };
  const kinds: Kind[] = [
    'records',
    ...(extensions.dispatch ? ['dispatches' as const] : []),
    ...(extensions.recovery ? ['recoveries' as const] : []),
  ];
  for (const kind of kinds) {
    // Table and column names are constants above, never query input.
    const row = db
      .prepare(
        `SELECT CAST(COUNT(*) AS TEXT) AS total FROM ${sources[kind].table} WHERE consumer_key = ?`,
      )
      .get(key);
    try {
      counts[kind] = count(row?.total);
    } catch {
      throw corrupt('invalid-row-count', { kind });
    }
  }
  const total = counts.records + counts.dispatches + counts.recoveries;
  if (total > BigInt(query.max_entries))
    throw fail(
      'INBOX_ACK_AUDIT_LIMIT_REACHED',
      'The complete selected journals exceed max_entries; no partial audit is reported as complete',
      {
        required_entries: total.toString(),
        counts: {
          records: counts.records.toString(),
          dispatches: counts.dispatches.toString(),
          recoveries: counts.recoveries.toString(),
        },
      },
    );
  if (
    extensions.dispatch &&
    db
      .prepare(
        `SELECT 1 FROM sync_inbox_ack_dispatches d
      LEFT JOIN sync_inbox_acknowledgements a ON a.record_id = d.record_id
      WHERE (d.consumer_key = ? OR a.consumer_key = ?)
        AND (a.record_id IS NULL OR d.consumer_key IS NOT a.consumer_key) LIMIT 1`,
      )
      .get(key, key)
  )
    throw corrupt('dispatch-consumer-reference-mismatch');
  if (extensions.recovery) {
    if (
      db
        .prepare(
          `SELECT 1 FROM sync_inbox_ack_recoveries r
        LEFT JOIN sync_inbox_acknowledgements a ON a.record_id = r.record_id
        LEFT JOIN sync_inbox_ack_dispatches d ON d.dispatch_id = r.first_dispatch_id
        WHERE (r.consumer_key = ? OR a.consumer_key = ? OR d.consumer_key = ?)
          AND (a.record_id IS NULL OR d.dispatch_id IS NULL OR r.consumer_key IS NOT a.consumer_key
            OR r.consumer_key IS NOT d.consumer_key OR r.record_id IS NOT d.record_id) LIMIT 1`,
        )
        .get(key, key, key)
    )
      throw corrupt('recovery-consumer-reference-mismatch');
    const unique = db
      .prepare(
        'SELECT CAST(COUNT(DISTINCT recovery_id) AS TEXT) AS total FROM sync_inbox_ack_recoveries WHERE consumer_key = ?',
      )
      .get(key);
    try {
      if (count(unique?.total) !== counts.recoveries) throw new TypeError();
    } catch {
      throw corrupt('duplicate-or-missing-recovery-id');
    }
  }
  function walk(kind: Kind, visit: (id: string, sequence: number) => void) {
    const source = sources[kind];
    const ordered = kind !== 'recoveries';
    let after: string | number = ordered ? 0 : '';
    const statement = db.prepare(`SELECT
      CASE WHEN length(${source.id}) = 26 THEN ${source.id} ELSE NULL END AS id,
      ${ordered ? `CASE WHEN typeof(${source.order}) = 'integer' THEN CAST(${source.order} AS TEXT) ELSE NULL END` : 'NULL'} AS sequence
      FROM ${source.table} WHERE consumer_key = ? AND ${source.order} > ?
      ORDER BY ${source.order} ASC LIMIT 100`);
    while (BigInt(checked[kind]) < counts[kind]) {
      const rows = statement.all(key, after);
      if (!rows.length) throw corrupt('incomplete-row-coverage', { kind });
      for (const row of rows) {
        if (!isUlid(row.id) || BigInt(checked[kind]) >= counts[kind])
          throw corrupt('invalid-id-or-row-count', { kind });
        const sequence = checked[kind] + 1;
        if (ordered) {
          if (typeof row.sequence !== 'string' || row.sequence !== String(sequence))
            throw corrupt('non-contiguous-sequence', {
              kind,
              id: row.id,
              expected_sequence: sequence,
            });
        } else if (typeof after !== 'string' || row.id <= after)
          throw corrupt('non-increasing-recovery-selection', { kind, id: row.id });
        visit(row.id, sequence);
        checked[kind] += 1;
        after = ordered ? sequence : row.id;
      }
    }
  }
  const record_states = { unconfirmed: 0, confirmed: 0, observed: 0 };
  const dispatch_states = { active: 0, unknown: 0, expired: 0, confirmed: 0 };
  let lastCursor = 0;
  walk('records', (id, sequence) => {
    const record = checkedRead('records', id, () => reads.record(id));
    if (
      !record ||
      record.record_id !== id ||
      record.attempt_sequence !== sequence ||
      record.command.cursor < lastCursor
    )
      throw corrupt('original-order-or-cursor-mismatch', { kind: 'records', id });
    if (record.state === 'unconfirmed' && BigInt(sequence) !== counts.records)
      throw corrupt('pending-original-is-not-latest', { kind: 'records', id });
    record_states[record.state] += 1;
    lastCursor = record.command.cursor;
  });
  if (record_states.unconfirmed > 1) throw corrupt('multiple-pending-originals');
  if (extensions.dispatch)
    walk('dispatches', (id, sequence) => {
      const dispatch = checkedRead('dispatches', id, () => reads.dispatch(id));
      if (!dispatch || dispatch.dispatch_id !== id || dispatch.dispatch_sequence !== sequence)
        throw corrupt('dispatch-order-mismatch', { kind: 'dispatches', id });
      if (dispatch.state === 'active' && BigInt(sequence) !== counts.dispatches)
        throw corrupt('active-dispatch-is-not-latest', { kind: 'dispatches', id });
      dispatch_states[dispatch.state] += 1;
    });
  if (dispatch_states.active > 1) throw corrupt('multiple-active-dispatches');
  if (extensions.recovery)
    walk('recoveries', (id) => {
      const recovery = checkedRead('recoveries', id, () => reads.recovery(id));
      if (!recovery || recovery.record_id !== id)
        throw corrupt('recovery-binding-mismatch', { kind: 'recoveries', id });
    });
  return {
    status: 'complete' as const,
    audit_completed: true as const,
    audit_scope: 'consumer-acknowledgement-journals' as const,
    consistency: 'single-read-transaction' as const,
    expected_identity: query.expected_identity,
    extensions: {
      acknowledgement: 1 as const,
      dispatch: extensions.dispatch ? 1 : null,
      recovery: extensions.recovery ? 1 : null,
    },
    checked,
    record_states,
    dispatch_states: extensions.dispatch ? dispatch_states : null,
    max_entries: query.max_entries,
    page_chain_audit: 'not-performed' as const,
    database_integrity: 'not-audited' as const,
    event_application: 'not-verified' as const,
    acknowledgement_dispatch_state: 'not-sent' as const,
  };
}
