import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  JetStreamEventBus,
  eventBusName,
  EVENT_BUS_MAX_BYTES,
  parseEventBusMessage,
  type JetStreamEventBusOptions,
  type EventConsumerOptions,
  type EventDelivery,
} from '@planemem/events/jetstream';
import { syncJsonSnapshot } from '@planemem/contracts';
import type { RuntimeSql } from './runtime-persistence.js';

export interface DurableEventConsumer extends EventConsumerOptions {
  /** Read-only schema preflight, before opening NATS. Must not apply migrations. */
  checkStorage?(db: RuntimeSql): Promise<void>;
  /** Only database effects using tx belong here. The receipt commits with these effects. */
  handle(delivery: EventDelivery, tx: RuntimeSql, signal: AbortSignal): Promise<void>;
}
export interface PlatformEventBusOptions extends JetStreamEventBusOptions {
  consumers?: readonly DurableEventConsumer[];
}
type ConsumerHandle = Awaited<ReturnType<JetStreamEventBus['consumer']>>;
type BusMetrics = Awaited<ReturnType<JetStreamEventBus['metrics']>>;
type Sample = {
  at: number;
  pending: string;
  rejected: string;
  quarantined: string;
  oldest: number;
  bus: BusMetrics;
};
export class EventBusDeliveryRejected extends Error {
  constructor(readonly code: 'EVENT_BUS_ID_CONFLICT' | 'EVENT_BUS_PAYLOAD_INVALID') {
    super(code);
  }
}

/** One independently pooled worker per gateway; PostgreSQL locks coordinate competing replicas. */
export class PostgresEventBus {
  private bus: JetStreamEventBus | undefined;
  private initialization: Promise<void> | undefined;
  private consumers: Array<{ definition: DurableEventConsumer; handle: ConsumerHandle }> = [];
  private readonly definitions: DurableEventConsumer[];
  private readonly controller = new AbortController();
  private tasks: Promise<void>[] = [];
  private started = false;
  private sample: Sample | undefined;
  private publisherHealthy = false;
  private publicationUnconfirmed = false;
  private readonly consumerHealthy = new Map<string, boolean>();
  private published = 0;
  private applied = 0;
  private failed = 0;

  constructor(
    private readonly db: RuntimeSql,
    private readonly options: PlatformEventBusOptions,
  ) {
    this.definitions = (options.consumers ?? []).map((entry) => {
      const name = eventBusName(entry.name);
      if (typeof entry.handle !== 'function') throw new TypeError('Invalid durable event handler');
      if (entry.checkStorage !== undefined && typeof entry.checkStorage !== 'function')
        throw new TypeError('Invalid consumer storage check');
      return { ...entry, name };
    });
    if (
      this.definitions.length > 16 ||
      new Set(this.definitions.map((entry) => entry.name)).size !== this.definitions.length
    )
      throw new TypeError('Supply up to 16 distinct durable consumers');
    for (const entry of this.definitions) this.consumerHealthy.set(entry.name, false);
  }
  async initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce();
    try {
      await this.initialization;
    } catch (error) {
      this.initialization = undefined;
      throw error;
    }
  }
  private async initializeOnce(): Promise<void> {
    if (this.bus) return;
    if (this.controller.signal.aborted) throw new Error('Event bus has stopped');
    await this
      .db`SELECT stream_name, subject_prefix, stream_created FROM wcp_event_bus_bindings LIMIT 0`;
    await this
      .db`SELECT event_id, event_body, aggregate_key, ordinal, state, attempts, next_attempt_at,
      last_error_code, stream_name, stream_sequence, published_at FROM wcp_event_bus_outbox LIMIT 0`;
    await this
      .db`SELECT consumer_name, event_id, event_body, stream_name, stream_sequence FROM wcp_event_bus_consumptions LIMIT 0`;
    await this
      .db`SELECT consumer_name, stream_name, stream_sequence, subject, body, body_sha256, body_bytes, reason FROM wcp_event_bus_rejections LIMIT 0`;
    for (const definition of this.definitions) await definition.checkStorage?.(this.db);
    const bus = await JetStreamEventBus.open(this.options);
    try {
      const binding = await this
        .db`INSERT INTO wcp_event_bus_bindings (stream_name, subject_prefix, stream_created)
        VALUES (${bus.stream}, ${bus.prefix}, ${bus.created})
        ON CONFLICT (stream_name) DO UPDATE SET stream_name = EXCLUDED.stream_name
          WHERE wcp_event_bus_bindings.subject_prefix = EXCLUDED.subject_prefix
            AND wcp_event_bus_bindings.stream_created = EXCLUDED.stream_created
        RETURNING stream_name`;
      if (binding.length !== 1)
        throw new Error('Event stream was replaced; explicit recovery is required');
      const consumers = [];
      for (const definition of this.definitions)
        consumers.push({ definition, handle: await bus.consumer(definition) });
      if (this.controller.signal.aborted) throw new Error('Event bus has stopped');
      this.consumers = consumers;
      this.bus = bus;
    } catch (error) {
      await bus.close();
      throw error;
    }
  }
  start(): void {
    if (this.started) return;
    if (!this.bus || this.controller.signal.aborted)
      throw new Error('Event bus is not initialized or has stopped');
    this.started = true;
    this.tasks = [
      this.relayLoop(),
      this.sampleLoop(),
      ...this.consumers.map((entry) => this.consumerLoop(entry)),
    ];
  }
  async stop(): Promise<void> {
    this.controller.abort();
    await this.initialization?.catch(() => undefined);
    await Promise.allSettled(this.tasks);
    await this.bus?.close();
    this.started = false;
    this.publisherHealthy = false;
  }
  health() {
    const fresh =
      this.started &&
      !this.controller.signal.aborted &&
      this.sample !== undefined &&
      performance.now() - this.sample.at < 90_000;
    return {
      enabled: true,
      ready:
        this.started &&
        !this.controller.signal.aborted &&
        this.bus?.connected() === true &&
        fresh &&
        this.publisherHealthy &&
        [...this.consumerHealthy.values()].every(Boolean) &&
        this.sample?.rejected === '0' &&
        this.sample?.quarantined === '0',
      publishing: this.publisherHealthy,
      configured_consumers: this.definitions.length,
      snapshot_fresh: fresh,
    };
  }
  render(): string {
    const lines: string[] = [];
    const metric = (name: string, value: number | string) =>
      lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
    metric('planemem_event_bus_enabled', 1);
    metric('planemem_event_bus_ready', this.health().ready ? 1 : 0);
    metric('planemem_event_bus_publish_receipts', this.published);
    metric('planemem_event_bus_consume_receipts', this.applied);
    metric('planemem_event_bus_worker_failures', this.failed);
    metric('planemem_event_bus_snapshot_fresh', this.health().snapshot_fresh ? 1 : 0);
    if (this.health().snapshot_fresh && this.sample) {
      metric('planemem_event_bus_outbox_pending', this.sample.pending);
      metric('planemem_event_bus_outbox_rejected', this.sample.rejected);
      metric('planemem_event_bus_quarantined_messages', this.sample.quarantined);
      metric('planemem_event_bus_oldest_pending_timestamp_seconds', this.sample.oldest);
      metric('planemem_event_bus_stream_messages', this.sample.bus.messages);
      metric('planemem_event_bus_stream_bytes', this.sample.bus.bytes);
      lines.push(
        '# TYPE planemem_event_bus_consumer_pending gauge',
        '# TYPE planemem_event_bus_consumer_unacknowledged gauge',
      );
      for (const row of this.sample.bus.consumers) {
        lines.push(
          `planemem_event_bus_consumer_pending{consumer="${row.name}"} ${row.pending}`,
          `planemem_event_bus_consumer_unacknowledged{consumer="${row.name}"} ${row.unacknowledged}`,
        );
      }
    }
    return lines.join('\n') + '\n';
  }
  private async pause(milliseconds: number): Promise<void> {
    try {
      await delay(milliseconds, undefined, { signal: this.controller.signal });
    } catch {
      if (!this.controller.signal.aborted) throw new Error('Event bus waiting failed');
    }
  }
  private async relayLoop(): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        const sent = await this.relayOne();
        this.publisherHealthy = !this.publicationUnconfirmed;
        if (!sent) await this.pause(1000);
      } catch {
        this.publisherHealthy = false;
        this.failed++;
        await this.pause(1000);
      }
    }
  }
  private async relayOne(): Promise<boolean> {
    return (await this.db.begin(async (transaction) => {
      const tx = transaction as unknown as RuntimeSql;
      await tx`SET LOCAL lock_timeout = '3s'`;
      await tx`SET LOCAL statement_timeout = '15s'`;
      const [row] = await tx<{ event_id: string; event_body: unknown; attempts: number }[]>`
        SELECT o.event_id, o.event_body, o.attempts FROM wcp_event_bus_outbox o
        WHERE o.state = 'pending' AND o.next_attempt_at <= statement_timestamp()
          AND NOT EXISTS (SELECT 1 FROM wcp_event_bus_outbox p
            WHERE p.aggregate_key = o.aggregate_key AND p.ordinal < o.ordinal AND p.state <> 'published')
        ORDER BY o.ordinal LIMIT 1 FOR UPDATE OF o SKIP LOCKED`;
      if (!row) return false;
      let event;
      try {
        event = parseEventBusMessage(row.event_body);
      } catch {
        await tx`UPDATE wcp_event_bus_outbox SET state = 'rejected', last_error_code = 'EVENT_BUS_EVENT_INVALID'
          WHERE event_id = ${row.event_id}`;
        return true;
      }
      // Hold the selected row lock through the bounded publish. A lost DB commit repeats the same ID.
      try {
        const receipt = await this.bus!.publish(event);
        await tx`UPDATE wcp_event_bus_outbox SET state = 'published', stream_name = ${receipt.stream},
          stream_sequence = ${receipt.sequence}, published_at = clock_timestamp(), last_error_code = NULL,
          attempts = LEAST(attempts::bigint + 1, 2147483647)::integer WHERE event_id = ${row.event_id}`;
        this.published++;
        this.publicationUnconfirmed = false;
      } catch {
        const retrySeconds = Math.min(60, 2 ** Math.min(row.attempts, 6));
        await tx`UPDATE wcp_event_bus_outbox SET attempts = LEAST(attempts::bigint + 1, 2147483647)::integer,
          next_attempt_at = clock_timestamp() + ${retrySeconds} * interval '1 second',
          last_error_code = 'EVENT_BUS_PUBLISH_UNCONFIRMED' WHERE event_id = ${row.event_id}`;
        this.failed++;
        this.publicationUnconfirmed = true;
      }
      return true;
    })) as boolean;
  }
  private async consumerLoop(entry: {
    definition: DurableEventConsumer;
    handle: ConsumerHandle;
  }): Promise<void> {
    const { definition, handle } = entry;
    while (!this.controller.signal.aborted) {
      try {
        const message = await handle.next({ expires: 1000 });
        if (!message) {
          this.consumerHealthy.set(definition.name, true);
          continue;
        }
        const progress = setInterval(() => {
          try {
            message.working();
          } catch {
            /* The committed receipt still controls redelivery. */
          }
        }, 10_000);
        progress.unref();
        try {
          let delivery: EventDelivery;
          try {
            delivery = this.bus!.decode(message);
          } catch {
            await this.reject(definition.name, message, 'EVENT_BUS_MESSAGE_INVALID');
            message.term('Retained in the durable rejection ledger');
            this.consumerHealthy.set(definition.name, false);
            continue;
          }
          try {
            await this.apply(definition, delivery);
          } catch (error) {
            if (!(error instanceof EventBusDeliveryRejected)) throw error;
            await this.reject(definition.name, message, error.code);
            message.term('Retained in the durable rejection ledger');
            this.consumerHealthy.set(definition.name, false);
            continue;
          }
          // Double ACK after the database commit; timeout means unknown ACK, not permission to repeat effects.
          if (!(await message.ackAck({ timeout: 5000 })))
            throw new Error('Event acknowledgement is unconfirmed');
          this.consumerHealthy.set(definition.name, true);
        } catch {
          try {
            message.nak(1000);
          } catch {
            /* ACK timeout/redelivery recovers from the durable receipt. */
          }
          this.consumerHealthy.set(definition.name, false);
          this.failed++;
          await this.pause(1000);
        } finally {
          clearInterval(progress);
        }
      } catch {
        this.consumerHealthy.set(definition.name, false);
        this.failed++;
        await this.pause(1000);
      }
    }
  }
  private async apply(definition: DurableEventConsumer, delivery: EventDelivery): Promise<void> {
    const body = syncJsonSnapshot(delivery.event, EVENT_BUS_MAX_BYTES);
    const original = parseEventBusMessage(JSON.parse(body));
    await this.db.begin(async (transaction) => {
      const tx = transaction as unknown as RuntimeSql;
      await tx`SET LOCAL lock_timeout = '3s'`;
      await tx`SET LOCAL statement_timeout = '20s'`;
      const lock = JSON.stringify(['event-bus', definition.name, original.event_id]);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
      const [receipt] = await tx<{ same: boolean }[]>`SELECT event_body = ${body}::jsonb AS same
        FROM wcp_event_bus_consumptions WHERE consumer_name = ${definition.name} AND event_id = ${original.event_id}`;
      if (receipt) {
        if (!receipt.same) throw new EventBusDeliveryRejected('EVENT_BUS_ID_CONFLICT');
        return;
      }
      await definition.handle(
        { ...delivery, event: parseEventBusMessage(JSON.parse(body)) },
        tx,
        this.controller.signal,
      );
      await tx`INSERT INTO wcp_event_bus_consumptions
        (consumer_name, event_id, tenant_id, workspace_id, project_id, event_body, stream_name, stream_sequence)
        VALUES (${definition.name}, ${original.event_id}, ${original.tenant_id}, ${original.workspace_id},
          ${original.project_id ?? null}, ${body}::jsonb, ${delivery.stream}, ${delivery.sequence})`;
    });
    this.applied++;
  }
  private async reject(
    name: string,
    message: NonNullable<Awaited<ReturnType<ConsumerHandle['next']>>>,
    reason: string,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(message.seq) ||
      message.seq < 1 ||
      message.info.stream !== this.bus!.stream
    )
      throw new Error('Cannot retain an unverifiable stream position');
    const bytes = message.data;
    await this.db`INSERT INTO wcp_event_bus_rejections
      (consumer_name, stream_name, stream_sequence, subject, body, body_sha256, body_bytes, reason)
      VALUES (${name}, ${this.bus!.stream}, ${message.seq}, ${message.subject},
        ${bytes.byteLength <= EVENT_BUS_MAX_BYTES ? Buffer.from(bytes) : null},
        ${createHash('sha256').update(bytes).digest('hex')}, ${bytes.byteLength}, ${reason})
      ON CONFLICT (consumer_name, stream_name, stream_sequence) DO NOTHING`;
  }
  private async sampleLoop(): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        const at = performance.now();
        const bus = await this.bus!.metrics(this.definitions.map((entry) => entry.name));
        const rows = await this.db.begin(async (transaction) => {
          const tx = transaction as unknown as RuntimeSql;
          await tx`SET TRANSACTION READ ONLY`;
          await tx`SET LOCAL lock_timeout = '1s'`;
          await tx`SET LOCAL statement_timeout = '5s'`;
          return tx<
            { pending: string; rejected: string; quarantined: string; oldest: string | null }[]
          >`
          SELECT (COUNT(*) FILTER (WHERE state = 'pending'))::text AS pending,
            (COUNT(*) FILTER (WHERE state = 'rejected'))::text AS rejected,
            (SELECT COUNT(*)::text FROM wcp_event_bus_rejections) AS quarantined,
            (EXTRACT(EPOCH FROM MIN(created_at) FILTER (WHERE state = 'pending')))::text AS oldest
          FROM wcp_event_bus_outbox`;
        });
        const row = rows[0];
        const oldest = Number(row?.oldest ?? 0);
        if (
          !row ||
          ![row.pending, row.rejected, row.quarantined].every((count) =>
            /^(0|[1-9][0-9]*)$/.test(count),
          ) ||
          !Number.isFinite(oldest) ||
          oldest < 0
        )
          throw new Error('Invalid queue metrics');
        this.sample = {
          at,
          pending: row.pending,
          rejected: row.rejected,
          quarantined: row.quarantined,
          oldest,
          bus,
        };
      } catch {
        this.sample = undefined;
        this.failed++;
      }
      await this.pause(30_000);
    }
  }
}
