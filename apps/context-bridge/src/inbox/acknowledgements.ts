import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  ContractError,
  createUlid,
  isUlid,
  parseSyncCommandIdentity,
  parseSyncAcknowledgement,
  parseSyncAcknowledgementEnvelope,
  parseSyncCursorEnvelope,
  parseSyncAckEvidenceDocument,
  parseSyncInboxAcknowledgementRecovery,
  syncJsonSnapshot,
  SYNC_CURSOR_RESPONSE_BYTES,
  type SyncCommandIdentity,
  type SyncSavedPageFile,
  type SyncCursorEnvelope,
  type SyncInboxAcknowledgement,
  type SyncInboxAcknowledgementDispatch,
  type SyncInboxAcknowledgementRecovery,
} from '@planemem/contracts';
export type {
  SyncInboxAcknowledgement,
  SyncInboxAcknowledgementDispatch,
  SyncInboxAcknowledgementRecovery,
} from '@planemem/contracts';
import { SYNC_INBOX_ACK_SCHEMA_V1 } from './ack-schema.js';
import { SYNC_INBOX_ACK_DISPATCH_SCHEMA_V1 } from './ack-dispatch-schema.js';
import { SYNC_INBOX_ACK_RECOVERY_SCHEMA_V1 } from './ack-recovery-schema.js';
import { auditInboxAcknowledgements, parseInboxAckAuditQuery } from './ack-audit.js';
import {
  parseInboxAckHistoryQuery,
  parseInboxAckDetailQuery,
  SYNC_INBOX_ACK_HISTORY_BYTES,
} from './ack-history-query.js';

export interface SyncInboxAcknowledgementSummary {
  record_id: string;
  attempt_sequence: number;
  document_sha256: string;
  request_trace_id: string;
  cursor: number;
  state: SyncInboxAcknowledgement['state'];
  has_response: boolean;
  has_observation: boolean;
}
type DispatchSelection =
  | { mode: 'initial' }
  | { mode: 'retry'; dispatch_id: string }
  | { mode: 'recover'; record_id: string };
export interface SyncInboxAcknowledgementDispatchSummary {
  dispatch_id: string;
  record_id: string;
  dispatch_sequence: number;
  invocation_trace_id: string;
  started_at_ms: number;
  lease_until_ms: number;
  state: SyncInboxAcknowledgementDispatch['state'];
  has_response: boolean;
}

type Transaction = <T>(run: () => T, trace: string, write: boolean) => T;
type ReadPage = (identity: SyncCommandIdentity, digest: string, trace: string) => SyncSavedPageFile;
const fail = (code: string, message: string, trace: string) =>
  new ContractError(code, message, { trace_id: trace, retryable: false });
function identityFor(value: unknown, trace: string) {
  try {
    const identity = parseSyncCommandIdentity(value);
    return { identity, key: createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
  } catch {
    throw fail('INBOX_IDENTITY_INVALID', 'Supply the complete original consumer identity', trace);
  }
}
function integer(value: unknown, minimum = 0) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new TypeError();
  return result;
}
function traceText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError();
  return value;
}
/** Only local durable intent/evidence. The caller invokes a trusted transport outside transactions. */
export class InboxAcknowledgements {
  constructor(
    private readonly db: DatabaseSync,
    private readonly transaction: Transaction,
    private readonly readPage: ReadPage,
  ) {}
  private require(trace: string) {
    try {
      if (
        this.db.prepare('SELECT version FROM sync_inbox_ack_schema WHERE singleton = 1').get()
          ?.version !== 1
      )
        throw new TypeError();
      const columns = new Set(
        this.db
          .prepare('PRAGMA table_info(sync_inbox_acknowledgements)')
          .all()
          .map((row) => row.name),
      );
      if (
        [
          'consumer_key',
          'attempt_sequence',
          'record_id',
          'document_sha256',
          'cursor',
          'request_trace_id',
          'state',
          'response_json',
          'observation_json',
        ].some((name) => !columns.has(name))
      )
        throw new TypeError();
    } catch {
      throw fail(
        'INBOX_ACK_SCHEMA_REQUIRED',
        'Explicitly enable the acknowledgement journal before using it; existing files are not upgraded automatically',
        trace,
      );
    }
  }
  enable(trace: string) {
    return this.transaction(
      () => {
        const present = this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('sync_inbox_ack_schema','sync_inbox_acknowledgements')",
          )
          .all();
        if (present.length) {
          this.require(trace);
          return { status: 'already-enabled' as const, version: 1 as const };
        }
        this.db.exec(SYNC_INBOX_ACK_SCHEMA_V1);
        this.require(trace);
        return { status: 'enabled' as const, version: 1 as const };
      },
      trace,
      true,
    );
  }
  private read(
    identity: SyncCommandIdentity,
    trace: string,
    recordId?: string,
  ): SyncInboxAcknowledgement | null {
    const original = identityFor(identity, trace);
    const row = this.db
      .prepare(
        `SELECT CASE WHEN length(record_id) = 26 THEN record_id ELSE NULL END AS record_id,
      CASE WHEN length(document_sha256) = 64 THEN document_sha256 ELSE NULL END AS document_sha256,
      CASE WHEN state IN ('unconfirmed', 'confirmed', 'observed') THEN state ELSE NULL END AS state,
      CASE WHEN typeof(attempt_sequence) = 'integer' THEN CAST(attempt_sequence AS TEXT) ELSE NULL END AS attempt_sequence,
      CASE WHEN typeof(cursor) = 'integer' THEN CAST(cursor AS TEXT) ELSE NULL END AS cursor,
      CASE WHEN length(CAST(request_trace_id AS BLOB)) <= 4096 THEN request_trace_id ELSE NULL END AS request_trace_id,
      CASE WHEN response_json IS NULL OR length(CAST(response_json AS BLOB)) <= 32768 THEN response_json ELSE '' END AS response_json,
      CASE WHEN observation_json IS NULL OR length(CAST(observation_json AS BLOB)) <= 32768 THEN observation_json ELSE '' END AS observation_json
      FROM sync_inbox_acknowledgements WHERE consumer_key = ? ${recordId === undefined ? '' : 'AND record_id = ?'}
      ORDER BY attempt_sequence DESC LIMIT 1`,
      )
      .get(...(recordId === undefined ? [original.key] : [original.key, recordId]));
    if (!row) return null;
    let record: SyncInboxAcknowledgement;
    try {
      if (
        !isUlid(row.record_id) ||
        typeof row.document_sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(row.document_sha256) ||
        typeof row.state !== 'string' ||
        !['unconfirmed', 'confirmed', 'observed'].includes(row.state) ||
        (row.response_json !== null && typeof row.response_json !== 'string') ||
        (row.observation_json !== null && typeof row.observation_json !== 'string')
      )
        throw new TypeError();
      const command = parseSyncAcknowledgement({
        expected_identity: original.identity,
        cursor: integer(row.cursor),
      });
      const request_trace_id = traceText(row.request_trace_id);
      const response =
        row.response_json === null
          ? null
          : parseSyncAcknowledgementEnvelope(
              JSON.parse(String(row.response_json)),
              command,
              request_trace_id,
            );
      let observation: SyncCursorEnvelope | null = null;
      if (row.observation_json !== null) {
        const raw = JSON.parse(String(row.observation_json)) as { trace_id?: unknown };
        observation = parseSyncCursorEnvelope(
          raw,
          original.identity,
          traceText(raw.trace_id),
          original.identity,
        );
      }
      if (
        (row.state === 'confirmed') !== (response !== null) ||
        (row.state === 'observed' &&
          (!observation?.data.recorded || observation.data.cursor < command.cursor)) ||
        (row.state === 'unconfirmed' &&
          observation?.data.recorded &&
          observation.data.cursor >= command.cursor)
      )
        throw new TypeError();
      record = {
        record_id: row.record_id,
        attempt_sequence: integer(row.attempt_sequence, 1),
        document_sha256: row.document_sha256,
        request_trace_id,
        command,
        state: row.state as SyncInboxAcknowledgement['state'],
        response,
        observation,
      };
    } catch {
      throw fail(
        'INBOX_ACK_CORRUPT',
        'The stored original acknowledgement or its evidence is inconsistent',
        trace,
      );
    }
    const page = this.readPage(original.identity, record.document_sha256, trace);
    if (page.document.page.data.next_cursor !== record.command.cursor)
      throw fail(
        'INBOX_ACK_CORRUPT',
        'The journal target differs from its stored original page',
        trace,
      );
    return record;
  }
  status(identity: SyncCommandIdentity, trace: string) {
    const original = identityFor(identity, trace);
    return this.transaction(
      () => {
        this.require(trace);
        return this.read(original.identity, trace);
      },
      trace,
      false,
    );
  }
  audit(input: unknown, trace: string) {
    const query = parseInboxAckAuditQuery(input, trace);
    const original = identityFor(query.expected_identity, trace);
    try {
      return this.transaction(
        () => {
          this.require(trace);
          const dispatch =
            this.db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE name IN ('sync_inbox_ack_dispatch_schema','sync_inbox_ack_dispatches','idx_sync_inbox_ack_dispatch_active','sync_inbox_ack_dispatch_identity','sync_inbox_ack_dispatch_original','sync_inbox_ack_dispatch_no_delete') LIMIT 1",
              )
              .get() !== undefined;
          const recovery =
            this.db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE name IN ('sync_inbox_ack_recovery_schema','sync_inbox_ack_recoveries','sync_inbox_ack_recovery_binding','sync_inbox_ack_recovery_no_update','sync_inbox_ack_recovery_no_delete') LIMIT 1",
              )
              .get() !== undefined;
          if (dispatch) this.requireDispatch(trace);
          if (recovery) this.requireRecovery(trace);
          return auditInboxAcknowledgements(
            this.db,
            original.key,
            query,
            { dispatch, recovery },
            trace,
            {
              record: (id) => this.read(original.identity, trace, id),
              dispatch: (id) => this.readDispatch(original.identity, trace, id),
              recovery: (id) => this.readRecovery(original.identity, trace, id),
            },
          );
        },
        trace,
        false,
      );
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...error.envelope.details,
          audit_scope: 'consumer-acknowledgement-journals',
          audit_completed: false,
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
  }
  detail(input: unknown, trace: string, dispatch: boolean) {
    const query = parseInboxAckDetailQuery(input, trace, dispatch);
    return this.transaction(
      () => {
        if (dispatch) {
          this.requireDispatch(trace);
          const attempt = this.readDispatch(query.expected_identity, trace, query.id);
          return this.boundedHistory(
            {
              kind: 'dispatch' as const,
              expected_identity: query.expected_identity,
              dispatch_id: query.id,
              dispatch: attempt,
              record: attempt ? this.read(query.expected_identity, trace, attempt.record_id) : null,
            },
            trace,
          );
        }
        this.require(trace);
        return this.boundedHistory(
          {
            kind: 'acknowledgement' as const,
            expected_identity: query.expected_identity,
            record_id: query.id,
            record: this.read(query.expected_identity, trace, query.id),
          },
          trace,
        );
      },
      trace,
      false,
    );
  }
  evidenceDocument(input: unknown, trace: string, dispatch: boolean) {
    const query = parseInboxAckDetailQuery(input, trace, dispatch);
    return this.transaction(
      () => {
        if (dispatch) this.requireDispatch(trace);
        else this.require(trace);
        const attempt = dispatch
          ? this.readDispatch(query.expected_identity, trace, query.id)
          : null;
        const record = dispatch
          ? attempt
            ? this.read(query.expected_identity, trace, attempt.record_id)
            : null
          : this.read(query.expected_identity, trace, query.id);
        if (!record)
          throw fail(
            'INBOX_ACK_NOT_FOUND',
            'The selected original acknowledgement or dispatch is absent for this consumer; no archive was produced',
            trace,
          );
        const page = this.readPage(query.expected_identity, record.document_sha256, trace);
        return parseSyncAckEvidenceDocument({
          schema_version: 1,
          kind: 'workctx.sync-ack-evidence',
          page,
          record,
          dispatch: attempt,
        });
      },
      trace,
      false,
    );
  }
  recoveryEvidenceDocument(input: unknown, trace: string) {
    const query = parseInboxAckDetailQuery(input, trace, false);
    return this.transaction(
      () => {
        this.requireRecovery(trace);
        const record = this.read(query.expected_identity, trace, query.id);
        const recovery = this.readRecovery(query.expected_identity, trace, query.id);
        if (!record || !recovery)
          throw fail(
            'INBOX_ACK_RECOVERY_NOT_FOUND',
            'Select an original target with saved recovery provenance; no archive was produced',
            trace,
          );
        const dispatch = this.readDispatch(
          query.expected_identity,
          trace,
          recovery.first_dispatch_id,
        );
        if (!dispatch)
          throw fail(
            'INBOX_ACK_RECOVERY_CORRUPT',
            'The recovery first dispatch could not be read completely',
            trace,
          );
        const page = this.readPage(query.expected_identity, record.document_sha256, trace);
        return parseSyncAckEvidenceDocument({
          schema_version: 2,
          kind: 'workctx.sync-ack-evidence',
          page,
          record,
          dispatch,
          recovery,
        });
      },
      trace,
      false,
    );
  }
  private boundedHistory<T>(value: T, trace: string): T {
    try {
      syncJsonSnapshot(value, SYNC_INBOX_ACK_HISTORY_BYTES);
      return value;
    } catch {
      throw fail(
        'INBOX_ACK_HISTORY_TOO_LARGE',
        'The complete local history result exceeds 512 KiB; select a smaller page',
        trace,
      );
    }
  }
  history(input: unknown, trace: string, dispatch: boolean) {
    const query = parseInboxAckHistoryQuery(input, trace, dispatch);
    const original = identityFor(query.expected_identity, trace);
    return this.transaction(
      () => {
        if (dispatch) this.requireDispatch(trace);
        else this.require(trace);
        if (query.record_id && !this.read(original.identity, trace, query.record_id))
          throw fail(
            'INBOX_ACK_NOT_FOUND',
            'The selected original acknowledgement is absent for this consumer',
            trace,
          );
        // Identifiers below are selected only from these internal constants, never from query text.
        const table = dispatch ? 'sync_inbox_ack_dispatches' : 'sync_inbox_acknowledgements';
        const sequence = dispatch ? 'dispatch_sequence' : 'attempt_sequence';
        const id = dispatch ? 'dispatch_id' : 'record_id';
        const filter = query.record_id ? ' AND record_id = ?' : '';
        const bindings = query.record_id ? [original.key, query.record_id] : [original.key];
        const columns = `CASE WHEN length(${id}) = 26 THEN ${id} ELSE NULL END AS id,
        CASE WHEN typeof(${sequence}) = 'integer' THEN CAST(${sequence} AS TEXT) ELSE NULL END AS sequence`;
        const metadata = (row: Record<string, unknown>) => {
          try {
            if (!isUlid(row.id)) throw new TypeError();
            return { id: row.id, sequence: integer(row.sequence, 1) };
          } catch {
            throw fail(
              'INBOX_ACK_HISTORY_CORRUPT',
              'A selected history row has invalid identity or sequence metadata',
              trace,
            );
          }
        };
        const latestRow =
          query.through_id === undefined
            ? this.db
                .prepare(
                  `SELECT ${columns} FROM ${table} WHERE consumer_key = ?${filter} ORDER BY ${sequence} DESC LIMIT 1`,
                )
                .get(...bindings)
            : this.db
                .prepare(
                  `SELECT ${columns} FROM ${table} WHERE consumer_key = ?${filter} AND ${id} = ?`,
                )
                .get(...bindings, query.through_id);
        if (query.through_id !== undefined && !latestRow)
          throw fail(
            'INBOX_ACK_HISTORY_BOUND_CHANGED',
            'The saved history upper bound is absent for the original consumer and filter',
            trace,
          );
        const bound = latestRow ? metadata(latestRow) : null;
        if (
          bound &&
          query.through_sequence !== undefined &&
          bound.sequence !== query.through_sequence
        )
          throw fail(
            'INBOX_ACK_HISTORY_BOUND_CHANGED',
            'The saved history upper ID and sequence no longer match',
            trace,
          );
        if (bound) {
          // Validate the fixed upper member even when it falls outside this page.
          const member = dispatch
            ? this.readDispatch(original.identity, trace, bound.id)
            : this.read(original.identity, trace, bound.id);
          if (!member)
            throw fail(
              'INBOX_ACK_HISTORY_CORRUPT',
              'The history upper member could not be read completely',
              trace,
            );
        }
        const through_sequence = bound?.sequence ?? 0;
        const rows = this.db
          .prepare(
            `SELECT ${columns} FROM ${table}
        WHERE consumer_key = ?${filter} AND ${sequence} > ? AND ${sequence} <= ?
        ORDER BY ${sequence} ASC LIMIT ?`,
          )
          .all(...bindings, query.after_sequence, through_sequence, query.limit + 1);
        const selected = rows.map(metadata);
        let previous = query.after_sequence;
        for (const row of selected) {
          if (row.sequence <= previous || row.sequence > through_sequence)
            throw fail(
              'INBOX_ACK_HISTORY_CORRUPT',
              'The selected history sequence is not strictly increasing within its bound',
              trace,
            );
          previous = row.sequence;
        }
        const has_more = selected.length > query.limit;
        const page = selected.slice(0, query.limit);
        const items: (SyncInboxAcknowledgementSummary | SyncInboxAcknowledgementDispatchSummary)[] =
          [];
        for (const row of page) {
          if (dispatch) {
            const attempt = this.readDispatch(original.identity, trace, row.id);
            if (
              !attempt ||
              attempt.dispatch_sequence !== row.sequence ||
              (query.record_id && attempt.record_id !== query.record_id)
            )
              throw fail(
                'INBOX_ACK_HISTORY_CORRUPT',
                'A selected dispatch does not match its original history row',
                trace,
              );
            const { response, ...summary } = attempt;
            items.push({ ...summary, has_response: response !== null });
          } else {
            const record = this.read(original.identity, trace, row.id);
            if (!record || record.attempt_sequence !== row.sequence)
              throw fail(
                'INBOX_ACK_HISTORY_CORRUPT',
                'A selected acknowledgement does not match its original history row',
                trace,
              );
            items.push({
              record_id: record.record_id,
              attempt_sequence: record.attempt_sequence,
              document_sha256: record.document_sha256,
              request_trace_id: record.request_trace_id,
              cursor: record.command.cursor,
              state: record.state,
              has_response: record.response !== null,
              has_observation: record.observation !== null,
            });
          }
        }
        const last = page.at(-1);
        return this.boundedHistory(
          {
            kind: dispatch ? ('dispatches' as const) : ('acknowledgements' as const),
            expected_identity: original.identity,
            ...(query.record_id ? { record_id: query.record_id } : {}),
            items,
            after_sequence: query.after_sequence,
            limit: query.limit,
            through_sequence,
            through_id: bound?.id ?? null,
            has_more,
            next_query:
              has_more && last && bound
                ? {
                    ...query,
                    after_sequence: last.sequence,
                    through_sequence: bound.sequence,
                    through_id: bound.id,
                  }
                : null,
            consistency: 'fixed-upper-bound-current-evidence' as const,
          },
          trace,
        );
      },
      trace,
      false,
    );
  }
  prepare(identity: SyncCommandIdentity, digest: string, trace: string) {
    const original = identityFor(identity, trace);
    traceText(trace);
    return this.transaction(
      () => this.prepareInside(original.identity, digest, trace),
      trace,
      true,
    );
  }
  private prepareInside(identity: SyncCommandIdentity, digest: string, trace: string) {
    const original = identityFor(identity, trace);
    this.require(trace);
    const page = this.readPage(original.identity, digest, trace);
    const latest = this.read(original.identity, trace);
    if (latest?.state === 'unconfirmed')
      throw fail(
        'INBOX_ACK_PENDING',
        'Preserve the unresolved original acknowledgement; observe it, select its latest dispatch for ack-retry, or explicitly ack-recover a legacy target without dispatch history',
        trace,
      );
    if (latest?.document_sha256 === digest)
      return { action: 'already-recorded' as const, record: latest };
    const cursor = page.document.page.data.next_cursor;
    if (latest && cursor < latest.command.cursor)
      throw fail(
        'INBOX_ACK_REGRESSION',
        'The requested page is behind the locally recorded acknowledgement target',
        trace,
      );
    const sequence = (latest?.attempt_sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence))
      throw fail(
        'INBOX_LIMIT_REACHED',
        'The acknowledgement sequence cannot advance safely',
        trace,
      );
    const id = createUlid();
    this.db
      .prepare(
        `INSERT INTO sync_inbox_acknowledgements
        (consumer_key, attempt_sequence, record_id, document_sha256, cursor, request_trace_id, state, response_json, observation_json)
        VALUES (?, ?, ?, ?, ?, ?, 'unconfirmed', NULL, NULL)`,
      )
      .run(original.key, sequence, id, digest, cursor, trace);
    const record = this.read(original.identity, trace, id);
    if (!record)
      throw fail(
        'INBOX_ACK_CORRUPT',
        'The new original acknowledgement could not be read back',
        trace,
      );
    return { action: 'prepared' as const, record };
  }
  private requireDispatch(trace: string) {
    this.require(trace);
    try {
      const requiredObjects = [
        ['sync_inbox_ack_dispatch_schema', 'table'],
        ['sync_inbox_ack_dispatches', 'table'],
        ['idx_sync_inbox_ack_dispatch_active', 'index'],
        ['sync_inbox_ack_dispatch_identity', 'trigger'],
        ['sync_inbox_ack_dispatch_original', 'trigger'],
        ['sync_inbox_ack_dispatch_no_delete', 'trigger'],
      ] as const;
      const lookup = this.db.prepare('SELECT type FROM sqlite_master WHERE name = ?');
      if (requiredObjects.some(([name, type]) => lookup.get(name)?.type !== type))
        throw new TypeError();
      if (
        this.db
          .prepare('SELECT version FROM sync_inbox_ack_dispatch_schema WHERE singleton = 1')
          .get()?.version !== 1
      )
        throw new TypeError();
      const columns = new Set(
        this.db
          .prepare('PRAGMA table_info(sync_inbox_ack_dispatches)')
          .all()
          .map((row) => row.name),
      );
      if (
        [
          'dispatch_id',
          'consumer_key',
          'record_id',
          'dispatch_sequence',
          'invocation_trace_id',
          'started_at_ms',
          'lease_until_ms',
          'state',
          'response_json',
        ].some((name) => !columns.has(name))
      )
        throw new TypeError();
    } catch {
      throw fail(
        'INBOX_ACK_DISPATCH_SCHEMA_REQUIRED',
        'Explicitly enable the acknowledgement dispatch journal; existing files are not upgraded automatically',
        trace,
      );
    }
  }
  enableDispatches(trace: string) {
    return this.transaction(
      () => {
        this.require(trace);
        const present = this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('sync_inbox_ack_dispatch_schema', 'sync_inbox_ack_dispatches', 'idx_sync_inbox_ack_dispatch_active', 'sync_inbox_ack_dispatch_identity', 'sync_inbox_ack_dispatch_original', 'sync_inbox_ack_dispatch_no_delete')",
          )
          .all();
        if (present.length) {
          this.requireDispatch(trace);
          return { status: 'already-enabled' as const, version: 1 as const };
        }
        this.db.exec(SYNC_INBOX_ACK_DISPATCH_SCHEMA_V1);
        this.requireDispatch(trace);
        return { status: 'enabled' as const, version: 1 as const };
      },
      trace,
      true,
    );
  }
  private requireRecovery(trace: string) {
    this.requireDispatch(trace);
    try {
      const objects = [
        ['sync_inbox_ack_recovery_schema', 'table'],
        ['sync_inbox_ack_recoveries', 'table'],
        ['sync_inbox_ack_recovery_binding', 'trigger'],
        ['sync_inbox_ack_recovery_no_update', 'trigger'],
        ['sync_inbox_ack_recovery_no_delete', 'trigger'],
      ] as const;
      const lookup = this.db.prepare('SELECT type FROM sqlite_master WHERE name = ?');
      if (
        objects.some(([name, type]) => lookup.get(name)?.type !== type) ||
        this.db
          .prepare('SELECT version FROM sync_inbox_ack_recovery_schema WHERE singleton = 1')
          .get()?.version !== 1
      )
        throw new TypeError();
      const columns = new Set(
        this.db
          .prepare('PRAGMA table_info(sync_inbox_ack_recoveries)')
          .all()
          .map((row) => row.name),
      );
      if (
        [
          'record_id',
          'consumer_key',
          'recovery_id',
          'first_dispatch_id',
          'invocation_trace_id',
          'registered_at_ms',
        ].some((name) => !columns.has(name))
      )
        throw new TypeError();
    } catch {
      throw fail(
        'INBOX_ACK_RECOVERY_SCHEMA_REQUIRED',
        'Explicitly enable the recovery provenance extension before recovering a legacy intent',
        trace,
      );
    }
  }
  enableRecoveries(trace: string) {
    return this.transaction(
      () => {
        this.requireDispatch(trace);
        const present = this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('sync_inbox_ack_recovery_schema', 'sync_inbox_ack_recoveries', 'sync_inbox_ack_recovery_binding', 'sync_inbox_ack_recovery_no_update', 'sync_inbox_ack_recovery_no_delete')",
          )
          .all();
        if (present.length) {
          this.requireRecovery(trace);
          return { status: 'already-enabled' as const, version: 1 as const };
        }
        this.db.exec(SYNC_INBOX_ACK_RECOVERY_SCHEMA_V1);
        this.requireRecovery(trace);
        return { status: 'enabled' as const, version: 1 as const };
      },
      trace,
      true,
    );
  }
  private readRecovery(
    identity: SyncCommandIdentity,
    trace: string,
    recordId: string,
  ): SyncInboxAcknowledgementRecovery | null {
    const original = identityFor(identity, trace);
    const row = this.db
      .prepare(
        `SELECT
      CASE WHEN length(recovery_id) = 26 THEN recovery_id ELSE NULL END AS recovery_id,
      CASE WHEN length(record_id) = 26 THEN record_id ELSE NULL END AS record_id,
      CASE WHEN length(first_dispatch_id) = 26 THEN first_dispatch_id ELSE NULL END AS first_dispatch_id,
      CASE WHEN length(CAST(invocation_trace_id AS BLOB)) <= 4096 THEN invocation_trace_id ELSE NULL END AS invocation_trace_id,
      CASE WHEN typeof(registered_at_ms) = 'integer' THEN CAST(registered_at_ms AS TEXT) ELSE NULL END AS registered_at_ms
      FROM sync_inbox_ack_recoveries WHERE consumer_key = ? AND record_id = ?`,
      )
      .get(original.key, recordId);
    if (!row) return null;
    if (!isUlid(row.recovery_id) || row.record_id !== recordId || !isUlid(row.first_dispatch_id))
      throw fail(
        'INBOX_ACK_RECOVERY_CORRUPT',
        'The recovery provenance identifiers are invalid',
        trace,
      );
    // Storage and referenced-record failures must not be relabeled by the parsing catch below.
    const record = this.read(original.identity, trace, recordId);
    const dispatch = this.readDispatch(original.identity, trace, row.first_dispatch_id);
    if (!record || !dispatch)
      throw fail(
        'INBOX_ACK_RECOVERY_CORRUPT',
        'Recovery provenance has no complete original record or first dispatch',
        trace,
      );
    const invalidHistory = this.db
      .prepare(
        `SELECT 1 FROM sync_inbox_ack_dispatches WHERE record_id = ? AND
        (consumer_key <> ? OR typeof(dispatch_sequence) <> 'integer' OR dispatch_sequence < 1
          OR dispatch_sequence > 9007199254740991 OR (dispatch_id <> ? AND dispatch_sequence <= ?)) LIMIT 1`,
      )
      .get(recordId, original.key, dispatch.dispatch_id, dispatch.dispatch_sequence);
    try {
      const registered_at_ms = integer(row.registered_at_ms);
      const invocation_trace_id = traceText(row.invocation_trace_id);
      if (
        dispatch.record_id !== record.record_id ||
        dispatch.started_at_ms !== registered_at_ms ||
        dispatch.invocation_trace_id !== invocation_trace_id ||
        invalidHistory
      )
        throw new TypeError();
      return parseSyncInboxAcknowledgementRecovery(
        {
          recovery_id: row.recovery_id,
          record_id: recordId,
          first_dispatch_id: dispatch.dispatch_id,
          invocation_trace_id,
          registered_at_ms,
          prior_local_dispatch_history: 'absent',
          prior_remote_outcome: 'unknown',
        },
        record,
        dispatch,
      );
    } catch {
      throw fail(
        'INBOX_ACK_RECOVERY_CORRUPT',
        'The recovery provenance differs from its original target or first local dispatch',
        trace,
      );
    }
  }
  recoveryDetail(input: unknown, trace: string) {
    const query = parseInboxAckDetailQuery(input, trace, false);
    return this.transaction(
      () => {
        this.requireRecovery(trace);
        const record = this.read(query.expected_identity, trace, query.id);
        const recovery = this.readRecovery(query.expected_identity, trace, query.id);
        if (!record && recovery)
          throw fail(
            'INBOX_ACK_RECOVERY_CORRUPT',
            'Recovery provenance has no original record',
            trace,
          );
        return this.boundedHistory(
          {
            kind: 'recovery' as const,
            expected_identity: query.expected_identity,
            record_id: query.id,
            record,
            recovery,
            first_dispatch: recovery
              ? this.readDispatch(query.expected_identity, trace, recovery.first_dispatch_id)
              : null,
          },
          trace,
        );
      },
      trace,
      false,
    );
  }
  private readDispatch(
    identity: SyncCommandIdentity,
    trace: string,
    id?: string,
  ): SyncInboxAcknowledgementDispatch | null {
    const original = identityFor(identity, trace);
    const row = this.db
      .prepare(
        `SELECT
      CASE WHEN length(dispatch_id) = 26 THEN dispatch_id ELSE NULL END AS dispatch_id,
      CASE WHEN length(record_id) = 26 THEN record_id ELSE NULL END AS record_id,
      CASE WHEN typeof(dispatch_sequence) = 'integer' THEN CAST(dispatch_sequence AS TEXT) ELSE NULL END AS dispatch_sequence,
      CASE WHEN length(CAST(invocation_trace_id AS BLOB)) <= 4096 THEN invocation_trace_id ELSE NULL END AS invocation_trace_id,
      CASE WHEN typeof(started_at_ms) = 'integer' THEN CAST(started_at_ms AS TEXT) ELSE NULL END AS started_at_ms,
      CASE WHEN typeof(lease_until_ms) = 'integer' THEN CAST(lease_until_ms AS TEXT) ELSE NULL END AS lease_until_ms,
      CASE WHEN state IN ('active', 'unknown', 'expired', 'confirmed') THEN state ELSE NULL END AS state,
      CASE WHEN response_json IS NULL OR length(CAST(response_json AS BLOB)) <= 32768 THEN response_json ELSE '' END AS response_json
      FROM sync_inbox_ack_dispatches WHERE consumer_key = ? ${id === undefined ? '' : 'AND dispatch_id = ?'}
      ORDER BY dispatch_sequence DESC LIMIT 1`,
      )
      .get(...(id === undefined ? [original.key] : [original.key, id]));
    if (!row) return null;
    if (!isUlid(row.record_id))
      throw fail('INBOX_ACK_DISPATCH_CORRUPT', 'The dispatch original record ID is invalid', trace);
    // Read the original page outside the content-validation catch so I/O failures remain I/O failures.
    const ticket = this.read(original.identity, trace, row.record_id);
    if (!ticket)
      throw fail(
        'INBOX_ACK_DISPATCH_CORRUPT',
        'The dispatch has no original acknowledgement',
        trace,
      );
    try {
      if (
        !isUlid(row.dispatch_id) ||
        !isUlid(row.record_id) ||
        typeof row.state !== 'string' ||
        !['active', 'unknown', 'expired', 'confirmed'].includes(row.state)
      )
        throw new TypeError();
      const started_at_ms = integer(row.started_at_ms);
      const lease_until_ms = integer(row.lease_until_ms);
      if (lease_until_ms - started_at_ms < 60001 || lease_until_ms - started_at_ms > 2147543647)
        throw new TypeError();
      const response =
        row.response_json === null
          ? null
          : parseSyncAcknowledgementEnvelope(
              JSON.parse(String(row.response_json)),
              ticket.command,
              ticket.request_trace_id,
            );
      if (
        (row.state === 'confirmed') !== (response !== null) ||
        (response !== null && ticket.state !== 'confirmed')
      )
        throw new TypeError();
      return {
        dispatch_id: row.dispatch_id,
        record_id: row.record_id,
        dispatch_sequence: integer(row.dispatch_sequence, 1),
        invocation_trace_id: traceText(row.invocation_trace_id),
        started_at_ms,
        lease_until_ms,
        state: row.state as SyncInboxAcknowledgementDispatch['state'],
        response,
      };
    } catch {
      throw fail(
        'INBOX_ACK_DISPATCH_CORRUPT',
        'The saved dispatch does not match its original acknowledgement',
        trace,
      );
    }
  }
  dispatchStatus(identity: SyncCommandIdentity, trace: string) {
    const original = identityFor(identity, trace);
    return this.transaction(
      () => {
        this.requireDispatch(trace);
        return {
          record: this.read(original.identity, trace),
          dispatch: this.readDispatch(original.identity, trace),
        };
      },
      trace,
      false,
    );
  }
  startDispatch(
    identity: SyncCommandIdentity,
    digest: string,
    trace: string,
    timeout: number,
    previousDispatchId?: string,
  ) {
    return this.startOperation(
      identity,
      digest,
      trace,
      timeout,
      previousDispatchId === undefined
        ? { mode: 'initial' }
        : { mode: 'retry', dispatch_id: previousDispatchId },
    );
  }
  startRecovery(
    identity: SyncCommandIdentity,
    digest: string,
    recordId: string,
    trace: string,
    timeout: number,
  ) {
    return this.startOperation(identity, digest, trace, timeout, {
      mode: 'recover',
      record_id: recordId,
    });
  }
  private startOperation(
    identity: SyncCommandIdentity,
    digest: string,
    trace: string,
    timeout: number,
    selection: DispatchSelection,
  ) {
    const original = identityFor(identity, trace);
    traceText(trace);
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 2147483647 ||
      (selection.mode === 'retry' && !isUlid(selection.dispatch_id)) ||
      (selection.mode === 'recover' && !isUlid(selection.record_id))
    )
      throw fail(
        'INBOX_ACK_DISPATCH_INVALID',
        'Supply a bounded timeout and the exact original dispatch or recovery record ID',
        trace,
      );
    return this.transaction(
      () => {
        this.requireDispatch(trace);
        if (selection.mode === 'recover') this.requireRecovery(trace);
        let record: SyncInboxAcknowledgement;
        let recovery: SyncInboxAcknowledgementRecovery | null = null;
        const previous = this.readDispatch(original.identity, trace);
        if (selection.mode === 'recover') {
          const latest = this.read(original.identity, trace);
          if (
            !latest ||
            latest.record_id !== selection.record_id ||
            latest.document_sha256 !== digest
          )
            throw fail(
              'INBOX_ACK_RECOVERY_TARGET_CHANGED',
              'Select the latest original record ID and its unchanged saved page for recovery',
              trace,
            );
          record = latest;
          recovery = this.readRecovery(original.identity, trace, record.record_id);
          if (record.state !== 'unconfirmed') return { record, dispatch: null, recovery };
          if (
            recovery ||
            this.db
              .prepare('SELECT 1 FROM sync_inbox_ack_dispatches WHERE record_id = ? LIMIT 1')
              .get(record.record_id)
          )
            throw new ContractError(
              'INBOX_ACK_RECOVERY_HAS_DISPATCH',
              'This original target already has local dispatch history; select its latest dispatch ID for ack-retry',
              {
                trace_id: trace,
                retryable: false,
                details: {
                  record_id: record.record_id,
                  ...(previous?.record_id === record.record_id
                    ? { dispatch_id: previous.dispatch_id }
                    : {}),
                  ...(recovery ? { recovery_id: recovery.recovery_id } : {}),
                },
              },
            );
        } else if (selection.mode === 'retry') {
          const latest = this.read(original.identity, trace);
          if (
            !latest ||
            latest.document_sha256 !== digest ||
            !previous ||
            previous.record_id !== latest.record_id ||
            previous.dispatch_id !== selection.dispatch_id
          )
            throw fail(
              'INBOX_ACK_DISPATCH_CHANGED',
              'Select the original page and latest dispatch ID; a legacy intent without dispatch history needs observation or explicit ack-recover',
              trace,
            );
          record = latest;
        } else {
          record = this.prepareInside(original.identity, digest, trace).record;
        }
        if (record.state !== 'unconfirmed') return { record, dispatch: null, recovery };
        const now = Date.now();
        const lease = now + timeout + 60000;
        if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(lease))
          throw fail(
            'INBOX_ACK_CLOCK_INVALID',
            'The local clock cannot provide a safe dispatch deadline',
            trace,
          );
        if (previous?.state === 'active') {
          if (now < previous.lease_until_ms)
            throw new ContractError(
              'INBOX_ACK_DISPATCH_BUSY',
              'The latest dispatch still owns its local waiting period',
              {
                trace_id: trace,
                retryable: false,
                details: {
                  dispatch_id: previous.dispatch_id,
                  lease_until_ms: previous.lease_until_ms,
                },
              },
            );
          this.db
            .prepare(
              "UPDATE sync_inbox_ack_dispatches SET state = 'expired' WHERE dispatch_id = ? AND state = 'active'",
            )
            .run(previous.dispatch_id);
        }
        const sequence = (previous?.dispatch_sequence ?? 0) + 1;
        if (!Number.isSafeInteger(sequence))
          throw fail('INBOX_LIMIT_REACHED', 'The dispatch sequence cannot advance safely', trace);
        const id = createUlid();
        this.db
          .prepare(
            `INSERT INTO sync_inbox_ack_dispatches
        (dispatch_id, consumer_key, record_id, dispatch_sequence, invocation_trace_id, started_at_ms, lease_until_ms, state, response_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL)`,
          )
          .run(id, original.key, record.record_id, sequence, trace, now, lease);
        const dispatch = this.readDispatch(original.identity, trace, id);
        if (!dispatch)
          throw fail(
            'INBOX_ACK_DISPATCH_CORRUPT',
            'The new dispatch could not be read back',
            trace,
          );
        if (selection.mode === 'recover') {
          this.db
            .prepare(
              `INSERT INTO sync_inbox_ack_recoveries
            (record_id, consumer_key, recovery_id, first_dispatch_id, invocation_trace_id, registered_at_ms)
            VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              record.record_id,
              original.key,
              createUlid(),
              dispatch.dispatch_id,
              trace,
              dispatch.started_at_ms,
            );
          recovery = this.readRecovery(original.identity, trace, record.record_id);
          if (!recovery || recovery.first_dispatch_id !== dispatch.dispatch_id)
            throw fail(
              'INBOX_ACK_RECOVERY_CORRUPT',
              'The new recovery provenance could not be read back',
              trace,
            );
        }
        return { record, dispatch, recovery };
      },
      trace,
      true,
    );
  }
  /** Recheck ownership immediately before entering the transport, without holding a transaction over I/O. */
  assertDispatch(
    ticket: SyncInboxAcknowledgement,
    dispatch: SyncInboxAcknowledgementDispatch,
    trace: string,
  ) {
    const original = structuredClone(ticket);
    const savedDispatch = structuredClone(dispatch);
    return this.transaction(
      () => {
        this.requireDispatch(trace);
        const current = this.original(original, trace);
        const latest = this.readDispatch(current.command.expected_identity, trace);
        if (
          !latest ||
          latest.dispatch_id !== savedDispatch.dispatch_id ||
          latest.record_id !== current.record_id ||
          latest.state !== 'active' ||
          latest.lease_until_ms <= Date.now() ||
          current.state !== 'unconfirmed'
        )
          throw fail(
            'INBOX_ACK_DISPATCH_CHANGED',
            'The dispatch no longer owns a live unresolved target; no request was started by this invocation',
            trace,
          );
      },
      trace,
      false,
    );
  }
  settleDispatch(
    ticket: SyncInboxAcknowledgement,
    dispatch: SyncInboxAcknowledgementDispatch,
    value: unknown | null,
    trace: string,
  ) {
    const original = structuredClone(ticket);
    const savedDispatch = structuredClone(dispatch);
    const response =
      value === null
        ? null
        : parseSyncAcknowledgementEnvelope(value, original.command, original.request_trace_id);
    const json = response === null ? null : syncJsonSnapshot(response, SYNC_CURSOR_RESPONSE_BYTES);
    return this.transaction(
      () => {
        this.requireDispatch(trace);
        const current = this.original(original, trace);
        const stored = this.readDispatch(
          current.command.expected_identity,
          trace,
          savedDispatch.dispatch_id,
        );
        if (
          !stored ||
          stored.record_id !== current.record_id ||
          stored.dispatch_sequence !== savedDispatch.dispatch_sequence ||
          stored.invocation_trace_id !== savedDispatch.invocation_trace_id ||
          stored.started_at_ms !== savedDispatch.started_at_ms ||
          stored.lease_until_ms !== savedDispatch.lease_until_ms
        )
          throw fail('INBOX_ACK_DISPATCH_CHANGED', 'The original dispatch binding changed', trace);
        if (json !== null) {
          if (
            stored.response &&
            syncJsonSnapshot(stored.response, SYNC_CURSOR_RESPONSE_BYTES) !== json
          )
            throw fail(
              'INBOX_ACK_DISPATCH_CHANGED',
              'The complete response differs from this dispatch evidence',
              trace,
            );
          this.db
            .prepare(
              "UPDATE sync_inbox_ack_dispatches SET state = 'confirmed', response_json = ? WHERE dispatch_id = ? AND response_json IS NULL",
            )
            .run(json, stored.dispatch_id);
          // Keep the first complete logical response; later attempts retain their own full response above.
          this.db
            .prepare(
              "UPDATE sync_inbox_acknowledgements SET state = 'confirmed', response_json = ? WHERE record_id = ? AND response_json IS NULL",
            )
            .run(json, current.record_id);
        } else {
          this.db
            .prepare(
              "UPDATE sync_inbox_ack_dispatches SET state = 'unknown' WHERE dispatch_id = ? AND state = 'active'",
            )
            .run(stored.dispatch_id);
        }
        const result = this.readDispatch(
          current.command.expected_identity,
          trace,
          stored.dispatch_id,
        );
        const record = this.original(original, trace);
        if (
          !result ||
          (json !== null &&
            (!result.response ||
              syncJsonSnapshot(result.response, SYNC_CURSOR_RESPONSE_BYTES) !== json ||
              record.state !== 'confirmed'))
        )
          throw fail(
            'INBOX_ACK_DISPATCH_CORRUPT',
            'The dispatch result could not be read back completely',
            trace,
          );
        return { record, dispatch: result };
      },
      trace,
      true,
    );
  }
  private original(ticket: SyncInboxAcknowledgement, trace: string) {
    const current = this.read(ticket.command.expected_identity, trace, ticket.record_id);
    if (
      !current ||
      current.attempt_sequence !== ticket.attempt_sequence ||
      current.document_sha256 !== ticket.document_sha256 ||
      current.request_trace_id !== ticket.request_trace_id ||
      syncJsonSnapshot(current.command, 16384) !== syncJsonSnapshot(ticket.command, 16384)
    )
      throw fail(
        'INBOX_ACK_CHANGED',
        'The saved original acknowledgement changed; no evidence was replaced',
        trace,
      );
    return current;
  }
  confirm(ticket: SyncInboxAcknowledgement, value: unknown, trace: string) {
    const original = structuredClone(ticket);
    const response = parseSyncAcknowledgementEnvelope(
      value,
      original.command,
      original.request_trace_id,
    );
    const json = syncJsonSnapshot(response, SYNC_CURSOR_RESPONSE_BYTES);
    return this.transaction(
      () => {
        this.require(trace);
        const current = this.original(original, trace);
        if (current.response) {
          if (syncJsonSnapshot(current.response, SYNC_CURSOR_RESPONSE_BYTES) !== json)
            throw fail(
              'INBOX_ACK_CHANGED',
              'The original response differs from stored evidence',
              trace,
            );
          return current;
        }
        this.db
          .prepare(
            "UPDATE sync_inbox_acknowledgements SET state = 'confirmed', response_json = ? WHERE record_id = ? AND response_json IS NULL",
          )
          .run(json, current.record_id);
        const stored = this.original(original, trace);
        if (
          !stored.response ||
          syncJsonSnapshot(stored.response, SYNC_CURSOR_RESPONSE_BYTES) !== json
        )
          throw fail(
            'INBOX_ACK_CORRUPT',
            'The complete acknowledgement response was not stored',
            trace,
          );
        return stored;
      },
      trace,
      true,
    );
  }
  observe(ticket: SyncInboxAcknowledgement, value: unknown, trace: string) {
    const original = structuredClone(ticket);
    const identity = original.command.expected_identity;
    const observation = parseSyncCursorEnvelope(value, identity, trace, identity);
    if (Date.parse(observation.data.expires_at) <= Date.now())
      throw fail(
        'DENIED',
        'The server cursor observation expired before it could be recorded',
        trace,
      );
    const json = syncJsonSnapshot(observation, SYNC_CURSOR_RESPONSE_BYTES);
    return this.transaction(
      () => {
        this.require(trace);
        const current = this.original(original, trace);
        if (current.state !== 'unconfirmed') return current;
        if (Date.parse(observation.data.expires_at) <= Date.now())
          throw fail(
            'DENIED',
            'The cursor observation expired while waiting for local storage',
            trace,
          );
        const reached =
          observation.data.recorded && observation.data.cursor >= current.command.cursor;
        this.db
          .prepare(
            'UPDATE sync_inbox_acknowledgements SET state = ?, observation_json = ? WHERE record_id = ? AND state = ?',
          )
          .run(reached ? 'observed' : 'unconfirmed', json, current.record_id, 'unconfirmed');
        const stored = this.original(original, trace);
        if (
          !stored.observation ||
          syncJsonSnapshot(stored.observation, SYNC_CURSOR_RESPONSE_BYTES) !== json
        )
          throw fail(
            'INBOX_ACK_CORRUPT',
            'The complete current cursor observation was not stored',
            trace,
          );
        return stored;
      },
      trace,
      true,
    );
  }
}
