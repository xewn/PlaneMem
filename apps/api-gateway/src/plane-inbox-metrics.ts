import { performance } from 'node:perf_hooks';
import type { RuntimeSql } from './runtime-persistence.js';

const INTERVAL_MS = 30_000;
const MAX_SAMPLE_AGE_MS = 90_000;
const states = [
  'total',
  'pending',
  'applied',
  'rejected',
  'due',
  'delayed',
  'version_gap',
] as const;
const ageStates = ['pending', 'due', 'version_gap', 'rejected'] as const;
type State = (typeof states)[number];
type AgeState = (typeof ageStates)[number];

interface Snapshot {
  counts: Record<State, string>;
  oldestReceived: Record<AgeState, number>;
  checkedAt: number;
  startedAt: number;
}

interface WorkerMetrics {
  worker_running: boolean;
  status: 'ok' | 'degraded';
  last_poll_completed_timestamp_seconds: number;
}

/** Database-wide operational data. Enable only on an access-controlled metrics network. */
export class PostgresPlaneInboxMetrics {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  private sample: Snapshot | undefined;
  private lastCollectionSucceeded = false;
  private lastSuccessAt = 0;

  constructor(private readonly db: RuntimeSql) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.sample = undefined;
    this.lastCollectionSucceeded = false;
    this.lastSuccessAt = 0;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** Scrapes never perform database work or advance processing. */
  render(worker: WorkerMetrics): string {
    const lines: string[] = [];
    const gauge = (name: string, help: string, value: number) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`);
    };
    gauge(
      'planemem_plane_inbox_metrics_enabled',
      'Whether database-wide inbox metrics are enabled.',
      1,
    );
    gauge(
      'planemem_plane_inbox_collection_success',
      'Whether the last collection completed successfully; zero before the first success.',
      this.lastCollectionSucceeded ? 1 : 0,
    );
    gauge(
      'planemem_plane_inbox_last_success_timestamp_seconds',
      'Gateway time of the last successful collection; zero if none.',
      this.lastSuccessAt,
    );
    const sample = this.sample;
    const fresh =
      !this.stopped &&
      this.lastCollectionSucceeded &&
      sample !== undefined &&
      performance.now() - sample.startedAt <= MAX_SAMPLE_AGE_MS;
    gauge(
      'planemem_plane_inbox_snapshot_fresh',
      'Whether the successful snapshot is no more than 90 seconds old.',
      fresh ? 1 : 0,
    );
    gauge(
      'planemem_plane_inbox_worker_running',
      'Whether this gateway has enabled its inbox processing loop.',
      worker.worker_running ? 1 : 0,
    );
    gauge(
      'planemem_plane_inbox_worker_poll_failed',
      'Whether the last completed processing loop failed; not an event failure count.',
      worker.status === 'degraded' ? 1 : 0,
    );
    gauge(
      'planemem_plane_inbox_worker_last_poll_timestamp_seconds',
      'Gateway time of the last completed processing loop, successful or failed; zero if none.',
      worker.last_poll_completed_timestamp_seconds,
    );
    // Never preserve an old zero (or old backlog) as a current measurement after collection fails.
    if (fresh && sample) {
      gauge(
        'planemem_plane_inbox_snapshot_timestamp_seconds',
        'Database time of this queue snapshot.',
        sample.checkedAt,
      );
      lines.push(
        '# HELP planemem_plane_inbox_events Database-wide inbox rows. Due, delayed and version_gap overlap pending; do not sum states or gateway replicas.',
        '# TYPE planemem_plane_inbox_events gauge',
      );
      for (const state of states)
        lines.push(`planemem_plane_inbox_events{state="${state}"} ${sample.counts[state]}`);
      lines.push(
        '# HELP planemem_plane_inbox_oldest_received_timestamp_seconds Oldest receipt in the selected state; zero when empty. Version gaps describe the last recorded attempt.',
        '# TYPE planemem_plane_inbox_oldest_received_timestamp_seconds gauge',
      );
      for (const state of ageStates)
        lines.push(
          `planemem_plane_inbox_oldest_received_timestamp_seconds{state="${state}"} ${sample.oldestReceived[state]}`,
        );
    }
    return lines.join('\n') + '\n';
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.collect()
        .catch(() => {
          this.lastCollectionSucceeded = false;
        })
        .finally(() => {
          this.running = undefined;
          if (!this.stopped) this.schedule(INTERVAL_MS);
        });
    }, delay);
    this.timer.unref();
  }

  private async collect(): Promise<void> {
    const startedAt = performance.now();
    const rows = await this.db.begin(async (transaction) => {
      const tx = transaction as unknown as RuntimeSql;
      await tx`SET TRANSACTION READ ONLY`;
      await tx`SET LOCAL lock_timeout = '1s'`;
      await tx`SET LOCAL statement_timeout = '5s'`;
      return tx<Record<string, unknown>[]>`SELECT
        COUNT(*)::text AS total,
        (COUNT(*) FILTER (WHERE status = 'pending'))::text AS pending,
        (COUNT(*) FILTER (WHERE status = 'applied'))::text AS applied,
        (COUNT(*) FILTER (WHERE status = 'rejected'))::text AS rejected,
        (COUNT(*) FILTER (WHERE status = 'pending' AND next_attempt_at <= statement_timestamp()))::text AS due,
        (COUNT(*) FILTER (WHERE status = 'pending' AND next_attempt_at > statement_timestamp()))::text AS delayed,
        (COUNT(*) FILTER (WHERE status = 'pending' AND last_error_code = 'AGGREGATE_VERSION_GAP'))::text AS version_gap,
        MIN(received_at) FILTER (WHERE status = 'pending') AS oldest_pending,
        MIN(received_at) FILTER (WHERE status = 'pending' AND next_attempt_at <= statement_timestamp()) AS oldest_due,
        MIN(received_at) FILTER (WHERE status = 'pending' AND last_error_code = 'AGGREGATE_VERSION_GAP') AS oldest_version_gap,
        MIN(received_at) FILTER (WHERE status = 'rejected') AS oldest_rejected,
        statement_timestamp() AS checked_at
        FROM wcp_plane_event_inbox`;
    });
    if (rows.length !== 1) throw new Error('Expected one queue snapshot');
    const row = rows[0]!;
    const counts = {} as Record<State, string>;
    for (const state of states) {
      const value = row[state];
      if (
        typeof value !== 'string' ||
        !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
        BigInt(value) > 9223372036854775807n
      )
        throw new Error('Invalid queue count');
      counts[state] = value;
    }
    if (
      BigInt(counts.total) !==
        BigInt(counts.pending) + BigInt(counts.applied) + BigInt(counts.rejected) ||
      BigInt(counts.pending) !== BigInt(counts.due) + BigInt(counts.delayed) ||
      BigInt(counts.version_gap) > BigInt(counts.pending)
    )
      throw new Error('Inconsistent queue counts');
    const oldestReceived = {} as Record<AgeState, number>;
    for (const state of ageStates) {
      const raw = row[`oldest_${state}`];
      if ((counts[state] === '0') !== (raw === null))
        throw new Error('Inconsistent queue timestamp');
      oldestReceived[state] = raw === null ? 0 : timestampSeconds(raw);
    }
    this.sample = {
      counts,
      oldestReceived,
      checkedAt: timestampSeconds(row.checked_at),
      startedAt,
    };
    this.lastSuccessAt = Date.now() / 1000;
    this.lastCollectionSucceeded = true;
  }
}

function timestampSeconds(value: unknown): number {
  if (!(value instanceof Date) && typeof value !== 'string')
    throw new Error('Invalid queue timestamp');
  const parsed = new Date(value).getTime() / 1000;
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Invalid queue timestamp');
  return parsed;
}
