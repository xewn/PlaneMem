import { DatabaseSync } from 'node:sqlite';
import { ContractError, type SourceRef, type Ulid } from '@planemem/contracts';

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
  status: 'pending' | 'sending' | 'sent' | 'failed';
  trace_id: string;
  source_refs: SourceRef[];
}

export interface EnqueueInput extends OutboxScope {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  trace_id: string;
  source_refs?: SourceRef[];
}

export class SqliteOutbox {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
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
  }

  enqueueDurably(input: EnqueueInput): LocalEvent {
    const existing = this.findByIdempotency(input.idempotency_key);
    if (existing !== undefined) return existing;
    const event: LocalEvent = {
      schema_version: 1,
      ...input,
      source_refs: input.source_refs === undefined ? [] : [...input.source_refs],
      attempt: 0,
      next_retry_at: new Date(0).toISOString(),
      checksum: checksum(JSON.stringify(input.payload)),
      status: 'pending',
    };
    try {
      this.db
        .prepare(
          `INSERT INTO local_events (event_id,idempotency_key,tenant_id,workspace_id,project_id,event_type,payload,source_refs,attempt,next_retry_at,checksum,status,trace_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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

  inspect(scope?: OutboxScope): LocalEvent[] {
    const rows =
      scope === undefined
        ? this.db.prepare('SELECT * FROM local_events ORDER BY rowid').all()
        : this.db
            .prepare(
              'SELECT * FROM local_events WHERE tenant_id = ? AND workspace_id = ? AND project_id = ? ORDER BY rowid',
            )
            .all(String(scope.tenant_id), String(scope.workspace_id), String(scope.project_id));
    return rows.map((row) => fromRow(row));
  }

  async drain(
    publish: (event: LocalEvent) => Promise<void> | void,
    now = new Date(),
    limit = 50,
  ): Promise<{ sent: string[]; retried: string[]; failed: string[] }> {
    const due = this.inspect()
      .filter(
        (event) =>
          (event.status === 'pending' || event.status === 'failed') &&
          Date.parse(event.next_retry_at) <= now.getTime(),
      )
      .slice(0, limit);
    const result = { sent: [] as string[], retried: [] as string[], failed: [] as string[] };
    for (const event of due) {
      this.db
        .prepare('UPDATE local_events SET status = ? WHERE event_id = ?')
        .run('sending', event.event_id);
      try {
        await publish(event);
        this.db
          .prepare('UPDATE local_events SET status = ? WHERE event_id = ?')
          .run('sent', event.event_id);
        result.sent.push(event.event_id);
      } catch (error) {
        const attempt = event.attempt + 1;
        const terminal = attempt >= 5;
        const next = new Date(now.getTime() + Math.min(60_000, 1_000 * 2 ** attempt));
        this.db
          .prepare(
            'UPDATE local_events SET status = ?, attempt = ?, next_retry_at = ? WHERE event_id = ?',
          )
          .run(terminal ? 'failed' : 'pending', attempt, next.toISOString(), event.event_id);
        (terminal ? result.failed : result.retried).push(event.event_id);
      }
    }
    return result;
  }

  retry(event_id: string, trace_id: string): LocalEvent {
    const event = this.inspect().find((candidate) => candidate.event_id === event_id);
    if (!event)
      throw new ContractError('OUTBOX_EVENT_NOT_FOUND', 'Outbox event does not exist', {
        event_id,
        trace_id,
        retryable: false,
      });
    this.db
      .prepare('UPDATE local_events SET status = ?, next_retry_at = ? WHERE event_id = ?')
      .run('pending', new Date(0).toISOString(), event_id);
    return this.inspect().find((candidate) => candidate.event_id === event_id)!;
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

function fromRow(row: Record<string, unknown>): LocalEvent {
  return {
    schema_version: 1,
    event_id: String(row.event_id),
    idempotency_key: String(row.idempotency_key),
    tenant_id: String(row.tenant_id) as Ulid,
    workspace_id: String(row.workspace_id) as Ulid,
    project_id: String(row.project_id) as Ulid,
    event_type: String(row.event_type),
    payload: JSON.parse(String(row.payload)) as Record<string, unknown>,
    source_refs: JSON.parse(String(row.source_refs)) as SourceRef[],
    attempt: Number(row.attempt),
    next_retry_at: String(row.next_retry_at),
    checksum: String(row.checksum),
    status: String(row.status) as LocalEvent['status'],
    trace_id: String(row.trace_id),
  };
}

function clone(event: LocalEvent): LocalEvent {
  return { ...event, payload: { ...event.payload }, source_refs: [...event.source_refs] };
}

function checksum(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `sha256:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
