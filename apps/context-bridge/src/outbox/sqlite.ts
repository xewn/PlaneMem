import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  fromRow,
  checkedOriginalEvent,
  uploadEvent,
  checksum,
  intact,
  commandContent,
} from './original.js';
import { lstatSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  ContractError,
  isSyncIdentifier,
  MAX_SYNC_BATCH_BYTES,
  snapshotSyncUploadBatch,
  parseSyncUploadResult,
  parseSyncEventReceiptQuery,
  parseSyncEventReceiptEnvelope,
  parseSyncCommandIdentity,
  assertSyncIdentityScope,
  assertSyncCommandIdentity,
  validateIdempotencyKey,
  syncJsonSnapshot,
  type SyncCommandIdentity,
  type Classification,
  type SourceRef,
  type SyncUploadEvent,
  type SyncUploadResult,
  type SyncEventReceiptEnvelope,
  type Ulid,
} from '@planemem/contracts';
import {
  reconciliationBudget,
  reconciliationError,
  reconciliationTransaction,
  type ReconciliationTransactionState,
  type OutboxReconcileFailure,
  type OutboxReceiptReader,
  type OutboxReconcileOptions,
  type OutboxReconcileResult,
} from './reconciliation.js';
import {
  parseOutboxReadScope,
  parseOutboxListQuery,
  outboxReadProjection,
  outboxRecordSummary,
  readOutboxRecords,
  outboxReadTransaction,
  outboxStoredColumns,
} from './reading.js';
import {
  parseOutboxArchiveQuery,
  createOutboxArchive,
  OUTBOX_ARCHIVE_DOCUMENT_BYTES,
} from './archive.js';
export { parseOutboxReadScope, parseOutboxListQuery } from './reading.js';
export type { OutboxListQuery } from './reading.js';
import { parseOutboxAuditQuery, auditOutboxRecords } from './audit.js';
import { readOutboxSendControl, changeOutboxSendControl, outboxClaimGuard } from './control.js';
import { restoreOutboxArchive, readOutboxRestoreReceipt } from './restore.js';
import { previewOutboxArchiveRestore } from './restore-preview.js';
import { auditOutboxRestoreReceipts } from './restore-audit.js';
import { compareOutboxRestoreRecord } from './restore-comparison.js';
import { readOutboxRestoreBackup } from './restore-backup-reading.js';
export { parseOutboxRestoreBackupQuery } from './restore-backup.js';
export type { OutboxRestoreBackupFile, OutboxRestoreBackupDocument } from './restore-backup.js';
export { parseOutboxRestoreComparisonQuery } from './restore-comparison.js';
export type { OutboxRestoreComparisonQuery } from './restore-comparison.js';
export { parseOutboxRestoreAuditQuery } from './restore-audit.js';
export type { OutboxRestoreAuditQuery } from './restore-audit.js';
import {
  listOutboxRestoreReceipts,
  readOutboxRestoreRecord,
  readOutboxRestoreArchive,
} from './restore-history.js';
export { parseOutboxRestoreSelection, parseOutboxRestoreHistoryQuery } from './restore-history.js';
export type { OutboxRestoreSelection, OutboxRestoreHistoryQuery } from './restore-history.js';
export { parseOutboxRestoreQuery } from './restore.js';
export type { OutboxRestoreQuery, OutboxRestoreReceipt } from './restore.js';
export { parseOutboxSendControlChange } from './control.js';
export type { OutboxSendControl, OutboxSendControlChange } from './control.js';
export { parseOutboxAuditQuery } from './audit.js';
export type { OutboxAuditQuery } from './audit.js';
export type {
  OutboxReconcileFailure,
  OutboxReceiptReader,
  OutboxReconcileOptions,
  OutboxReconcileResult,
} from './reconciliation.js';

export interface OutboxScope {
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
}

export interface LocalEvent extends OutboxScope {
  schema_version: 1;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempt: number;
  next_retry_at: string;
  checksum: string;
  /** Absent only on legacy rows; never infer it from the current access token. */
  expected_identity?: SyncCommandIdentity;
  command_checksum?: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'conflict';
  sensitivity?: Classification;
  client_cursor?: number;
  server_event_id?: string;
  server_cursor?: number;
  conflict_id?: string;
  last_error?: string;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface EnqueueInput extends OutboxScope {
  /** Required at runtime for new records; optional typing permits reading/migrating old callers. */
  expected_identity?: SyncCommandIdentity;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  trace_id: string;
  source_refs?: SourceRef[];
  sensitivity?: Classification;
  client_cursor?: number;
}

export type BatchPublisher = (
  scope: OutboxScope,
  events: SyncUploadEvent[],
  key: string,
  expectedIdentity: SyncCommandIdentity,
) => Promise<SyncUploadResult>;

type DrainResult = { sent: string[]; retried: string[]; failed: string[] };
type Settlement = {
  status: 'sent' | 'conflict' | 'failed' | 'pending';
  error?: string;
  conflict_id?: string;
  server_event_id?: string;
  server_cursor?: number;
};

export class SqliteOutbox {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:', options: { existing?: boolean; readonly?: boolean } = {}) {
    if (
      (options.existing !== undefined && typeof options.existing !== 'boolean') ||
      (options.readonly !== undefined && typeof options.readonly !== 'boolean')
    )
      throw reconciliationError(
        'OUTBOX_STORAGE_OPTIONS_INVALID',
        'Supply boolean existing and readonly options',
        'trace_outbox_open',
      );
    const readOnly = options.readonly === true;
    const existing = options.existing === true || readOnly;
    if (existing) {
      try {
        if (!path.trim() || path === ':memory:' || !lstatSync(path).isFile()) throw new TypeError();
      } catch {
        throw reconciliationError(
          'OUTBOX_STORAGE_UNAVAILABLE',
          'Choose an existing regular outbox file in a directory you control',
          'trace_outbox_open',
        );
      }
    }
    // Enforce the mode while opening; query_only alone applies only after a writable open.
    // A failed read-only open must never be retried with writable defaults.
    this.db = new DatabaseSync(path, { readOnly });
    if (existing) {
      try {
        if (readOnly) this.db.exec('PRAGMA query_only = ON');
        this.db.exec('PRAGMA busy_timeout = 5000');
        const columns = new Set(
          this.db
            .prepare('PRAGMA table_info(local_events)')
            .all()
            .map((row) => row.name),
        );
        if (
          [
            'event_id',
            'idempotency_key',
            'tenant_id',
            'workspace_id',
            'project_id',
            'event_type',
            'payload',
            'source_refs',
            'attempt',
            'next_retry_at',
            'checksum',
            'status',
            'trace_id',
            'lease_token',
            'sensitivity',
            'client_cursor',
            'server_event_id',
            'server_cursor',
            'conflict_id',
            'last_error',
            'expected_actor_id',
            'expected_client_id',
            'command_checksum',
          ].some((column) => !columns.has(column))
        )
          throw reconciliationError(
            'OUTBOX_UPGRADE_REQUIRED',
            'The existing queue lacks required recovery columns; preserve it for an explicit upgrade',
            'trace_outbox_open',
          );
      } catch (error) {
        try {
          this.db.close();
        } catch {
          /* Retain the original open/schema failure. */
        }
        throw error;
      }
      return;
    }
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_events (
        event_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        source_refs TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT NOT NULL,
        checksum TEXT NOT NULL,
        status TEXT NOT NULL,
        trace_id TEXT NOT NULL
      )
    `);
    this.transaction(() => {
      const columns = new Set(
        this.db
          .prepare('PRAGMA table_info(local_events)')
          .all()
          .map((c) => c.name),
      );
      for (const [name, type] of Object.entries({
        lease_token: 'TEXT',
        sensitivity: 'TEXT',
        client_cursor: 'INTEGER',
        server_event_id: 'TEXT',
        server_cursor: 'INTEGER',
        conflict_id: 'TEXT',
        last_error: 'TEXT',
        expected_actor_id: 'TEXT',
        expected_client_id: 'TEXT',
        command_checksum: 'TEXT',
      }))
        if (!columns.has(name)) this.db.exec(`ALTER TABLE local_events ADD COLUMN ${name} ${type}`);
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_local_events_due ON local_events(status, next_retry_at)',
      );
    });
  }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  enqueueDurably(input: EnqueueInput): LocalEvent {
    return this.transaction(() => this.enqueue(input));
  }

  private enqueue(input: EnqueueInput): LocalEvent {
    let identity: SyncCommandIdentity;
    try {
      identity = parseSyncCommandIdentity(input.expected_identity);
      assertSyncIdentityScope(identity, input);
    } catch {
      throw new ContractError(
        'OUTBOX_IDENTITY_REQUIRED',
        'Preserve the original sync identity before queueing this event',
        { trace_id: input.trace_id },
      );
    }
    let original: SyncUploadEvent;
    let key: string;
    try {
      key = validateIdempotencyKey(input.idempotency_key);
      original = snapshotSyncUploadBatch([
        {
          event_id: input.event_id,
          event_type: input.event_type,
          payload: input.payload,
          source_refs: input.source_refs ?? [],
          ...(input.sensitivity === undefined ? {} : { sensitivity: input.sensitivity }),
          ...(input.client_cursor === undefined ? {} : { client_cursor: input.client_cursor }),
        },
      ])[0]!;
    } catch {
      throw new ContractError(
        'VALIDATION_ERROR',
        'Supply one complete valid original event and key within the batch limit',
        { trace_id: input.trace_id },
      );
    }
    const event: LocalEvent = {
      schema_version: 1,
      ...original,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      idempotency_key: key,
      trace_id: input.trace_id,
      expected_identity: identity,
      attempt: 0,
      next_retry_at: new Date(0).toISOString(),
      checksum: checksum(JSON.stringify(original.payload)),
      status: 'pending',
    };
    const commandChecksum = checksum(commandContent(event));
    event.command_checksum = commandChecksum;
    const existing = this.findByIdempotency(key);
    if (existing !== undefined) {
      if (
        existing.tenant_id !== event.tenant_id ||
        existing.workspace_id !== event.workspace_id ||
        existing.project_id !== event.project_id
      )
        throw new ContractError(
          'OUTBOX_KEY_SCOPE_CONFLICT',
          'This outbox key is unavailable in this project',
          { trace_id: input.trace_id },
        );
      if (
        !existing.expected_identity ||
        !intact(existing) ||
        commandContent(existing) !== commandContent(event)
      )
        throw new ContractError(
          'OUTBOX_KEY_REUSED',
          'This key is already bound to another or unverified original event; retain the existing row',
          { trace_id: input.trace_id },
        );
      return clone(existing);
    }
    try {
      this.db
        .prepare(
          `INSERT INTO local_events (event_id,idempotency_key,tenant_id,workspace_id,project_id,event_type,payload,source_refs,attempt,next_retry_at,checksum,status,trace_id,sensitivity,client_cursor,expected_actor_id,expected_client_id,command_checksum) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          event.event_id,
          event.idempotency_key,
          String(event.tenant_id),
          String(event.workspace_id),
          String(event.project_id),
          event.event_type,
          JSON.stringify(event.payload),
          JSON.stringify(event.source_refs),
          event.attempt,
          event.next_retry_at,
          event.checksum,
          event.status,
          event.trace_id,
          event.sensitivity ?? null,
          event.client_cursor ?? null,
          identity.actor_id,
          identity.client_id,
          commandChecksum,
        );
    } catch (error) {
      throw new ContractError(
        'OUTBOX_WRITE_FAILED',
        error instanceof Error ? error.message : 'Outbox write failed',
        { trace_id: input.trace_id, retryable: true },
      );
    }
    return clone(event);
  }

  /** Bounded project metadata; content checks are deferred to explicit readRecord/reconcile. */
  listRecords(input: unknown, trace: string) {
    const query = parseOutboxListQuery(input, trace);
    return outboxReadTransaction(this.db, () => readOutboxRecords(this.db, query, trace), trace);
  }

  /** Complete original-content audit of one project; does not grant permission to retry. */
  auditRecords(input: unknown, trace: string) {
    const query = parseOutboxAuditQuery(input, trace);
    return auditOutboxRecords(this.db, query, trace, checkedOriginalEvent);
  }

  readSendControl(scope: unknown, trace: string) {
    return readOutboxSendControl(this.db, scope, trace);
  }

  /** Explicit compare-and-change; affects future claims, never cancels an existing publisher. */
  changeSendControl(input: unknown, trace: string) {
    return changeOutboxSendControl(this.db, input, trace);
  }

  /** Explicit empty-project restore; nonterminal originals remain held until separately reviewed. */
  restoreArchive(archive: unknown, query: unknown, trace: string) {
    return restoreOutboxArchive(this.db, archive, query, trace);
  }

  /** One read snapshot; the actual restore repeats every precondition before writing. */
  previewArchiveRestore(archive: unknown, query: unknown, trace: string) {
    return previewOutboxArchiveRestore(this.db, archive, query, trace);
  }

  readRestoreReceipt(query: unknown, trace: string) {
    return readOutboxRestoreReceipt(this.db, query, trace);
  }

  listRestoreReceipts(query: unknown, trace: string) {
    return listOutboxRestoreReceipts(this.db, query, trace);
  }

  auditRestoreReceipts(query: unknown, trace: string) {
    return auditOutboxRestoreReceipts(this.db, query, trace);
  }

  compareRestoreRecord(query: unknown, trace: string) {
    return compareOutboxRestoreRecord(this.db, query, trace);
  }

  readRestoreBackup(query: unknown, trace: string) {
    return readOutboxRestoreBackup(this.db, query, trace);
  }

  readRestoreRecord(query: unknown, trace: string) {
    return readOutboxRestoreRecord(this.db, query, trace);
  }

  readRestoreArchive(query: unknown, trace: string) {
    return readOutboxRestoreArchive(this.db, query, trace);
  }

  /** Collect only the fully audited snapshot; file publication is the caller's explicit action. */
  readArchive(input: unknown, trace: string) {
    const query = parseOutboxArchiveQuery(input, trace);
    const deadline = performance.now() + query.timeout_ms;
    const records: Record<string, unknown>[] = [];
    let encoded_bytes = 0;
    const check = () => {
      if (performance.now() >= deadline)
        throw reconciliationError(
          'OUTBOX_ARCHIVE_TIMEOUT',
          'The complete archive exceeded its preparation deadline',
          trace,
        );
    };
    const audited = auditOutboxRecords(this.db, query, trace, checkedOriginalEvent, (row) => {
      check();
      const record = outboxStoredColumns(row);
      encoded_bytes += Buffer.byteLength(
        syncJsonSnapshot(record, OUTBOX_ARCHIVE_DOCUMENT_BYTES),
        'utf8',
      );
      if (encoded_bytes > OUTBOX_ARCHIVE_DOCUMENT_BYTES)
        throw reconciliationError(
          'OUTBOX_ARCHIVE_TOO_LARGE',
          'The entire queue cannot fit in the archive; no partial file is available',
          trace,
        );
      records.push(record);
    });
    try {
      check();
      records.sort((a, b) =>
        Buffer.compare(
          Buffer.from(a.event_id as string, 'utf8'),
          Buffer.from(b.event_id as string, 'utf8'),
        ),
      );
      const file = createOutboxArchive(
        {
          schema_version: 1,
          kind: 'workctx.sync-outbox-archive',
          scope: query.scope,
          observed_at: audited.observed_at,
          export_trace_id: trace,
          records,
        },
        trace,
      );
      check();
      return file;
    } catch (error) {
      throw new ContractError(
        error instanceof ContractError ? error.envelope.code : 'OUTBOX_ARCHIVE_INVALID',
        error instanceof ContractError
          ? error.envelope.message
          : 'The complete audited snapshot cannot be represented as an archive',
        {
          trace_id: trace,
          retryable: false,
          details: {
            ...(error instanceof ContractError ? error.envelope.details : {}),
            query,
            complete: false,
            stage: 'archive',
            audit_complete: true,
            checked_events: audited.checked_events,
            checked_bytes: audited.checked_bytes,
          },
        },
      );
    }
  }

  /** Exact original lookup, including active senders; this never claims or settles an event. */
  readRecord(scope: OutboxScope, event_id: string, trace: string) {
    const originalScope = parseOutboxReadScope(scope, trace);
    if (!isSyncIdentifier(event_id))
      throw reconciliationError('INVALID_INPUT', 'Supply the exact original event ID', trace);
    return outboxReadTransaction(
      this.db,
      () => {
        const rows = this.db
          .prepare(
            `SELECT ${outboxReadProjection(true)} FROM local_events
        WHERE tenant_id = ? AND workspace_id = ? AND project_id = ? AND event_id = ? LIMIT 2`,
          )
          .all(
            originalScope.tenant_id,
            originalScope.workspace_id,
            originalScope.project_id,
            event_id,
          );
        if (rows.length > 1)
          throw reconciliationError(
            'OUTBOX_RECORD_CORRUPT',
            'The original event lookup is ambiguous; preserve the queue',
            trace,
          );
        const row = rows[0];
        const now = Date.now();
        if (!row)
          return {
            scope: originalScope,
            event: null,
            summary: null,
            original_content: 'not-found' as const,
            observed_at: new Date(now).toISOString(),
            database_integrity: 'not-audited' as const,
          };
        const summary = outboxRecordSummary(row, originalScope, now, trace);
        if (
          summary.payload_bytes > MAX_SYNC_BATCH_BYTES ||
          summary.source_refs_bytes > MAX_SYNC_BATCH_BYTES
        )
          throw reconciliationError(
            'OUTBOX_RECORD_TOO_LARGE',
            'The saved event exceeds the complete read limit; preserve the original queue',
            trace,
          );
        const event = checkedOriginalEvent(row, trace);
        if (event.event_id !== event_id)
          throw reconciliationError(
            'OUTBOX_RECORD_CORRUPT',
            'The selected event ID differs from the requested original',
            trace,
          );
        const result = {
          scope: originalScope,
          event,
          summary: { ...summary, original_content: 'validated' as const },
          original_content: 'validated' as const,
          observed_at: new Date(now).toISOString(),
          database_integrity: 'not-audited' as const,
        };
        try {
          syncJsonSnapshot(result, 2 * MAX_SYNC_BATCH_BYTES + 16384);
        } catch {
          throw reconciliationError(
            'OUTBOX_RECORD_TOO_LARGE',
            'The complete original result exceeds its read limit',
            trace,
          );
        }
        return result;
      },
      trace,
    );
  }

  /** Legacy diagnostic view; do not use its fallback content as an original event. */
  inspect(scope?: OutboxScope): LocalEvent[] {
    const rows =
      scope === undefined
        ? this.db.prepare('SELECT * FROM local_events ORDER BY rowid').all()
        : this.db
            .prepare(
              'SELECT * FROM local_events WHERE tenant_id = ? AND workspace_id = ? AND project_id = ? ORDER BY rowid',
            )
            .all(String(scope.tenant_id), String(scope.workspace_id), String(scope.project_id));
    return rows.map((row) => {
      try {
        return fromRow(row);
      } catch {
        return fromRow({
          ...row,
          payload: '{}',
          source_refs: '[]',
          expected_actor_id: null,
          expected_client_id: null,
          command_checksum: null,
          last_error: 'CORRUPT_RECORD',
        });
      }
    });
  }

  async drain(
    publish: (event: LocalEvent) => Promise<void> | void,
    now = new Date(),
    limit = 50,
  ): Promise<DrainResult> {
    const { events, token, corrupt } = this.claim(now, limit);
    const result: DrainResult = { sent: [], retried: [], failed: corrupt };
    for (const event of events) {
      let outcome: Settlement;
      try {
        if (!intact(event)) outcome = { status: 'failed', error: 'CHECKSUM_MISMATCH' };
        else {
          await publish(clone(event));
          outcome = { status: 'sent' };
        }
      } catch {
        outcome = { status: 'pending', error: 'DELIVERY_UNCONFIRMED' };
      }
      const status = this.settle(event, token, outcome, now);
      if (status)
        result[status === 'pending' ? 'retried' : status === 'sent' ? 'sent' : 'failed'].push(
          event.event_id,
        );
    }
    return result;
  }

  async drainBatch(scope: OutboxScope, publish: BatchPublisher, now = new Date(), limit = 50) {
    if (limit > 100) throw new RangeError('A batch can contain at most 100 events');
    const originalScope = { ...scope };
    const { events, token, corrupt } = this.claim(now, limit, originalScope);
    const outcomes = new Map<string, Settlement>();
    const batch: SyncUploadEvent[] = [];
    for (const event of events) {
      if (!isSyncIdentifier(event.event_id)) {
        outcomes.set(event.event_id, { status: 'failed', error: 'VALIDATION_ERROR' });
        continue;
      }
      if (!intact(event)) {
        outcomes.set(event.event_id, { status: 'failed', error: 'CHECKSUM_MISMATCH' });
        continue;
      }
      batch.push(uploadEvent(event));
    }
    if (batch.length) {
      try {
        const originalBatch = snapshotSyncUploadBatch(batch);
        const identity = parseSyncCommandIdentity(events[0]!.expected_identity);
        assertSyncIdentityScope(identity, originalScope);
        for (const event of events)
          assertSyncCommandIdentity(parseSyncCommandIdentity(event.expected_identity), identity);
        const receipt = await publish(
          { ...originalScope },
          snapshotSyncUploadBatch(originalBatch),
          token,
          { ...identity },
        );
        const deliveries = parseDeliveries(originalBatch, receipt);
        for (const [id, delivery] of deliveries) outcomes.set(id, delivery);
      } catch (error) {
        const envelope = error instanceof ContractError ? error.envelope : undefined;
        for (const event of batch)
          outcomes.set(event.event_id, {
            status: envelope && !envelope.retryable ? 'failed' : 'pending',
            error: envelope?.code ?? 'DELIVERY_UNCONFIRMED',
          });
      }
    }
    return this.transaction(() => {
      const result = {
        sent: [] as string[],
        retried: [] as string[],
        failed: corrupt,
        conflicts: [] as string[],
      };
      for (const event of events) {
        const status = this.settle(event, token, outcomes.get(event.event_id)!, now);
        if (status)
          result[
            status === 'pending' ? 'retried' : status === 'conflict' ? 'conflicts' : status
          ].push(event.event_id);
      }
      return result;
    });
  }

  private claim(now: Date, limit: number, scope?: OutboxScope) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new RangeError('Drain limit must be a positive integer');
    const token = randomUUID();
    const expires = new Date(now.getTime() + 120_000).toISOString();
    return this.transaction(() => {
      const gate = outboxClaimGuard(this.db, 'trace_outbox_claim_' + token);
      if (scope) gate.assertEnabled(scope);
      const filter = scope ? 'AND tenant_id = ? AND workspace_id = ? AND project_id = ?' : '';
      const rows = this.db
        .prepare(
          `SELECT * FROM local_events
        WHERE ((status IN ('pending', 'sending') AND next_retry_at <= ?) OR (status = 'sending' AND lease_token IS NULL))
        ${filter} ${gate.filter} ORDER BY rowid LIMIT ?`,
        )
        .all(
          now.toISOString(),
          ...(scope ? [scope.tenant_id, scope.workspace_id, scope.project_id] : []),
          limit,
        );
      const update = this.db.prepare(
        "UPDATE local_events SET status = 'sending', lease_token = ?, next_retry_at = ? WHERE event_id = ?",
      );
      const events: LocalEvent[] = [];
      const corrupt: string[] = [];
      const fail = this.db.prepare(
        "UPDATE local_events SET status = 'failed', last_error = ?, lease_token = NULL WHERE event_id = ?",
      );
      const overhead = Buffer.byteLength('{"events":[]}');
      let bytes = overhead;
      let batchIdentity: SyncCommandIdentity | undefined;
      for (const row of rows) {
        gate.assertEnabled({
          tenant_id: row.tenant_id,
          workspace_id: row.workspace_id,
          project_id: row.project_id,
        });
        let event: LocalEvent;
        try {
          event = fromRow(row);
        } catch {
          fail.run('CORRUPT_RECORD', row.event_id);
          corrupt.push(String(row.event_id));
          continue;
        }
        if (!event.expected_identity) {
          fail.run('OUTBOX_IDENTITY_REQUIRED', event.event_id);
          corrupt.push(event.event_id);
          continue;
        }
        if (!intact(event)) {
          fail.run('CHECKSUM_MISMATCH', event.event_id);
          corrupt.push(event.event_id);
          continue;
        }
        if (scope) {
          if (batchIdentity) {
            try {
              assertSyncCommandIdentity(event.expected_identity, batchIdentity);
            } catch {
              break;
            }
          } else batchIdentity = event.expected_identity;
          const size = Buffer.byteLength(JSON.stringify(uploadEvent(event)));
          if (size + overhead > MAX_SYNC_BATCH_BYTES) {
            fail.run('EVENT_TOO_LARGE', row.event_id);
            corrupt.push(event.event_id);
            continue;
          }
          const extra = size + (events.length ? 1 : 0);
          if (bytes + extra > MAX_SYNC_BATCH_BYTES) break;
          bytes += extra;
        }
        update.run(token, expires, event.event_id);
        events.push(event);
      }
      return { token, events, corrupt };
    });
  }

  private settle(event: LocalEvent, token: string, outcome: Settlement, now: Date) {
    const attempt =
      event.attempt + (outcome.status === 'pending' || outcome.status === 'failed' ? 1 : 0);
    const status = outcome.status === 'pending' && attempt >= 5 ? 'failed' : outcome.status;
    const next = new Date(
      now.getTime() + (status === 'pending' ? Math.min(60_000, 1_000 * 2 ** attempt) : 0),
    );
    const changed = this.db
      .prepare(
        `UPDATE local_events SET status = ?, attempt = ?, next_retry_at = ?, lease_token = NULL,
      last_error = ?, server_event_id = ?, server_cursor = ?, conflict_id = ?
      WHERE event_id = ? AND status = 'sending' AND lease_token = ?`,
      )
      .run(
        status,
        attempt,
        next.toISOString(),
        outcome.error ?? null,
        outcome.server_event_id ?? null,
        outcome.server_cursor ?? null,
        outcome.conflict_id ?? null,
        event.event_id,
        token,
      );
    return Number(changed.changes) ? status : undefined;
  }

  retry(event_id: string, trace_id: string, scope?: OutboxScope): LocalEvent {
    return this.transaction(() => {
      const filter = scope ? 'AND tenant_id = ? AND workspace_id = ? AND project_id = ?' : '';
      const select = this.db.prepare(`SELECT * FROM local_events WHERE event_id = ? ${filter}`);
      const args = scope
        ? [event_id, scope.tenant_id, scope.workspace_id, scope.project_id]
        : [event_id];
      const row = select.get(...args);
      if (!row)
        throw new ContractError('OUTBOX_EVENT_NOT_FOUND', 'Outbox event does not exist', {
          event_id,
          trace_id,
        });
      let event: LocalEvent;
      try {
        event = fromRow(row);
      } catch {
        throw new ContractError('CORRUPT_RECORD', 'Stored event cannot be decoded', {
          event_id,
          trace_id,
        });
      }
      if (event.status !== 'pending' && event.status !== 'failed') return event;
      if (!event.expected_identity)
        throw new ContractError(
          'OUTBOX_IDENTITY_REQUIRED',
          'The original sender is missing; preserve this legacy row for explicit recovery',
          { event_id, trace_id },
        );
      if (!intact(event))
        throw new ContractError('CHECKSUM_MISMATCH', 'Stored event payload has changed', {
          event_id,
          trace_id,
        });
      this.db
        .prepare(
          "UPDATE local_events SET status = 'pending', attempt = 0, last_error = NULL, next_retry_at = ? WHERE event_id = ? AND status IN ('pending', 'failed')",
        )
        .run(new Date(0).toISOString(), event_id);
      return fromRow(select.get(...args)!);
    });
  }

  /** Explicitly confirm one original against the gateway; never retries or binds legacy identities. */
  async reconcile(
    event_id: string,
    scope: OutboxScope,
    read: OutboxReceiptReader,
    options: OutboxReconcileOptions,
  ): Promise<OutboxReconcileResult> {
    const budget = reconciliationBudget(options);
    const trace = budget.trace;
    const fail = (code: string, message: string) => reconciliationError(code, message, trace);
    let verifiedReceipt: SyncEventReceiptEnvelope | undefined;
    const transaction: ReconciliationTransactionState = {
      settlement: 'not-committed',
      phase: 'not-started',
      rollback: 'not-needed',
    };
    try {
      const originalScope = { ...scope };
      if (
        !isSyncIdentifier(event_id) ||
        typeof read !== 'function' ||
        [originalScope.tenant_id, originalScope.workspace_id, originalScope.project_id].some(
          (id) => !isSyncIdentifier(id),
        )
      )
        throw fail('INVALID_INPUT', 'Supply one original event ID and its complete project scope');
      budget.check();
      const select = this.db.prepare(
        'SELECT rowid AS outbox_rowid, * FROM local_events WHERE event_id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ?',
      );
      const args = [
        event_id,
        originalScope.tenant_id,
        originalScope.workspace_id,
        originalScope.project_id,
      ];
      const before = select.get(...args);
      if (!before)
        throw fail(
          'OUTBOX_EVENT_NOT_FOUND',
          'The original event is unavailable in this local project',
        );
      const event = recoveryEvent(before, trace);
      const query = parseSyncEventReceiptQuery({
        identity: event.expected_identity,
        event: uploadEvent(event),
      });
      budget.check();
      let response: unknown;
      try {
        response = await budget.wait(() =>
          read(parseSyncEventReceiptQuery(query), {
            trace_id: trace,
            timeout_ms: budget.timeout,
            signal: budget.signal,
          }),
        );
      } catch (error) {
        budget.check();
        const code =
          error instanceof ContractError && error.envelope.trace_id === trace
            ? error.envelope.code
            : undefined;
        throw new ContractError(
          'OUTBOX_RECEIPT_UNAVAILABLE',
          'The original delivery could not be confirmed; this reconciliation did not change the local event',
          {
            trace_id: trace,
            retryable: false,
            ...([
              'DENIED',
              'UNAUTHENTICATED',
              'NOT_FOUND',
              'EVENT_ID_REUSED',
              'SYNC_EVENT_RECEIPT_INVALID',
              'SYNC_STORAGE_UNAVAILABLE',
              'WORKBENCH_AUTH_UNAVAILABLE',
              'AUDIT_PERSISTENCE_UNAVAILABLE',
              'RATE_LIMITED',
              'GATEWAY_REQUEST_CANCELED',
              'GATEWAY_REQUEST_TIMEOUT',
              'GATEWAY_RESPONSE_INVALID',
              'GATEWAY_UNAVAILABLE',
            ].includes(code ?? '')
              ? { receipt_code: code }
              : {}),
          },
        );
      }
      budget.check();
      let receipt: SyncEventReceiptEnvelope;
      try {
        receipt = parseSyncEventReceiptEnvelope(response, query, trace);
        verifiedReceipt = receipt;
      } catch {
        budget.check();
        throw fail(
          'OUTBOX_RECEIPT_INVALID',
          'The complete receipt did not match the saved original; the local event was not changed',
        );
      }
      budget.check();
      return reconciliationTransaction(
        (sql) => this.db.exec(sql),
        () => {
          budget.check();
          const current = select.get(...args);
          if (!current || !isDeepStrictEqual(current, before))
            throw fail(
              'OUTBOX_EVENT_CHANGED',
              'The local row changed while its receipt was being read; inspect it before reconciling again',
            );
          const local = recoveryEvent(current, trace);
          budget.check();
          const unchanged = (
            action: OutboxReconcileResult['local']['action'],
          ): OutboxReconcileResult => ({
            receipt,
            local: { event_id, status: local.status, action },
          });
          if (receipt.data.status === 'not-observed') return unchanged('unchanged');
          const recorded = receipt.data.receipt;
          const status = recorded.accepted ? 'sent' : 'conflict';
          if (
            (local.status === 'sent' && status !== 'sent') ||
            (local.status === 'conflict' && status !== 'conflict') ||
            (local.server_event_id !== undefined &&
              local.server_event_id !== recorded.server_event_id) ||
            (local.server_cursor !== undefined && local.server_cursor !== recorded.server_cursor) ||
            (local.conflict_id !== undefined && local.conflict_id !== recorded.conflict_id)
          )
            throw fail(
              'OUTBOX_RECEIPT_CONFLICT',
              'Existing local delivery evidence differs from the original receipt; preserve both for investigation',
            );
          if (
            local.status === status &&
            local.server_event_id === recorded.server_event_id &&
            local.server_cursor === recorded.server_cursor &&
            local.conflict_id === recorded.conflict_id
          )
            return unchanged('already-settled');
          budget.check();
          const changed = this.db
            .prepare(
              `UPDATE local_events SET status = ?, server_event_id = ?, server_cursor = ?, conflict_id = ?,
          last_error = ?, lease_token = NULL WHERE rowid = ? AND event_id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ?`,
            )
            .run(
              status,
              recorded.server_event_id,
              recorded.server_cursor,
              recorded.conflict_id ?? null,
              recorded.accepted ? null : 'VERSION_CONFLICT',
              current.outbox_rowid!,
              ...args,
            );
          if (Number(changed.changes) !== 1)
            throw fail(
              'OUTBOX_EVENT_CHANGED',
              'The original row could not be settled; inspect its current state',
            );
          // A deadline before COMMIT rolls back. Do not report a timeout after a successful COMMIT.
          budget.check();
          return {
            receipt,
            local: { event_id, status, action: 'settled' },
          } satisfies OutboxReconcileResult;
        },
        transaction,
        trace,
        budget.check,
      );
    } catch (error) {
      const failure =
        error instanceof ContractError
          ? error
          : fail(
              'OUTBOX_STORAGE_UNAVAILABLE',
              'Local reconciliation could not be confirmed; inspect the original row before continuing',
            );
      if (!verifiedReceipt) throw failure;
      const reconciliation: OutboxReconcileFailure = {
        receipt: verifiedReceipt,
        local: { event_id, settlement: transaction.settlement },
        transaction: { phase: transaction.phase, rollback: transaction.rollback },
      };
      throw new ContractError(failure.envelope.code, failure.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: { ...failure.envelope.details, reconciliation },
      });
    } finally {
      budget.close();
    }
  }

  purge(scope: OutboxScope, include_sent = false): number {
    const result = this.db
      .prepare(
        `DELETE FROM local_events WHERE tenant_id = ? AND workspace_id = ? AND project_id = ? ${include_sent ? '' : "AND status = 'sent'"}`,
      )
      .run(String(scope.tenant_id), String(scope.workspace_id), String(scope.project_id));
    return Number(result.changes);
  }

  close(): void {
    this.db.close();
  }

  private findByIdempotency(key: string): LocalEvent | undefined {
    const row = this.db.prepare('SELECT * FROM local_events WHERE idempotency_key = ?').get(key);
    return row === undefined ? undefined : fromRow(row);
  }
}

function recoveryEvent(row: Record<string, unknown>, trace: string): LocalEvent {
  const event = checkedOriginalEvent(row, trace);
  if (event.status === 'sending' && Date.parse(event.next_retry_at) > Date.now())
    throw reconciliationError(
      'OUTBOX_EVENT_BUSY',
      'The original event has an active send lease; wait for that sender before reconciling',
      trace,
    );
  return event;
}

function clone(event: LocalEvent): LocalEvent {
  return structuredClone(event);
}

function parseDeliveries(
  events: SyncUploadEvent[],
  input: SyncUploadResult,
): Map<string, Settlement> {
  const receipt = parseSyncUploadResult(input, events);
  const pending = new Set(events.map((event) => event.event_id));
  const result = new Map<string, Settlement>();
  for (const row of [...receipt.accepted, ...receipt.rejected]) {
    if (!pending.delete(row.event_id)) throw new Error('Unexpected event in sync receipt');
    if (row.accepted === true || row.code === 'VERSION_CONFLICT') {
      if (
        typeof row.server_event_id !== 'string' ||
        !row.server_event_id ||
        !Number.isSafeInteger(row.server_cursor) ||
        row.server_cursor! < 1 ||
        row.server_cursor! > receipt.next_cursor
      )
        throw new Error('Missing durable sync receipt');
      const saved = { server_event_id: row.server_event_id, server_cursor: row.server_cursor! };
      if (row.accepted === true) result.set(row.event_id, { ...saved, status: 'sent' });
      else {
        if (typeof row.conflict_id !== 'string' || !row.conflict_id)
          throw new Error('Missing conflict ID');
        result.set(row.event_id, {
          ...saved,
          status: 'conflict',
          conflict_id: row.conflict_id,
          error: row.code,
        });
      }
    } else if (row.code === 'CURSOR_GAP')
      result.set(row.event_id, { status: 'pending', error: row.code });
    else if (['VALIDATION_ERROR', 'EVENT_ID_REUSED', 'SOURCE_UNAVAILABLE'].includes(row.code))
      result.set(row.event_id, { status: 'failed', error: row.code });
    else throw new Error('Unrecognized sync receipt');
  }
  if (pending.size) throw new Error('Incomplete sync receipt');
  return result;
}
