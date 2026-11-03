import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { ContractError, isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import type { OutboxScope } from './sqlite.js';
import { parseOutboxReadScope, outboxReadTransaction } from './reading.js';
import {
  reconciliationTransaction,
  type ReconciliationTransactionState,
} from './reconciliation.js';

const TABLE = 'local_outbox_send_control';
const FIELDS = [
  'schema_version',
  'tenant_id',
  'workspace_id',
  'project_id',
  'state',
  'generation',
  'reason',
  'changed_at',
  'trace_id',
];
const GENERATION = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function isOutboxSendControlGeneration(value: unknown): value is string {
  return typeof value === 'string' && GENERATION.test(value);
}
const MAX_SENDING = 1000;
export interface OutboxSendControl {
  state: 'running' | 'paused';
  generation: string | null;
  reason: string | null;
  changed_at: string | null;
  trace_id: string | null;
}
export interface OutboxSendControlChange {
  scope: OutboxScope;
  state: OutboxSendControl['state'];
  expected_generation: string | null;
  reason: string;
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function validText(input: unknown): input is string {
  return (
    typeof input === 'string' &&
    !!input.trim() &&
    input.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(input)
  );
}
function canonicalTime(input: unknown): input is string {
  return (
    typeof input === 'string' &&
    Number.isFinite(Date.parse(input)) &&
    new Date(input).toISOString() === input
  );
}
function budget(trace: string) {
  const deadline = performance.now() + 30000;
  return () => {
    if (performance.now() >= deadline)
      throw fail(
        'OUTBOX_SEND_CONTROL_TIMEOUT',
        'The local send-control operation exceeded 30 seconds',
        trace,
      );
  };
}
export function parseOutboxSendControlChange(
  input: unknown,
  trace: string,
): OutboxSendControlChange {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    const fields = ['scope', 'state', 'expected_generation', 'reason'];
    if (
      Object.keys(row).length !== fields.length ||
      Object.keys(row).some((key) => !fields.includes(key)) ||
      (row.state !== 'paused' && row.state !== 'running') ||
      !validText(row.reason) ||
      (row.expected_generation !== null && !isOutboxSendControlGeneration(row.expected_generation))
    )
      throw new TypeError();
    return {
      scope: parseOutboxReadScope(row.scope, trace),
      state: row.state,
      expected_generation: row.expected_generation,
      reason: row.reason,
    };
  } catch {
    throw fail(
      'OUTBOX_SEND_CONTROL_INPUT_INVALID',
      'Supply scope, paused/running state, explicit expected_generation (null or the observed UUID) and a reason of 1–1024 characters',
      trace,
    );
  }
}

/** Optional extension: ordinary construction, reads and claims never create it. Caller holds a transaction. */
function controlTable(db: DatabaseSync, trace: string): boolean {
  const entries = db
    .prepare('SELECT type FROM main.sqlite_schema WHERE name = ? COLLATE NOCASE')
    .all(TABLE);
  if (!entries.length) return false;
  if (entries.length !== 1 || entries[0]!.type !== 'table')
    throw fail(
      'OUTBOX_SEND_CONTROL_CORRUPT',
      'The send-control storage name is not a unique table',
      trace,
    );
  const columns = new Set(
    db
      .prepare('PRAGMA main.table_info(local_outbox_send_control)')
      .all()
      .map((row) => row.name),
  );
  if (FIELDS.some((name) => !columns.has(name)))
    throw fail(
      'OUTBOX_SEND_CONTROL_CORRUPT',
      'The send-control table lacks required columns; preserve the queue',
      trace,
    );
  return true;
}
function currentControl(
  db: DatabaseSync,
  scope: OutboxScope,
  trace: string,
  present: boolean,
): OutboxSendControl {
  if (!present)
    return { state: 'running', generation: null, reason: null, changed_at: null, trace_id: null };
  // Oversized fields never cross the SQLite/JavaScript boundary.
  const rows = db
    .prepare(
      `SELECT CASE WHEN typeof(schema_version) = 'integer' AND schema_version = 1 THEN 1 ELSE NULL END AS schema_version,
    CASE WHEN typeof(state) = 'text' AND length(CAST(state AS BLOB)) <= 16 THEN state ELSE NULL END AS state,
    CASE WHEN typeof(generation) = 'text' AND length(CAST(generation AS BLOB)) <= 36 THEN generation ELSE NULL END AS generation,
    CASE WHEN typeof(reason) = 'text' AND length(CAST(reason AS BLOB)) <= 4096 THEN reason ELSE NULL END AS reason,
    CASE WHEN typeof(changed_at) = 'text' AND length(CAST(changed_at AS BLOB)) <= 64 THEN changed_at ELSE NULL END AS changed_at,
    CASE WHEN typeof(trace_id) = 'text' AND length(CAST(trace_id AS BLOB)) <= 4096 THEN trace_id ELSE NULL END AS trace_id
    FROM main.local_outbox_send_control
    WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY LIMIT 2`,
    )
    .all(scope.tenant_id, scope.workspace_id, scope.project_id);
  if (!rows.length)
    return { state: 'running', generation: null, reason: null, changed_at: null, trace_id: null };
  const row = rows[0]!;
  if (
    rows.length !== 1 ||
    row.schema_version !== 1 ||
    (row.state !== 'paused' && row.state !== 'running') ||
    !isOutboxSendControlGeneration(row.generation) ||
    !validText(row.reason) ||
    !canonicalTime(row.changed_at) ||
    !validText(row.trace_id)
  )
    throw fail(
      'OUTBOX_SEND_CONTROL_CORRUPT',
      'The project send-control record is invalid or ambiguous; preserve the queue',
      trace,
      { scope },
    );
  return {
    state: row.state,
    generation: row.generation,
    reason: row.reason,
    changed_at: row.changed_at,
    trace_id: row.trace_id,
  };
}

/** Internal read for callers that already own the current SQLite transaction. */
export function outboxStoredSendControl(db: DatabaseSync, scope: OutboxScope, trace: string) {
  return currentControl(db, scope, trace, controlTable(db, trace));
}

/** One claim transaction sees one gate state. Previously claimed work may still publish and settle. */
export function outboxClaimGuard(db: DatabaseSync, trace: string) {
  const present = controlTable(db, trace);
  const checked = new Set<string>();
  return {
    filter: present
      ? `AND NOT EXISTS (SELECT 1 FROM main.local_outbox_send_control AS control
      WHERE control.tenant_id = local_events.tenant_id COLLATE BINARY
        AND control.workspace_id = local_events.workspace_id COLLATE BINARY
        AND control.project_id = local_events.project_id COLLATE BINARY AND control.state = 'paused')`
      : '',
    assertEnabled(input: unknown) {
      if (!present) return;
      const scope = parseOutboxReadScope(input, trace);
      const key = JSON.stringify(scope);
      if (checked.has(key)) return;
      const control = currentControl(db, scope, trace, true);
      if (control.state === 'paused')
        throw fail(
          'OUTBOX_SEND_PAUSED',
          'New claims are paused for this project; inspect send-control before explicitly resuming',
          trace,
          { scope, control },
        );
      checked.add(key);
    },
  };
}

function inFlight(db: DatabaseSync, scope: OutboxScope, now: number) {
  const rows = db
    .prepare(
      `SELECT
    CASE WHEN typeof(event_id) = 'text' AND length(CAST(event_id AS BLOB)) <= 1020 THEN event_id ELSE NULL END AS event_id,
    CASE WHEN typeof(next_retry_at) = 'text' AND length(CAST(next_retry_at AS BLOB)) <= 64 THEN next_retry_at ELSE NULL END AS next_retry_at,
    CASE WHEN lease_token IS NULL THEN 1 WHEN typeof(lease_token) = 'text' AND length(CAST(lease_token AS BLOB)) <= 1020 THEN 1 ELSE 0 END AS lease_valid,
    CASE WHEN typeof(lease_token) = 'text' AND length(CAST(lease_token AS BLOB)) <= 1020 THEN lease_token ELSE NULL END AS lease_token
    FROM local_events WHERE tenant_id = ? AND workspace_id = ? AND project_id = ? AND status = 'sending' LIMIT ?`,
    )
    .all(scope.tenant_id, scope.workspace_id, scope.project_id, MAX_SENDING + 1);
  const unknown = {
    sending_records: null,
    active_leases: null,
    expired_leases: null,
    without_lease: null,
    limit: MAX_SENDING,
  };
  if (rows.length > MAX_SENDING) return { state: 'limit-exceeded' as const, ...unknown };
  const ids = new Set<string>();
  let active_leases = 0;
  let expired_leases = 0;
  let without_lease = 0;
  for (const row of rows) {
    if (
      !isSyncIdentifier(row.event_id) ||
      ids.has(row.event_id) ||
      !canonicalTime(row.next_retry_at) ||
      row.lease_valid !== 1 ||
      (row.lease_token !== null && !isSyncIdentifier(row.lease_token))
    )
      return { state: 'invalid-metadata' as const, ...unknown };
    ids.add(row.event_id);
    if (row.lease_token === null) without_lease += 1;
    else if (Date.parse(row.next_retry_at) > now) active_leases += 1;
    else expired_leases += 1;
  }
  return {
    state: 'complete' as const,
    sending_records: rows.length,
    active_leases,
    expired_leases,
    without_lease,
    limit: MAX_SENDING,
  };
}

export function readOutboxSendControl(db: DatabaseSync, input: unknown, trace: string) {
  const scope = parseOutboxReadScope(input, trace);
  const check = budget(trace);
  return outboxReadTransaction(
    db,
    () => {
      check();
      const present = controlTable(db, trace);
      const control = currentControl(db, scope, trace, present);
      const now = Date.now();
      const in_flight = inFlight(db, scope, now);
      check();
      return {
        scope,
        control,
        storage: present ? ('available' as const) : ('not-configured' as const),
        in_flight,
        observed_at: new Date(now).toISOString(),
        coordination: 'cooperating-claimers-only' as const,
        sender_stopped: 'not-proven' as const,
        server_delivery: 'not-checked' as const,
        original_content: 'not-validated' as const,
        database_integrity: 'not-audited' as const,
      };
    },
    trace,
  );
}

export function changeOutboxSendControl(db: DatabaseSync, input: unknown, trace: string) {
  const query = parseOutboxSendControlChange(input, trace);
  if (!validText(trace))
    throw fail(
      'OUTBOX_SEND_CONTROL_INPUT_INVALID',
      'Supply a valid trace for the persisted change',
      'trace_outbox_send_control',
    );
  const check = budget(trace);
  const transaction: ReconciliationTransactionState = {
    settlement: 'not-committed',
    phase: 'not-started',
    rollback: 'not-needed',
  };
  let proposed: OutboxSendControl | null = null;
  try {
    check();
    return reconciliationTransaction(
      (sql) => db.exec(sql),
      () => {
        check();
        const present = controlTable(db, trace);
        const current = currentControl(db, query.scope, trace, present);
        if (current.generation !== query.expected_generation)
          throw fail(
            'OUTBOX_SEND_CONTROL_CHANGED',
            'Send control changed; reread it before preparing another operation',
            trace,
            { current },
          );
        if (current.state === query.state)
          throw fail(
            'OUTBOX_SEND_CONTROL_STATE_CONFLICT',
            'The project is already in the requested state; no change was applied',
            trace,
            { current },
          );
        if (!present)
          db.exec(`CREATE TABLE main.local_outbox_send_control (
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('running', 'paused')), generation TEXT NOT NULL,
        reason TEXT NOT NULL, changed_at TEXT NOT NULL, trace_id TEXT NOT NULL,
        PRIMARY KEY (tenant_id, workspace_id, project_id)
      )`);
        proposed = {
          state: query.state,
          generation: randomUUID(),
          reason: query.reason,
          changed_at: new Date().toISOString(),
          trace_id: trace,
        };
        const scopeArgs = [query.scope.tenant_id, query.scope.workspace_id, query.scope.project_id];
        const values = [
          proposed.state,
          proposed.generation,
          proposed.reason,
          proposed.changed_at,
          trace,
        ];
        const change =
          current.generation === null
            ? db
                .prepare(
                  `INSERT INTO main.local_outbox_send_control (schema_version,tenant_id,workspace_id,project_id,state,generation,reason,changed_at,trace_id) VALUES (1,?,?,?,?,?,?,?,?)`,
                )
                .run(...scopeArgs, ...values)
            : db
                .prepare(
                  `UPDATE main.local_outbox_send_control SET state = ?, generation = ?, reason = ?, changed_at = ?, trace_id = ?
            WHERE tenant_id = ? COLLATE BINARY AND workspace_id = ? COLLATE BINARY AND project_id = ? COLLATE BINARY AND generation = ? COLLATE BINARY`,
                )
                .run(...values, ...scopeArgs, current.generation);
        if (
          Number(change.changes) !== 1 ||
          JSON.stringify(currentControl(db, query.scope, trace, true)) !== JSON.stringify(proposed)
        )
          throw fail(
            'OUTBOX_SEND_CONTROL_WRITE_FAILED',
            'The send-control change could not be read back exactly',
            trace,
          );
        check();
        return {
          scope: query.scope,
          control: proposed,
          previous_generation: current.generation,
          local_commit: 'committed' as const,
          in_flight: 'not-inspected' as const,
          coordination: 'cooperating-claimers-only' as const,
          sender_stopped: 'not-proven' as const,
          server_delivery: 'not-checked' as const,
        };
      },
      transaction,
      trace,
      check,
    );
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_SEND_CONTROL_UNAVAILABLE',
      transaction.settlement === 'unknown'
        ? 'The control change could not be confirmed; preserve the proposed generation and reread send-control before continuing'
        : error instanceof ContractError
          ? error.envelope.message
          : 'The local send-control operation failed',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        proposed,
        local_commit: transaction.settlement,
        transaction: { phase: transaction.phase, rollback: transaction.rollback },
      },
    );
  }
}
