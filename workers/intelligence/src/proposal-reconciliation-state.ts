import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ContractError,
  isUlid,
  parseCreateProposal,
  parseProposalCreateReceiptQuery,
  parseProposalCreateReceiptEnvelope,
  proposalReceiptJson,
  syncJsonSnapshot,
  type ProposalCreateReceiptQuery,
  type ProposalCreateReceiptEnvelope,
} from '@planemem/contracts';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import { parseSubmissionReceipt } from './receipt.js';

export interface ProposalReceiptTarget {
  binding: ProposalQueueBinding;
  job_id: string;
  status: 'queued' | 'sending' | 'retry' | 'blocked' | 'submitted';
  snapshot_sha256: string;
  original: ProposalCreateReceiptQuery;
}
const columns = [
  'job_id',
  'request_key',
  'payload',
  'payload_hash',
  'status',
  'attempts',
  'next_attempt_ms',
  'uncertain',
  'error_code',
  'trace_id',
  'receipt',
  'created_at',
  'lease_token',
  'lease_until_ms',
] as const;
type Row = {
  job_id: string;
  request_key: string;
  payload: string;
  payload_hash: string;
  status: ProposalReceiptTarget['status'];
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
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
// The stored payload is itself JSON text and is escaped again when fingerprinting the complete row.
const rowSnapshotBytes = 2 * 1024 * 1024 + 65536;
function corrupt(): never {
  throw new ContractError(
    'PROPOSAL_QUEUE_CORRUPT',
    'The original task or queue binding could not be verified',
  );
}
function milliseconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8_640_000_000_000_000
  );
}
function utc(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function bindingMatches(db: DatabaseSync, binding: ProposalQueueBinding) {
  const rows = db
    .prepare(
      `SELECT singleton, schema_version, typeof(binding) AS kind,
    length(CAST(binding AS BLOB)) AS bytes FROM proposal_queue_binding LIMIT 2`,
    )
    .all();
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row?.singleton !== 1 ||
    row.schema_version !== 1 ||
    row.kind !== 'text' ||
    typeof row.bytes !== 'number' ||
    row.bytes < 1 ||
    row.bytes > 16384
  )
    corrupt();
  if (
    db.prepare('SELECT binding FROM proposal_queue_binding WHERE singleton = 1').get()?.binding !==
    JSON.stringify(binding)
  )
    throw new ContractError(
      'PROPOSAL_QUEUE_BINDING_MISMATCH',
      'Keep the original queue gateway and identity',
    );
}

/** Caller owns a read or write transaction; validate sizes before materializing the complete known v1 row. */
function read(db: DatabaseSync, binding: ProposalQueueBinding, id: string) {
  if (!isUlid(id)) throw new TypeError('Use a job ULID');
  bindingMatches(db, binding);
  const sizes = db
    .prepare(
      `SELECT ${columns.map((c) => `length(CAST(${c} AS BLOB)) AS ${c}`).join(',')}
    FROM proposal_jobs WHERE job_id = ? LIMIT 2`,
    )
    .all(id);
  if (!sizes.length)
    throw new ContractError('PROPOSAL_JOB_NOT_FOUND', 'The original task is unavailable');
  if (sizes.length !== 1) corrupt();
  let metadata = 0;
  for (const field of columns) {
    const size = sizes[0]![field];
    if (size !== null && (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0))
      corrupt();
    if (field === 'payload') {
      if (typeof size !== 'number' || size < 1 || size > 1048576) corrupt();
    } else metadata += Number(size ?? 0);
  }
  if (metadata > 16384) corrupt();
  const row = db
    .prepare(`SELECT ${columns.join(',')} FROM proposal_jobs WHERE job_id = ?`)
    .get(id) as unknown as Row;
  try {
    if (
      row.job_id !== id ||
      typeof row.payload !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.payload_hash) ||
      digest(row.payload) !== row.payload_hash ||
      !['queued', 'sending', 'retry', 'blocked', 'submitted'].includes(row.status) ||
      !Number.isSafeInteger(row.attempts) ||
      row.attempts < 0 ||
      !milliseconds(row.next_attempt_ms) ||
      ![0, 1].includes(row.uncertain) ||
      !utc(row.created_at) ||
      (row.error_code !== null &&
        (typeof row.error_code !== 'string' || !/^[A-Z][A-Z0-9_]{1,127}$/.test(row.error_code))) ||
      (row.trace_id !== null &&
        (typeof row.trace_id !== 'string' || !row.trace_id.trim() || row.trace_id.length > 1024)) ||
      (row.status === 'sending'
        ? typeof row.lease_token !== 'string' ||
          !/^[!-~]{1,255}$/.test(row.lease_token) ||
          !milliseconds(row.lease_until_ms)
        : row.lease_token !== null || row.lease_until_ms !== null)
    )
      throw new TypeError();
    const draft = parseCreateProposal(JSON.parse(row.payload));
    if (JSON.stringify(draft) !== row.payload) throw new TypeError();
    const { gateway_url: _gateway, ...identity } = binding;
    const original = parseProposalCreateReceiptQuery({
      identity,
      request_key: row.request_key,
      draft,
    });
    if (
      db
        .prepare('SELECT COUNT(*) AS count FROM proposal_jobs WHERE request_key = ?')
        .get(row.request_key)?.count !== 1
    )
      throw new TypeError();
    if (row.status === 'submitted') {
      if (typeof row.receipt !== 'string' || row.uncertain !== 0 || row.error_code !== null)
        throw new TypeError();
      const raw: unknown = JSON.parse(row.receipt);
      if (proposalReceiptJson(raw) !== proposalReceiptJson(parseSubmissionReceipt(raw)))
        throw new TypeError();
    } else if (row.receipt !== null) throw new TypeError();
    const target: ProposalReceiptTarget = {
      binding: { ...binding },
      job_id: id,
      status: row.status,
      snapshot_sha256: digest(syncJsonSnapshot({ binding, row }, rowSnapshotBytes)),
      original,
    };
    return { row, target };
  } catch {
    return corrupt();
  }
}
export function readProposalReceiptTarget(
  db: DatabaseSync,
  binding: ProposalQueueBinding,
  id: string,
) {
  return read(db, binding, id).target;
}
export type ProposalLocalSettlement = {
  state: 'submitted' | 'already-submitted' | 'not-observed' | 'sending' | 'local-changed';
  mutation: 'committed' | 'none';
};

/** Explicit local settlement, with no network call and no lease acquisition or recovery. */
export function settleProposalCreationReceipt(
  db: DatabaseSync,
  binding: ProposalQueueBinding,
  original: ProposalReceiptTarget,
  value: ProposalCreateReceiptEnvelope,
): ProposalLocalSettlement {
  const target = JSON.parse(syncJsonSnapshot(original, 1048576 + 32768)) as ProposalReceiptTarget;
  if (
    !isUlid(target.job_id) ||
    !/^[a-f0-9]{64}$/.test(target.snapshot_sha256) ||
    proposalReceiptJson(normalizeQueueBinding(target.binding)) !== proposalReceiptJson(binding)
  )
    throw new TypeError('Use the original receipt target');
  const receipt = parseProposalCreateReceiptEnvelope(value, target.original, value.trace_id);
  if (receipt.data.status === 'not-observed') return { state: 'not-observed', mutation: 'none' };
  const found = receipt.data.receipt;
  const saved = parseSubmissionReceipt({
    proposal_id: found.proposal_id,
    status: found.status,
    revision: found.revision,
    event_id: found.event_id,
    occurred_at: found.occurred_at,
    replayed: true,
  });
  let begun = false;
  let phase = 'begin';
  let attemptedWrite = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    begun = true;
    phase = 'compare';
    const current = read(db, binding, target.job_id);
    let state: ProposalLocalSettlement['state'];
    if (current.target.snapshot_sha256 !== target.snapshot_sha256) state = 'local-changed';
    else if (
      proposalReceiptJson(current.target.original) !== proposalReceiptJson(target.original) ||
      current.target.status !== target.status
    )
      corrupt();
    else if (current.row.status === 'sending') state = 'sending';
    else if (current.row.status === 'submitted') {
      const old = parseSubmissionReceipt(JSON.parse(current.row.receipt!));
      if (proposalReceiptJson({ ...old, replayed: true }) !== proposalReceiptJson(saved)) corrupt();
      state = 'already-submitted';
    } else {
      phase = 'write';
      attemptedWrite = true;
      const changed = db
        .prepare(
          `UPDATE proposal_jobs SET status = 'submitted', receipt = ?, trace_id = ?,
        error_code = NULL, uncertain = 0, lease_token = NULL, lease_until_ms = NULL WHERE job_id = ?`,
        )
        .run(JSON.stringify(saved), receipt.trace_id, target.job_id);
      if (changed.changes !== 1) corrupt();
      phase = 'readback';
      const after = read(db, binding, target.job_id).row;
      const expected = {
        ...current.row,
        status: 'submitted',
        receipt: JSON.stringify(saved),
        trace_id: receipt.trace_id,
        error_code: null,
        uncertain: 0,
        lease_token: null,
        lease_until_ms: null,
      };
      if (
        proposalReceiptJson(after, rowSnapshotBytes) !==
        proposalReceiptJson(expected, rowSnapshotBytes)
      )
        corrupt();
      state = 'submitted';
    }
    phase = 'commit';
    db.exec('COMMIT');
    return { state, mutation: attemptedWrite ? 'committed' : 'none' };
  } catch (error) {
    let rollback = 'not-started';
    if (begun) {
      try {
        db.exec('ROLLBACK');
        rollback = 'completed';
      } catch {
        rollback = 'not-confirmed';
      }
    }
    throw new ContractError(
      'PROPOSAL_RECONCILIATION_FAILED',
      'Local settlement is not confirmed; retain the original request and remote receipt',
      {
        trace_id: receipt.trace_id,
        phase,
        rollback,
        mutation: !attemptedWrite
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
