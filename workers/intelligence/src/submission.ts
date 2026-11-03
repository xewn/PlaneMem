import { createHash, randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import {
  ContractError,
  createUlid,
  isUlid,
  parseCreateProposal,
  validateIdempotencyKey,
  type CreateProposalRequest,
  type ProposalMutationReceipt,
  type ProposalCreateReceiptEnvelope,
} from '@planemem/contracts';
import {
  readProposalReceiptTarget,
  settleProposalCreationReceipt,
  type ProposalReceiptTarget,
} from './proposal-reconciliation-state.js';
import { parseSubmissionReceipt } from './receipt.js';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import { captureProposalQueueBackup } from './proposal-queue-backup.js';
import { PROPOSAL_QUEUE_CORE_SCHEMA } from './proposal-queue-schema.js';
import {
  inspectProposalGenerationRecord,
  readGeneratedProposalDraft,
} from './generation-record.js';
import {
  attachGenerationRecord,
  getGenerationHistory,
  listGenerationHistory,
  type ProposalGenerationHistoryQuery,
} from './generation-history.js';
export { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
export type {
  ProposalGenerationHistoryQuery,
  ProposalGenerationHistoryEntry,
} from './generation-history.js';
export interface ProposalQueueOptions {
  /** Inspect an existing v1 queue without creating it, changing its journal or initializing tables. */
  readonly?: boolean;
  /** Require an existing initialized queue without creating tables or changing journal mode. */
  existing?: boolean;
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
      Object.keys(options).some((key) => !['readonly', 'existing'].includes(key)) ||
      (options.existing !== undefined && typeof options.existing !== 'boolean') ||
      (options.readonly !== undefined && typeof options.readonly !== 'boolean')
    )
      throw new TypeError('Supply boolean readonly/existing queue options');
    this.readOnly = options.readonly === true;
    this.binding = Object.freeze(normalizeQueueBinding(binding));
    if (options.existing === true) {
      try {
        if (!lstatSync(path).isFile()) throw new TypeError();
      } catch {
        throw new ContractError(
          'PROPOSAL_QUEUE_UNAVAILABLE',
          'Choose an existing regular initialized queue in a directory you control',
        );
      }
    }
    // query_only is defense in depth; the file must already be opened natively read-only.
    this.db = new DatabaseSync(path, { readOnly: this.readOnly });
    try {
      this.db.exec('PRAGMA busy_timeout = 5000');
      if (this.readOnly || options.existing === true) {
        if (this.readOnly) this.db.exec('PRAGMA query_only = ON');
        this.validateExistingQueue();
        if (!this.readOnly) this.db.exec('PRAGMA synchronous = FULL');
        return;
      }
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = FULL');
      this.transaction(() => {
        this.db.exec(PROPOSAL_QUEUE_CORE_SCHEMA);
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
    return this.transaction(() => this.enqueuePayload(payload, key));
  }

  /** Preserve the complete generation record and its job in one explicit transaction. */
  enqueueGenerated(value: unknown, key: string) {
    this.requireWritable();
    validateQueueKey(key);
    const record = inspectProposalGenerationRecord(value);
    const draft = readGeneratedProposalDraft(record, this.binding);
    if (record.kind !== 'proposal-generation')
      throw new TypeError('A generation record is required');
    const payload = JSON.stringify(draft);
    let candidate: string | undefined;
    let begun = false;
    let phase = 'begin';
    try {
      this.db.exec('BEGIN IMMEDIATE');
      begun = true;
      phase = 'job';
      const queued = this.enqueuePayload(payload, key, true);
      candidate = queued.job_id;
      phase = 'record';
      const association = attachGenerationRecord(this.db, queued.job_id, record, this.binding);
      const current = this.row(queued.job_id);
      if (current.request_key !== key || !isDeepStrictEqual(readDraft(current), draft))
        throw new ContractError(
          'PROPOSAL_GENERATION_HISTORY_CORRUPT',
          'The task changed while attaching its generation record',
        );
      const result = { job: summary(current), record_sha256: record.sha256, ...association };
      phase = 'commit';
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      let rollback = 'not-started';
      if (begun) {
        try {
          this.db.exec('ROLLBACK');
          rollback = 'completed';
        } catch {
          rollback = 'not-confirmed';
        }
      }
      throw new ContractError(
        'PROPOSAL_GENERATION_ENQUEUE_FAILED',
        'Generation enqueue was not confirmed; retain the original record and request key',
        {
          request_key: key,
          record_sha256: record.sha256,
          ...(candidate ? { candidate_job_id: candidate } : {}),
          phase,
          rollback,
          mutation: !begun
            ? 'not-started'
            : phase !== 'commit' && rollback === 'completed'
              ? 'rolled-back'
              : 'not-confirmed',
          retryable: false,
          ...(error instanceof ContractError ? { cause_code: error.envelope.code } : {}),
        },
      );
    }
  }

  listGenerations(id: string, options: ProposalGenerationHistoryQuery = {}) {
    return this.readTransaction(() => listGenerationHistory(this.db, id, this.binding, options));
  }

  getGeneration(id: string, sha256: string) {
    return this.readTransaction(() => getGenerationHistory(this.db, id, sha256, this.binding));
  }

  /** Complete known-v1 logical snapshot; never acquire, recover or change a sending lease. */
  backup() {
    if (!this.readOnly)
      throw new ContractError(
        'PROPOSAL_QUEUE_BACKUP_REQUIRES_READONLY',
        'Open an existing queue read-only before exporting its snapshot',
      );
    return this.readTransaction(() => captureProposalQueueBackup(this.db, this.binding));
  }

  private enqueuePayload(
    payload: string,
    key: string,
    ignoreObjectKeyOrder = false,
  ): ProposalJobSummary {
    const checksum = hash(payload);
    if (ignoreObjectKeyOrder) {
      const sizes = this.db
        .prepare(
          `SELECT typeof(payload) AS payload_type,
        length(CAST(payload AS BLOB)) AS payload_bytes,
        length(CAST(coalesce(job_id,'') || coalesce(request_key,'') || coalesce(payload_hash,'') ||
          coalesce(status,'') || coalesce(error_code,'') || coalesce(trace_id,'') || coalesce(receipt,'') ||
          coalesce(created_at,'') || coalesce(lease_token,'') AS BLOB)) AS metadata_bytes
        FROM proposal_jobs WHERE request_key = ?`,
        )
        .get(key);
      if (
        sizes &&
        (sizes.payload_type !== 'text' ||
          typeof sizes.payload_bytes !== 'number' ||
          sizes.payload_bytes < 1 ||
          sizes.payload_bytes > 1024 * 1024 ||
          typeof sizes.metadata_bytes !== 'number' ||
          sizes.metadata_bytes > 16 * 1024)
      )
        throw new ContractError(
          'PROPOSAL_GENERATION_HISTORY_CORRUPT',
          'The stored task exceeds generation history limits',
        );
    }
    const existing = this.db
      .prepare('SELECT * FROM proposal_jobs WHERE request_key = ?')
      .get(key) as unknown as JobRow | undefined;
    if (existing) {
      if (
        (existing.payload_hash !== checksum || existing.payload !== payload) &&
        (!ignoreObjectKeyOrder || !isDeepStrictEqual(readDraft(existing), JSON.parse(payload)))
      )
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

  captureReceiptTarget(id: string, forSettlement = false): ProposalReceiptTarget {
    if (typeof forSettlement !== 'boolean') throw new TypeError('Use a boolean settlement flag');
    if (forSettlement) this.requireWritable();
    return this.readTransaction(() => readProposalReceiptTarget(this.db, this.binding, id));
  }

  applyCreationReceipt(target: ProposalReceiptTarget, receipt: ProposalCreateReceiptEnvelope) {
    this.requireWritable();
    return settleProposalCreationReceipt(this.db, this.binding, target, receipt);
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
      const candidate = this.db
        .prepare(
          `SELECT substr(job_id,1,27) AS job_id FROM proposal_jobs WHERE
        (status IN ('queued','retry') AND next_attempt_ms <= ?) OR (status = 'sending' AND lease_until_ms <= ?)
        ORDER BY next_attempt_ms, job_id LIMIT 1`,
        )
        .get(Math.min(now, dueBefore), Math.min(now, dueBefore));
      if (!candidate) return undefined;
      if (!isUlid(candidate.job_id))
        throw new ContractError('PROPOSAL_QUEUE_CORRUPT', 'The due task identifier is invalid');
      const id = candidate.job_id;
      let row: JobRow;
      let draft: ReturnType<typeof parseCreateProposal>;
      try {
        const original = readProposalReceiptTarget(this.db, this.binding, id);
        row = this.row(id);
        if (row.attempts >= Number.MAX_SAFE_INTEGER)
          throw new ContractError(
            'PROPOSAL_QUEUE_CORRUPT',
            'The task attempt counter is exhausted',
          );
        draft = original.original.draft;
      } catch (error) {
        if (!(error instanceof ContractError) || error.envelope.code !== 'PROPOSAL_QUEUE_CORRUPT')
          throw error;
        this.db
          .prepare(
            `UPDATE proposal_jobs SET
          uncertain = 1,
          status = 'blocked', error_code = 'PROPOSAL_QUEUE_CORRUPT', lease_token = NULL,
          lease_until_ms = NULL WHERE job_id = ?`,
          )
          .run(id);
        // Commit quarantine so the corrupted draft is never sent or silently rewritten.
        return { job_id: id, quarantined: true, error_code: 'PROPOSAL_QUEUE_CORRUPT' };
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
      WHERE job_id = ? AND status = 'sending' AND lease_token = ? AND request_key = ? AND payload = ? AND payload_hash = ? AND attempts = ?`,
        )
        .run(
          JSON.stringify(parsed),
          trace_id,
          job.job_id,
          job.lease_token,
          job.idempotency_key,
          JSON.stringify(job.draft),
          hash(JSON.stringify(job.draft)),
          job.attempts,
        ).changes === 1
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
      WHERE job_id = ? AND status = 'sending' AND lease_token = ? AND request_key = ? AND payload = ? AND payload_hash = ? AND attempts = ?`,
        )
        .run(
          error.retryable ? 'retry' : 'blocked',
          Date.now() + delay,
          error.code,
          error.trace_id,
          job.uncertain || error.uncertain ? 1 : 0,
          job.job_id,
          job.lease_token,
          job.idempotency_key,
          JSON.stringify(job.draft),
          hash(JSON.stringify(job.draft)),
          job.attempts,
        ).changes === 1
    );
  }

  close() {
    this.db.close();
  }
  /** A pre-dispatch observation, not an extension or proof that the lease cannot expire afterward. */
  ownsClaim(job: ClaimedProposalJob): boolean {
    const payload = JSON.stringify(job.draft);
    return (
      this.db
        .prepare(
          `SELECT 1 AS owned FROM proposal_jobs WHERE job_id = ? AND status = 'sending'
      AND lease_token = ? AND lease_until_ms > ? AND request_key = ? AND payload = ? AND payload_hash = ? AND attempts = ?`,
        )
        .get(
          job.job_id,
          job.lease_token,
          Date.now(),
          job.idempotency_key,
          payload,
          hash(payload),
          job.attempts,
        )?.owned === 1
    );
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
  private readTransaction<T>(run: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* Preserve the original read failure. */
      }
      throw error;
    }
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
