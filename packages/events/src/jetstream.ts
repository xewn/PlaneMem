import {
  connect,
  headers,
  type NatsConnection,
  type NodeConnectionOptions,
} from '@nats-io/transport-node';
import {
  jetstream,
  jetstreamManager,
  AckPolicy,
  DeliverPolicy,
  DiscardPolicy,
  ReplayPolicy,
  RetentionPolicy,
  StorageType,
  type JetStreamClient,
  type JetStreamManager,
  type Consumer,
  type ConsumerConfig,
  type JsMsg,
} from '@nats-io/jetstream';
import { syncJsonSnapshot } from '@planemem/contracts';
import { validateEvent, type CanonicalEvent } from './envelope.js';

// Leave room for protocol headers within the default 1 MiB NATS server payload limit.
export const EVENT_BUS_MAX_BYTES = 1024 * 1024 - 4096;
export interface JetStreamEventBusOptions {
  connection: NodeConnectionOptions;
  stream: string;
  subject_prefix: string;
  replicas: 1 | 3;
  max_bytes: number;
}
export interface EventConsumerOptions {
  name: string;
  /** Must remain inside this bus's subject prefix. NATS account ACLs are still authoritative. */
  filter_subject?: string;
  /** Only for a new durable consumer. Existing consumers are never reset. */
  start_sequence?: number;
}
export interface EventDelivery {
  event: CanonicalEvent;
  stream: string;
  sequence: number;
  redelivered: boolean;
}
export function eventBusName(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value))
    throw new TypeError('Invalid event bus name');
  return value;
}
export function parseEventBusMessage(input: unknown): CanonicalEvent {
  const copy: unknown = JSON.parse(syncJsonSnapshot(input, EVENT_BUS_MAX_BYTES));
  const result = validateEvent(copy);
  if (!result.valid) throw new TypeError('Invalid canonical event');
  return result.event;
}
function missing(error: unknown): boolean {
  // nats.js v3 exposes HTTP-like status separately from its numeric JetStream error code.
  return (error as { status?: unknown } | null)?.status === 404;
}
function safeSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new TypeError('Invalid stream sequence');
  return value;
}

/** Node-only transport. Import through @planemem/events/jetstream, never the browser-safe root. */
export class JetStreamEventBus {
  private online = true;
  private constructor(
    private readonly nc: NatsConnection,
    private readonly js: JetStreamClient,
    private readonly manager: JetStreamManager,
    readonly stream: string,
    readonly prefix: string,
    readonly created: string,
  ) {
    void (async () => {
      for await (const status of nc.status()) {
        if (status.type === 'disconnect' || status.type === 'reconnecting') this.online = false;
        if (status.type === 'reconnect') this.online = true;
      }
      this.online = false;
    })().catch(() => {
      this.online = false;
    });
  }

  static async open(options: JetStreamEventBusOptions): Promise<JetStreamEventBus> {
    const servers = options.connection?.servers;
    if (
      !(typeof servers === 'string' && servers.trim()) &&
      !(
        Array.isArray(servers) &&
        servers.length > 0 &&
        servers.every((server) => typeof server === 'string' && server.trim())
      )
    )
      throw new TypeError('Explicit NATS servers are required');
    const stream = eventBusName(options.stream),
      prefix = options.subject_prefix;
    if (
      typeof prefix !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+){0,7}$/.test(prefix) ||
      prefix.length > 128 ||
      ![1, 3].includes(options.replicas) ||
      !Number.isSafeInteger(options.max_bytes) ||
      options.max_bytes < EVENT_BUS_MAX_BYTES
    )
      throw new TypeError('Invalid event bus configuration');
    const nc = await connect({
      ...options.connection,
      reconnect: true,
      maxReconnectAttempts: -1,
      timeout: 5000,
      waitOnFirstConnect: false,
      noEcho: false,
    });
    try {
      if (!nc.info || nc.info.max_payload < EVENT_BUS_MAX_BYTES + 4096)
        throw new Error('NATS server payload limit must be at least 1 MiB');
      const manager = await jetstreamManager(nc, { timeout: 5000 });
      let info;
      try {
        info = await manager.streams.info(stream);
      } catch (error) {
        if (!missing(error)) throw error;
        try {
          info = await manager.streams.add({
            name: stream,
            subjects: [prefix + '.>'],
            storage: StorageType.File,
            retention: RetentionPolicy.Limits,
            discard: DiscardPolicy.New,
            num_replicas: options.replicas,
            max_bytes: options.max_bytes,
            max_msgs: -1,
            max_msgs_per_subject: -1,
            max_age: 0,
            max_msg_size: EVENT_BUS_MAX_BYTES + 4096,
            duplicate_window: 120_000_000_000,
            deny_delete: true,
            deny_purge: true,
          });
        } catch {
          info = await manager.streams.info(stream);
        } // Concurrent creation is checked below.
      }
      const cfg = info.config;
      if (
        cfg.subjects?.length !== 1 ||
        cfg.subjects[0] !== prefix + '.>' ||
        cfg.storage !== StorageType.File ||
        cfg.retention !== RetentionPolicy.Limits ||
        cfg.discard !== DiscardPolicy.New ||
        cfg.num_replicas !== options.replicas ||
        cfg.max_bytes !== options.max_bytes ||
        cfg.max_msgs !== -1 ||
        cfg.max_msgs_per_subject !== -1 ||
        cfg.max_age !== 0 ||
        cfg.max_msg_size !== EVENT_BUS_MAX_BYTES + 4096 ||
        cfg.duplicate_window !== 120_000_000_000 ||
        !cfg.deny_delete ||
        !cfg.deny_purge ||
        cfg.sealed ||
        cfg.no_ack ||
        cfg.mirror ||
        (cfg.sources?.length ?? 0) > 0 ||
        cfg.republish
      )
        throw new Error(
          'Existing event stream configuration differs; explicit operator migration is required',
        );
      if (typeof info.created !== 'string' || !info.created)
        throw new Error('Missing stream creation identity');
      return new JetStreamEventBus(
        nc,
        jetstream(nc, { timeout: 5000 }),
        manager,
        stream,
        prefix,
        info.created,
      );
    } catch (error) {
      await nc.close();
      throw error;
    }
  }
  subject(event: CanonicalEvent): string {
    return [
      this.prefix,
      event.tenant_id,
      event.workspace_id,
      event.project_id ?? '_',
      event.event_type,
    ].join('.');
  }
  async publish(input: unknown) {
    const event = parseEventBusMessage(input);
    const data = new TextEncoder().encode(syncJsonSnapshot(event, EVENT_BUS_MAX_BYTES));
    const hdrs = headers();
    hdrs.set('Content-Type', 'application/json');
    const ack = await this.js.publish(this.subject(event), data, {
      msgID: event.event_id,
      headers: hdrs,
      expect: { streamName: this.stream },
      timeout: 5000,
      retries: 1,
    });
    if (ack.stream !== this.stream) throw new Error('Unexpected event stream receipt');
    return { stream: ack.stream, sequence: safeSequence(ack.seq), duplicate: ack.duplicate };
  }
  async consumer(options: EventConsumerOptions): Promise<Consumer> {
    const name = eventBusName(options.name);
    const filter = options.filter_subject ?? this.prefix + '.>';
    if (
      !filter.startsWith(this.prefix + '.') ||
      filter.length > 512 ||
      !filter
        .split('.')
        .every(
          (part, index, all) =>
            /^[A-Za-z0-9_-]+$/.test(part) ||
            part === '*' ||
            (part === '>' && index === all.length - 1),
        )
    )
      throw new TypeError('Invalid consumer filter');
    if (options.start_sequence !== undefined) safeSequence(options.start_sequence);
    const config: Partial<ConsumerConfig> = {
      durable_name: name,
      ack_policy: AckPolicy.Explicit,
      filter_subject: filter,
      deliver_policy:
        options.start_sequence === undefined ? DeliverPolicy.All : DeliverPolicy.StartSequence,
      ...(options.start_sequence === undefined ? {} : { opt_start_seq: options.start_sequence }),
      replay_policy: ReplayPolicy.Instant,
      max_deliver: -1,
      ack_wait: 60_000_000_000,
      max_ack_pending: 1,
      max_waiting: 16,
    };
    let info;
    try {
      info = await this.manager.consumers.info(this.stream, name);
    } catch (error) {
      if (!missing(error)) throw error;
      try {
        info = await this.manager.consumers.add(this.stream, config);
      } catch {
        info = await this.manager.consumers.info(this.stream, name);
      }
    }
    for (const field of Object.keys(config) as Array<keyof ConsumerConfig>) {
      if (info.config[field] !== config[field])
        throw new Error('Existing durable consumer configuration differs');
    }
    if (
      info.config.deliver_subject ||
      info.config.filter_subjects?.length ||
      info.config.headers_only ||
      info.config.inactive_threshold ||
      info.config.backoff?.length
    )
      throw new Error('Existing consumer has incompatible delivery settings');
    return this.js.consumers.get(this.stream, name);
  }
  decode(message: JsMsg): EventDelivery {
    if (
      message.data.byteLength > EVENT_BUS_MAX_BYTES ||
      message.info.stream !== this.stream ||
      message.headers?.get('Content-Type') !== 'application/json'
    )
      throw new TypeError('Invalid event delivery');
    const event = parseEventBusMessage(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(message.data)),
    );
    if (message.subject !== this.subject(event))
      throw new TypeError('Event subject does not match its scope');
    return {
      event,
      stream: this.stream,
      sequence: safeSequence(message.seq),
      redelivered: message.redelivered,
    };
  }
  async metrics(consumerNames: readonly string[]) {
    const stream = await this.manager.streams.info(this.stream);
    const consumers = await Promise.all(
      consumerNames.map(async (name) => {
        const info = await this.manager.consumers.info(this.stream, eventBusName(name));
        return {
          name,
          pending: info.num_pending,
          unacknowledged: info.num_ack_pending,
          redelivered: info.num_redelivered,
        };
      }),
    );
    if (
      ![
        stream.state.messages,
        stream.state.bytes,
        ...consumers.flatMap((row) => [row.pending, row.unacknowledged, row.redelivered]),
      ].every((value) => Number.isSafeInteger(value) && value >= 0)
    )
      throw new Error('Invalid JetStream counters');
    return { messages: stream.state.messages, bytes: stream.state.bytes, consumers };
  }
  connected(): boolean {
    return this.online && !this.nc.isClosed();
  }
  async ping(): Promise<void> {
    await this.nc.flush();
  }
  async close(): Promise<void> {
    await this.nc.close();
  }
}
