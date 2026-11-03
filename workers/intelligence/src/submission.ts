import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  createUlid,
  isUlid,
  parseCreateProposal,
  validateIdempotencyKey,
  type CreateProposalRequest,
  type ProposalMutationReceipt,
} from '@planemem/contracts';
import { parseSubmissionReceipt } from './receipt.js';

export interface ProposalQueueBinding {
  gateway_url: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  client_id: string;
}
export interface ProposalQueueOptions {
  /** Inspect an existing v1 queue without creating it, changing its journal or initializing tables. */
  readonly?: boolean;
}
export type ProposalJobStatus = 'queued' | 'sending' | 'retry' | 'blocked' | 'submitted';
export interface ProposalJobSummary {
  job_id: string;
  idempotency_key: string;
  status: ProposalJobStatus;
  attempts: number;
  next_attempt_at: string;
  uncertain: boolean;
  error_code: string | null;
  trace_id: string | null;
  receipt: ProposalMutationReceipt | null;
  created_at: string;
}
type JobRow = {
  job_id: string;
  request_key: string;
  payload: string;
  payload_hash: string;
  status: ProposalJobStatus;
  attempts: number;
  next_attempt_ms: number;
  uncertain: number;
  error_code: string | null;
  trace_id: string | null;
  receipt: string | null;
  created_at: string;
  lease_token: string | null;
  lease_until_ms: number | null;
};
type SummaryRow = Omit<JobRow, 'payload' | 'payload_hash' | 'lease_token' | 'lease_until_ms'>;
export interface QuarantinedProposalJob {
  job_id: string;
  quarantined: true;
  error_code: 'PROPOSAL_QUEUE_CORRUPT';
}
export interface ClaimedProposalJob {
  job_id: string;
  idempotency_key: string;
  draft: ReturnType<typeof parseCreateProposal>;
  lease_token: string;
  attempts: number;
  uncertain: boolean;
}

export function normalizeQueueBinding(input: ProposalQueueBinding): ProposalQueueBinding {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          'gateway_url',
          'tenant_id',
          'workspace_id',
          'project_id',
          'actor_id',
          'client_id',
        ].includes(key),
    )
  )
    throw new TypeError(
      'Queue binding must contain only gateway, project scope and identity fields',
    );
  const url = new URL(input.gateway_url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new TypeError('gateway_url must be an HTTP(S) origin without credentials or a path');
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isUlid(input[field])) throw new TypeError(field + ' must be a ULID');
  for (const field of ['actor_id', 'client_id'] as const)
    if (typeof input[field] !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(input[field]))
      throw new TypeError(field + ' must contain 1-255 visible ASCII characters');
  return {
    gateway_url: url.origin,
    tenant_id: input.tenant_id,
    workspace_id: input.workspace_id,
    project_id: input.project_id,
    actor_id: input.actor_id,
    client_id: input.client_id,
  };
}

/** Durable, single-identity submission queue. It never generates or approves proposals. */
export class SqliteProposalQueue {
  readonly binding: Readonly<ProposalQueueBinding>;
  private readonly db: DatabaseSync;
  private readonly readOnly: boolean;

  constructor(path: string, binding: ProposalQueueBinding, options: ProposalQueueOptions = {}) {
    if (typeof path !== 'string' || !path.trim() || path === ':memory:')
      throw new TypeError('Use a persistent queue file');
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => key !== 'readonly') ||
      (options.readonly !== undefined && typeof options.readonly !== 'boolean')
    )
      throw new TypeError('Supply a boolean readonly queue option');
    this.readOnly = options.readonly === true;
    this.binding = Object.freeze(normalizeQueueBinding(binding));
    // query_only is defense in depth; the file must already be opened natively read-only.
    this.db = new DatabaseSync(path, { readOnly: this.readOnly });
    try {
      this.db.exec('PRAGMA busy_timeout = 5000');
      if (this.readOnly) {
        this.db.exec('PRAGMA query_only = ON');
        this.validateExistingQueue();
        return;
      }
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = FULL');
      this.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS proposal_queue_binding (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1), schema_version INTEGER NOT NULL, binding TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS proposal_jobs (
          job_id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE,
          payload TEXT NOT NULL, payload_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued','sending','retry','blocked','submitted')),
          attempts INTEGER NOT NULL DEFAULT 0, next_attempt_ms INTEGER NOT NULL,
          uncertain INTEGER NOT NULL DEFAULT 0, error_code TEXT, trace_id TEXT, receipt TEXT,
          created_at TEXT NOT NULL, lease_token TEXT, lease_until_ms INTEGER);
          CREATE INDEX IF NOT EXISTS proposal_jobs_due ON proposal_jobs(status, next_attempt_ms);`);
        const stored = this.db
          .prepare('SELECT schema_version, binding FROM proposal_queue_binding WHERE singleton = 1')
          .get();
        const serialized = JSON.stringify(this.binding);
        if (stored && (stored.schema_version !== 1 || stored.binding !== serialized))
          throw new ContractError(
            'PROPOSAL_QUEUE_BINDING_MISMATCH',
            'This queue belongs to another gateway, project or identity',
          );
        if (!stored)
          this.db.prepare('INSERT INTO proposal_queue_binding VALUES (1, 1, ?)').run(serialized);
      });
    } catch (error) {
      try {
        this.db.close();
      } catch {
        /* Preserve the original opening/schema/binding failure. */
      }
      throw error;
    }
  }

  enqueue(input: CreateProposalRequest, key: string): ProposalJobSummary {
    this.requireWritable();
    validateQueueKey(key);
    const payload = JSON.stringify(parseCreateProposal(input));
    const checksum = hash(payload);
    return this.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM proposal_jobs WHERE request_key = ?')
        .get(key) as unknown as JobRow | undefined;
      if (existing) {
        if (existing.payload_hash !== checksum || existing.payload !== payload)
          throw new ContractError(
            'IDEMPOTENCY_KEY_REUSED',
            'This queue key belongs to another proposal draft',
          );
        return summary(existing);
      }
      const id = createUlid();
      this.db
        .prepare(
          `INSERT INTO proposal_jobs
        (job_id,request_key,payload,payload_hash,status,next_attempt_ms,created_at)
        VALUES (?,?,?,?,'queued',?,?)`,
        )
        .run(id, key, payload, checksum, Date.now(), new Date().toISOString());
      return summary(this.row(id));
    });
  }

  list(options: { before?: string; limit?: number } = {}): {
    jobs: ProposalJobSummary[];
    next_before?: string;
  } {
    const limit = options.limit ?? 25;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (options.before !== undefined && !isUlid(options.before))
    )
      throw new TypeError('Use a ULID before cursor and limit between 1 and 100');
    const rows = this.db
      .prepare(
        `SELECT job_id,request_key,status,attempts,next_attempt_ms,uncertain,
      error_code,trace_id,receipt,created_at FROM proposal_jobs
      WHERE (? IS NULL OR job_id < ?) ORDER BY job_id DESC LIMIT ?`,
      )
      .all(options.before ?? null, options.before ?? null, limit + 1) as unknown as SummaryRow[];
    const jobs = rows.slice(0, limit).map(summary);
    return { jobs, ...(rows.length > limit ? { next_before: jobs[jobs.length - 1]!.job_id } : {}) };
  }

  get(id: string): ProposalJobSummary & { draft: ReturnType<typeof parseCreateProposal> } {
    const row = this.row(id);
    return { ...summary(row), draft: readDraft(row) };
  }

  retry(id: string): ProposalJobSummary {
    this.requireWritable();
    return this.transaction(() => {
      const row = this.row(id);
      if (row.status === 'submitted') return summary(row);
      if (row.status === 'sending' && (row.lease_until_ms ?? 0) > Date.now())
        throw new ContractError('PROPOSAL_JOB_BUSY', 'This submission is still leased by a worker');
      readDraft(row);
      this.db
        .prepare(
          `UPDATE proposal_jobs SET status = 'retry', next_attempt_ms = ?, lease_token = NULL,
        lease_until_ms = NULL, uncertain = CASE WHEN status = 'sending' THEN 1 ELSE uncertain END WHERE job_id = ?`,
        )
        .run(Date.now(), id);
      return summary(this.row(id));
    });
  }

  claim(dueBefore = Date.now()): ClaimedProposalJob | QuarantinedProposalJob | undefined {
    this.requireWritable();
    if (!Number.isSafeInteger(dueBefore) || dueBefore < 0)
      throw new TypeError('dueBefore must be a non-negative timestamp');
    return this.transaction<ClaimedProposalJob | QuarantinedProposalJob | undefined>(() => {
      const now = Date.now();
      const row = this.db
        .prepare(
          `SELECT * FROM proposal_jobs WHERE
        (status IN ('queued','retry') AND next_attempt_ms <= ?) OR (status = 'sending' AND lease_until_ms <= ?)
        ORDER BY next_attempt_ms, job_id LIMIT 1`,
        )
        .get(Math.min(now, dueBefore), Math.min(now, dueBefore)) as unknown as JobRow | undefined;
      if (!row) return undefined;
      let draft: ReturnType<typeof parseCreateProposal>;
      try {
        draft = readDraft(row);
      } catch {
        this.db
          .prepare(
            `UPDATE proposal_jobs SET
          uncertain = CASE WHEN status = 'sending' THEN 1 ELSE uncertain END,
          status = 'blocked', error_code = 'PROPOSAL_QUEUE_CORRUPT', lease_token = NULL,
          lease_until_ms = NULL WHERE job_id = ?`,
          )
          .run(row.job_id);
        // Commit quarantine so the corrupted draft is never sent or silently rewritten.
        return { job_id: row.job_id, quarantined: true, error_code: 'PROPOSAL_QUEUE_CORRUPT' };
      }
      const lease = randomUUID();
      this.db
        .prepare(
          `UPDATE proposal_jobs SET status = 'sending', attempts = attempts + 1,
        lease_token = ?, lease_until_ms = ?, uncertain = CASE WHEN status = 'sending' THEN 1 ELSE uncertain END
        WHERE job_id = ?`,
        )
        .run(lease, now + 60_000, row.job_id);
      return {
        job_id: row.job_id,
        idempotency_key: row.request_key,
        draft,
        lease_token: lease,
        attempts: row.attempts + 1,
        uncertain: row.uncertain === 1 || row.status === 'sending',
      };
    });
  }

  complete(job: ClaimedProposalJob, receipt: ProposalMutationReceipt, trace_id: string): boolean {
    this.requireWritable();
    const parsed = parseSubmissionReceipt(receipt);
    return (
      this.db
        .prepare(
          `UPDATE proposal_jobs SET status = 'submitted', receipt = ?, trace_id = ?,
      error_code = NULL, uncertain = 0, lease_token = NULL, lease_until_ms = NULL
      WHERE job_id = ? AND status = 'sending' AND lease_token = ?`,
        )
        .run(JSON.stringify(parsed), trace_id, job.job_id, job.lease_token).changes === 1
    );
  }

  fail(
    job: ClaimedProposalJob,
    error: { code: string; trace_id: string; retryable: boolean; uncertain: boolean },
  ): boolean {
    this.requireWritable();
    const delay = Math.min(3_600_000, 5_000 * 2 ** Math.min(job.attempts - 1, 10));
    return (
      this.db
        .prepare(
          `UPDATE proposal_jobs SET status = ?, next_attempt_ms = ?, error_code = ?, trace_id = ?,
      uncertain = ?, lease_token = NULL, lease_until_ms = NULL
      WHERE job_id = ? AND status = 'sending' AND lease_token = ?`,
        )
        .run(
          error.retryable ? 'retry' : 'blocked',
          Date.now() + delay,
          error.code,
          error.trace_id,
          job.uncertain || error.uncertain ? 1 : 0,
          job.job_id,
          job.lease_token,
        ).changes === 1
    );
  }

  close() {
    this.db.close();
  }
  private requireWritable() {
    if (this.readOnly)
      throw new ContractError(
        'PROPOSAL_QUEUE_READ_ONLY',
        'This proposal queue was opened for inspection only',
      );
  }
  private validateExistingQueue() {
    this.db.exec('BEGIN');
    try {
      const tables = this.db
        .prepare(
          "SELECT name, type FROM sqlite_schema WHERE name IN ('proposal_queue_binding', 'proposal_jobs')",
        )
        .all();
      if (tables.length !== 2 || tables.some((table) => table.type !== 'table'))
        throw new ContractError(
          'PROPOSAL_QUEUE_SCHEMA_INVALID',
          'An initialized v1 proposal queue is required',
        );
      // Prepare a zero-row read to check every v1 column without fetching job bodies or changing schema.
      this.db
        .prepare(
          `SELECT job_id, request_key, payload, payload_hash, status, attempts,
        next_attempt_ms, uncertain, error_code, trace_id, receipt, created_at, lease_token,
        lease_until_ms FROM proposal_jobs LIMIT 0`,
        )
        .all();
      const bindings = this.db
        .prepare(
          `SELECT singleton, schema_version,
        typeof(binding) AS binding_type, length(CAST(binding AS BLOB)) AS binding_bytes
        FROM proposal_queue_binding LIMIT 2`,
        )
        .all();
      const stored = bindings[0];
      if (
        bindings.length !== 1 ||
        !stored ||
        stored.singleton !== 1 ||
        stored.schema_version !== 1 ||
        stored.binding_type !== 'text' ||
        typeof stored.binding_bytes !== 'number' ||
        !Number.isSafeInteger(stored.binding_bytes) ||
        stored.binding_bytes < 1 ||
        stored.binding_bytes > 16 * 1024
      )
        throw new ContractError(
          'PROPOSAL_QUEUE_SCHEMA_INVALID',
          'The original v1 proposal queue binding is unavailable',
        );
      const binding = this.db
        .prepare('SELECT binding FROM proposal_queue_binding WHERE singleton = 1')
        .get();
      if (binding?.binding !== JSON.stringify(this.binding))
        throw new ContractError(
          'PROPOSAL_QUEUE_BINDING_MISMATCH',
          'This queue belongs to another gateway, project or identity',
        );
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* Preserve the read failure. */
      }
      throw error;
    }
  }
  private row(id: string): JobRow {
    if (!isUlid(id)) throw new TypeError('job_id must be a ULID');
    const row = this.db
      .prepare('SELECT * FROM proposal_jobs WHERE job_id = ?')
      .get(id) as unknown as JobRow | undefined;
    if (!row)
      throw new ContractError('PROPOSAL_JOB_NOT_FOUND', 'Proposal submission job is unavailable');
    return row;
  }
  private transaction<T>(run: () => T): T {
    this.requireWritable();
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
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function readDraft(row: JobRow): ReturnType<typeof parseCreateProposal> {
  if (hash(row.payload) !== row.payload_hash) throw new Error('Invalid payload checksum');
  validateQueueKey(row.request_key);
  const draft = parseCreateProposal(JSON.parse(row.payload));
  if (JSON.stringify(draft) !== row.payload)
    throw new Error('Stored draft no longer matches its schema');
  return draft;
}
function summary(row: SummaryRow): ProposalJobSummary {
  return {
    job_id: row.job_id,
    idempotency_key: row.request_key,
    status: row.status,
    attempts: row.attempts,
    next_attempt_at: new Date(row.next_attempt_ms).toISOString(),
    uncertain: row.uncertain === 1,
    error_code: row.error_code,
    trace_id: row.trace_id,
    receipt: row.receipt === null ? null : parseSubmissionReceipt(JSON.parse(row.receipt)),
    created_at: row.created_at,
  };
}
function validateQueueKey(key: string) {
  validateIdempotencyKey(key);
  if (!/^[\x21-\x7e]{1,255}$/.test(key))
    throw new TypeError('Queue request keys must contain only visible ASCII characters');
}
