import {
  ContractError,
  createUlid,
  parseObservedRecordId,
  type ErrorEnvelope,
} from '@planemem/contracts';
import type { CanonicalEvent } from '@planemem/events';
import { buildPlaneObservedState } from '@planemem/plane-connector';
import type { SearchHit } from '@planemem/search-service';
import { fingerprint } from './idempotency.js';
import { persistPlaneEventInTransaction, type RuntimeSql } from './runtime-persistence.js';

type PlaneEvent = CanonicalEvent<Record<string, unknown>>;
export interface StoredPlaneInboxRow {
  event_id: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: string;
  event_document: unknown;
  event_fingerprint: string;
  status: 'pending' | 'applied' | 'rejected';
  last_error_code: string | null;
  revision: string;
}
type InboxRow = StoredPlaneInboxRow;
export interface PlaneDeliveryResult {
  status: 'accepted' | 'duplicate' | 'queued' | 'rejected';
  event_id: string;
  effect_applied: boolean;
  durable: true;
  error?: ErrorEnvelope;
}

/** No projection/search cache is advanced before the database commits. */
export class PostgresPlaneInbox {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  private pollFailed = false;
  private lastPollCompletedAt = 0;

  constructor(private readonly db: RuntimeSql) {}

  async initialize(): Promise<void> {
    // Missing migrations fail startup instead of accepting volatile deliveries.
    await this
      .db`SELECT i.event_id, i.event_document, i.next_attempt_at, i.revision, d.first_raw_hash
      FROM wcp_plane_event_inbox i LEFT JOIN wcp_plane_webhook_deliveries d ON d.event_id = i.event_id LIMIT 0`;
    await this.db`SELECT tenant_id, workspace_id, project_id, actor_id, client_id, request_key,
      event_id, request_fingerprint, event_fingerprint, receipt, trace_id FROM wcp_plane_inbox_retries LIMIT 0`;
    await this.db`SELECT deleted_at FROM wcp_projection_states LIMIT 0`;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  health() {
    return {
      durable: true as const,
      worker_running: !this.stopped,
      status: this.pollFailed ? ('degraded' as const) : ('ok' as const),
    };
  }

  monitoring() {
    return { ...this.health(), last_poll_completed_timestamp_seconds: this.lastPollCompletedAt };
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.drain()
        .then(
          () => {
            this.pollFailed = false;
            this.lastPollCompletedAt = Date.now() / 1000;
          },
          () => {
            this.pollFailed = true;
            this.lastPollCompletedAt = Date.now() / 1000;
          },
        )
        .finally(() => {
          this.running = undefined;
          if (!this.stopped) this.schedule(this.pollFailed ? 5_000 : 1_000);
        });
    }, delay);
    this.timer.unref();
  }

  private async drain(): Promise<void> {
    for (let count = 0; count < 25 && !this.stopped; count += 1) {
      if (!(await this.processOne())) break;
    }
  }

  async receive(
    input: PlaneEvent,
    deliveryId: string,
    rawHash: string,
  ): Promise<PlaneDeliveryResult> {
    const event = normalizeEvent(input);
    try {
      parseObservedRecordId(deliveryId);
      if (!/^[a-f0-9]{64}$/.test(rawHash)) throw new Error();
    } catch {
      throw new ContractError(
        'WEBHOOK_DELIVERY_INVALID',
        'Expected a valid delivery ID and verified body hash',
        { trace_id: event.trace_id },
      );
    }
    const projectId = event.project_id ?? event.aggregate_id;
    const eventFingerprint = fingerprint(event);
    const row = await this.db.begin(async (transaction) => {
      const tx = transaction as unknown as RuntimeSql;
      await tx`SET LOCAL lock_timeout = '3s'`;
      await tx`SET LOCAL statement_timeout = '15s'`;
      await tx`INSERT INTO wcp_plane_event_inbox
        (event_id, tenant_id, workspace_id, project_id, aggregate_type, aggregate_id, aggregate_version, event_document, event_fingerprint)
        VALUES (${event.event_id}, ${event.tenant_id}, ${event.workspace_id}, ${projectId}, ${event.aggregate_type},
          ${event.aggregate_id}, ${event.aggregate_version}, ${JSON.stringify(event)}::jsonb, ${eventFingerprint})
        ON CONFLICT (event_id) DO NOTHING`;
      const [existing] = await tx<
        InboxRow[]
      >`SELECT *, aggregate_version::text AS aggregate_version, revision::text AS revision
        FROM wcp_plane_event_inbox WHERE event_id = ${event.event_id} FOR UPDATE`;
      if (
        !existing ||
        existing.event_fingerprint !== eventFingerprint ||
        existing.tenant_id !== event.tenant_id ||
        existing.workspace_id !== event.workspace_id ||
        existing.project_id !== projectId
      ) {
        throw new ContractError(
          'PLANE_EVENT_ID_CONFLICT',
          'Event ID already belongs to a different observation',
          { trace_id: event.trace_id },
        );
      }
      readStoredPlaneInboxEvent(existing);
      await tx`INSERT INTO wcp_plane_webhook_deliveries
        (tenant_id, workspace_id, project_id, delivery_id, event_id, first_raw_hash)
        VALUES (${event.tenant_id}, ${event.workspace_id}, ${projectId}, ${deliveryId}, ${event.event_id}, ${rawHash})
        ON CONFLICT (tenant_id, workspace_id, project_id, delivery_id) DO NOTHING`;
      const [delivery] = await tx<
        { event_id: string }[]
      >`SELECT event_id FROM wcp_plane_webhook_deliveries
        WHERE tenant_id = ${event.tenant_id} AND workspace_id = ${event.workspace_id}
          AND project_id = ${projectId} AND delivery_id = ${deliveryId}`;
      if (delivery?.event_id !== event.event_id) {
        throw new ContractError(
          'WEBHOOK_DELIVERY_CONFLICT',
          'Delivery ID already belongs to another event',
          { trace_id: event.trace_id },
        );
      }
      return existing;
    });
    if (row.status !== 'pending') return resultFor(row);
    try {
      return (await this.processOne(event.event_id)) ?? resultFor(row);
    } catch {
      // The receive transaction already committed. A failed processing attempt
      // must not erase that durable receipt or claim the projection was applied.
      return resultFor(row);
    }
  }

  private async processOne(eventId?: string): Promise<PlaneDeliveryResult | undefined> {
    let selected: InboxRow | undefined;
    try {
      return await this.db.begin(async (transaction) => {
        const tx = transaction as unknown as RuntimeSql;
        await tx`SET LOCAL lock_timeout = '3s'`;
        await tx`SET LOCAL statement_timeout = '15s'`;
        const [row] = await tx<
          InboxRow[]
        >`SELECT *, aggregate_version::text AS aggregate_version, revision::text AS revision
          FROM wcp_plane_event_inbox
          WHERE status = 'pending' AND next_attempt_at <= clock_timestamp()
            AND (${eventId ?? null}::text IS NULL OR event_id = ${eventId ?? null})
          ORDER BY next_attempt_at, received_at, event_id LIMIT 1 FOR UPDATE SKIP LOCKED`;
        if (!row) return undefined;
        selected = row;
        const event = readStoredPlaneInboxEvent(row);
        const state = buildPlaneObservedState(event);
        const aggregateLock = JSON.stringify([
          'plane-aggregate',
          row.tenant_id,
          row.workspace_id,
          row.project_id,
          row.aggregate_type,
          row.aggregate_id,
        ]);
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${aggregateLock}, 0))`;
        // External IDs and aggregate IDs are both readable aliases. Lock both in
        // a stable order so concurrent aggregates cannot acquire the same alias.
        for (const alias of [...new Set([state.external_id, state.aggregate_id])].sort()) {
          const aliasLock = JSON.stringify([
            'plane-alias',
            row.tenant_id,
            row.workspace_id,
            row.project_id,
            state.entity_kind,
            alias,
          ]);
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${aliasLock}, 0))`;
        }
        const indexId = `plane:${state.entity_kind}:${state.external_id}`;
        const indexLock = JSON.stringify([
          'context-index',
          row.tenant_id,
          row.workspace_id,
          row.project_id,
          indexId,
        ]);
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${indexLock}, 0))`;

        // Old events lack the full canonical envelope. Compare every field that
        // was actually persisted; duplicates never rewrite their snapshot/index.
        const [stored] = await tx<{ matches: boolean }[]>`SELECT (
            event_type = ${event.event_type} AND schema_version = ${event.schema_version}
            AND tenant_id = ${event.tenant_id} AND workspace_id = ${event.workspace_id}
            AND project_id IS NOT DISTINCT FROM ${event.project_id ?? null}::text
            AND aggregate_type = ${event.aggregate_type} AND aggregate_id = ${event.aggregate_id}
            AND aggregate_version = ${event.aggregate_version} AND trace_id = ${event.trace_id}
            AND source_refs = ${JSON.stringify(event.source_refs)}::jsonb
            AND payload = ${JSON.stringify(event.payload)}::jsonb AND occurred_at = ${event.occurred_at}::timestamptz
          ) AS matches FROM wcp_events WHERE event_id = ${event.event_id}`;
        if (stored) {
          if (!stored.matches) return this.reject(tx, row, 'PLANE_EVENT_ID_CONFLICT', event);
          return this.finish(tx, row, event, false);
        }
        const latest = await tx<
          { aggregate_version: string; external_id: string; event_type: string; event_id: string }[]
        >`
          SELECT aggregate_version::text AS aggregate_version, COALESCE(payload->>'external_id', aggregate_id) AS external_id, event_type, event_id
          FROM wcp_events WHERE tenant_id = ${row.tenant_id} AND workspace_id = ${row.workspace_id}
            AND COALESCE(project_id, aggregate_id) = ${row.project_id} AND aggregate_type = ${row.aggregate_type}
            AND aggregate_id = ${row.aggregate_id}
            AND ((aggregate_type = 'project' AND event_type IN ('ProjectCreated', 'ProjectUpdated'))
              OR (aggregate_type = 'work_item' AND event_type IN ('WorkItemCreated', 'WorkItemUpdated', 'WorkItemStatusConfirmed', 'WorkItemDeleted', 'WorkItemRestored')))
          ORDER BY wcp_events.aggregate_version DESC, event_id LIMIT 2`;
        const last = latest[0];
        if (last && latest[1]?.aggregate_version === last.aggregate_version)
          return this.reject(tx, row, 'PLANE_STREAM_CONFLICT', event);
        if (last) {
          const version = BigInt(last.aggregate_version);
          const next = BigInt(event.aggregate_version);
          if (next <= version) return this.reject(tx, row, 'AGGREGATE_VERSION_OUT_OF_ORDER', event);
          if (
            last.event_type === 'WorkItemDeleted' &&
            event.event_type !== 'WorkItemDeleted' &&
            event.event_type !== 'WorkItemRestored'
          )
            return this.reject(tx, row, 'PLANE_RECORD_DELETED', event);
          if (next !== version + 1n) {
            await defer(tx, row.event_id, 'AGGREGATE_VERSION_GAP');
            return resultFor({ ...row, last_error_code: 'AGGREGATE_VERSION_GAP' });
          }
          if (
            state.restored_from &&
            (last.event_type !== 'WorkItemDeleted' ||
              last.event_id !== state.restored_from.event_id ||
              version !== BigInt(state.restored_from.aggregate_version) ||
              last.external_id !== state.external_id)
          )
            return this.reject(tx, row, 'PLANE_RESTORE_PRECONDITION_FAILED', event);
          if (last.external_id !== state.external_id)
            return this.reject(tx, row, 'PLANE_EXTERNAL_ID_CHANGED', event);
        } else {
          if (state.restored_from) {
            await defer(tx, row.event_id, 'AGGREGATE_VERSION_GAP');
            return resultFor({ ...row, last_error_code: 'AGGREGATE_VERSION_GAP' });
          }
          const [earlier] = await tx`SELECT event_id FROM wcp_plane_event_inbox
            WHERE tenant_id = ${row.tenant_id} AND workspace_id = ${row.workspace_id} AND project_id = ${row.project_id}
              AND aggregate_type = ${row.aggregate_type} AND aggregate_id = ${row.aggregate_id}
              AND aggregate_version < ${event.aggregate_version} LIMIT 1`;
          if (earlier) {
            await defer(tx, row.event_id, 'AGGREGATE_VERSION_GAP');
            return resultFor({ ...row, last_error_code: 'AGGREGATE_VERSION_GAP' });
          }
        }
        const owners = await tx<
          { aggregate_id: string | null; external_id: string }[]
        >`SELECT e.aggregate_id, s.external_id
          FROM wcp_projection_states s LEFT JOIN wcp_events e ON e.event_id = s.source_event_id
            AND e.tenant_id = s.tenant_id AND e.workspace_id = s.workspace_id
            AND COALESCE(e.project_id, e.aggregate_id) = s.project_id AND e.aggregate_type = ${event.aggregate_type}
          WHERE s.tenant_id = ${row.tenant_id} AND s.workspace_id = ${row.workspace_id} AND s.project_id = ${row.project_id}
            AND s.entity_kind = ${state.entity_kind} AND (s.external_id = ${state.external_id}
              OR s.external_id = ${state.aggregate_id} OR e.aggregate_id = ${state.external_id}
              OR e.aggregate_id = ${state.aggregate_id}) LIMIT 2`;
        if (
          owners.some(
            (owner) =>
              owner.aggregate_id !== event.aggregate_id || owner.external_id !== state.external_id,
          )
        )
          return this.reject(tx, row, 'PLANE_EXTERNAL_ID_CONFLICT', event);
        const title =
          state.deleted_at !== undefined
            ? 'Deleted Plane work item'
            : typeof event.payload.title === 'string' && event.payload.title.trim()
              ? event.payload.title
              : typeof event.payload.name === 'string' && event.payload.name.trim()
                ? event.payload.name
                : state.external_id;
        const hit: SearchHit = {
          schema_version: 1,
          tenant_id: row.tenant_id,
          workspace_id: row.workspace_id,
          project_id: row.project_id,
          id: indexId,
          title,
          snippet: state.deleted_at === undefined ? `${title} (${state.authority})` : '',
          revision: event.aggregate_version,
          score: 1,
          rank_source: 'fts',
          classification: event.sensitivity,
          source_refs: event.source_refs,
        };
        await persistPlaneEventInTransaction(tx, event, state, hit);
        return this.finish(tx, row, event, true);
      });
    } catch (error) {
      if (!selected) throw error;
      const row = selected;
      // The processing transaction (including all effects) has rolled back.
      // Record a retry or terminal conflict in a fresh transaction, conditional
      // on the same pending revision, including any intervening manual retry.
      return this.db.begin(async (transaction) => {
        const tx = transaction as unknown as RuntimeSql;
        await tx`SET LOCAL lock_timeout = '3s'`;
        await tx`SET LOCAL statement_timeout = '15s'`;
        const [current] = await tx<
          InboxRow[]
        >`SELECT *, aggregate_version::text AS aggregate_version, revision::text AS revision
          FROM wcp_plane_event_inbox WHERE event_id = ${row.event_id} FOR UPDATE`;
        if (!current) throw error;
        if (current.status !== 'pending' || current.revision !== row.revision)
          return resultFor(current);
        if (error instanceof ContractError && !error.envelope.retryable) {
          return this.reject(tx, current, error.envelope.code);
        }
        await defer(tx, current.event_id, 'PLANE_PROCESSING_RETRY');
        return resultFor({ ...current, last_error_code: 'PLANE_PROCESSING_RETRY' });
      });
    }
  }

  private async finish(
    tx: RuntimeSql,
    row: InboxRow,
    event: PlaneEvent,
    applied: boolean,
  ): Promise<PlaneDeliveryResult> {
    await tx`UPDATE wcp_plane_event_inbox SET status = 'applied', attempts = attempts + 1, revision = revision + 1,
      applied_at = clock_timestamp(), updated_at = clock_timestamp(), last_error_code = NULL
      WHERE event_id = ${row.event_id}`;
    await processingAudit(tx, row, applied ? 'accepted' : 'duplicate', null, event);
    return resultFor({ ...row, status: 'applied', last_error_code: null }, applied);
  }

  private async reject(
    tx: RuntimeSql,
    row: InboxRow,
    code: string,
    event?: PlaneEvent,
  ): Promise<PlaneDeliveryResult> {
    await tx`UPDATE wcp_plane_event_inbox SET status = 'rejected', attempts = attempts + 1, revision = revision + 1,
      updated_at = clock_timestamp(), last_error_code = ${code} WHERE event_id = ${row.event_id}`;
    await processingAudit(tx, row, 'rejected', code, event);
    return resultFor({ ...row, status: 'rejected', last_error_code: code });
  }
}

function normalizeEvent(event: PlaneEvent): PlaneEvent {
  try {
    const state = buildPlaneObservedState(event);
    return {
      ...structuredClone(event),
      occurred_at: state.observed_at,
      source_refs: state.source_refs,
    };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError('PLANE_EVENT_INVALID', 'Invalid Plane observation fields or sources', {
      trace_id: event.trace_id,
    });
  }
}

export function readStoredPlaneInboxEvent(row: StoredPlaneInboxRow): PlaneEvent {
  try {
    const event = normalizeEvent(row.event_document as PlaneEvent);
    if (
      event.event_id !== row.event_id ||
      event.tenant_id !== row.tenant_id ||
      event.workspace_id !== row.workspace_id ||
      (event.project_id ?? event.aggregate_id) !== row.project_id ||
      event.aggregate_type !== row.aggregate_type ||
      event.aggregate_id !== row.aggregate_id ||
      String(event.aggregate_version) !== row.aggregate_version ||
      fingerprint(event) !== row.event_fingerprint
    )
      throw new Error();
    return event;
  } catch {
    throw new ContractError('PLANE_INBOX_INVALID', 'Saved observation receipt is inconsistent', {
      trace_id: traceFor(row),
    });
  }
}

async function defer(tx: RuntimeSql, eventId: string, code: string): Promise<void> {
  await tx`UPDATE wcp_plane_event_inbox SET attempts = attempts + 1, revision = revision + 1,
    next_attempt_at = clock_timestamp() + LEAST(300, power(2, LEAST(attempts, 9))) * interval '1 second',
    last_error_code = ${code}, updated_at = clock_timestamp() WHERE event_id = ${eventId} AND status = 'pending'`;
}

async function processingAudit(
  tx: RuntimeSql,
  row: InboxRow,
  status: string,
  code: string | null,
  event?: PlaneEvent,
): Promise<void> {
  await tx`INSERT INTO wcp_audit_records
    (audit_id, tenant_id, workspace_id, project_id, actor_id, client_id, action, resource, result, classification, details, trace_id, source_refs, occurred_at)
    VALUES (${createUlid()}, ${row.tenant_id}, ${row.workspace_id}, ${row.project_id}, 'plane-inbox', 'plane',
      'plane.observation.process', ${`plane:${row.aggregate_type}:${row.aggregate_id}`}, ${status === 'rejected' ? 'error' : 'allowed'},
      ${event?.sensitivity ?? 'restricted'}, ${JSON.stringify({ event_id: row.event_id, status, code })}::jsonb,
      ${event?.trace_id ?? traceFor(row)}, ${JSON.stringify(event?.source_refs ?? [])}::jsonb, clock_timestamp())`;
}

function traceFor(row: InboxRow): string {
  const document = row.event_document;
  return document &&
    typeof document === 'object' &&
    'trace_id' in document &&
    typeof document.trace_id === 'string' &&
    document.trace_id
    ? document.trace_id
    : `trace_plane_${row.event_id}`;
}

function resultFor(row: InboxRow, applied = false): PlaneDeliveryResult {
  return {
    status:
      row.status === 'applied'
        ? applied
          ? 'accepted'
          : 'duplicate'
        : row.status === 'pending'
          ? 'queued'
          : 'rejected',
    event_id: row.event_id,
    effect_applied: row.status === 'applied' && applied,
    durable: true,
    ...(row.last_error_code
      ? {
          error: new ContractError(
            row.last_error_code,
            row.status === 'pending'
              ? 'Observation is saved and awaits processing'
              : 'Observation could not be applied',
            { trace_id: traceFor(row), retryable: row.status === 'pending' },
          ).envelope,
        }
      : {}),
  };
}
