import { ContractError, isUlid, parseProposalCreateReceiptQuery } from '@planemem/contracts';
import {
  inspectProposalQueueBackup,
  type ProposalQueueBackup,
  type ProposalQueueBackupJob,
} from './proposal-queue-backup.js';

export interface ProposalQueueBackupListQuery {
  limit: number;
  state: ProposalQueueBackupJob['status'] | 'all';
  before: string | null;
  backup_sha256: string | null;
}
export interface ProposalQueueBackupJobSelection {
  backup_sha256: string;
  job_id: string;
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
}
export function parseProposalQueueBackupListQuery(value: unknown): ProposalQueueBackupListQuery {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).some(
        (field) => !['limit', 'state', 'before', 'backup_sha256'].includes(field),
      )
    )
      throw new TypeError();
    const limit = row.limit === undefined ? 25 : row.limit;
    const state = row.state === undefined ? 'all' : row.state;
    const before = row.before === undefined ? null : row.before;
    const backup_sha256 = row.backup_sha256 === undefined ? null : row.backup_sha256;
    if (
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !['all', 'queued', 'sending', 'retry', 'blocked', 'submitted'].includes(state as string) ||
      (before !== null && !isUlid(before)) ||
      (backup_sha256 !== null && !digest(backup_sha256)) ||
      (before !== null && backup_sha256 === null)
    )
      throw new TypeError();
    return { limit, state: state as ProposalQueueBackupListQuery['state'], before, backup_sha256 };
  } catch {
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_QUERY_INVALID',
      'Use limit 1-100, a known state, and the original backup digest with any before position',
    );
  }
}
export function parseProposalQueueBackupJobSelection(
  value: unknown,
): ProposalQueueBackupJobSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw selectionError();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 2 ||
    !Object.hasOwn(row, 'backup_sha256') ||
    !Object.hasOwn(row, 'job_id') ||
    !digest(row.backup_sha256) ||
    !isUlid(row.job_id)
  )
    throw selectionError();
  return { backup_sha256: row.backup_sha256, job_id: row.job_id };
}
function selectionError() {
  return new ContractError(
    'PROPOSAL_QUEUE_BACKUP_SELECTION_INVALID',
    'Select an original job ID and the complete backup SHA-256',
  );
}
function assertDigest(backup: ProposalQueueBackup, expected: string | null) {
  if (expected !== null && expected !== backup.sha256)
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_CHANGED',
      'This is a different backup; inspect its directory again before selecting a job',
    );
}
function context(backup: ProposalQueueBackup) {
  return {
    schema_version: 1 as const,
    backup_sha256: backup.sha256,
    captured_at: backup.captured_at,
    binding: backup.binding,
    verification: 'file-consistency-only' as const,
    queue_access: 'none' as const,
    current_queue: 'not-checked' as const,
    current_remote: 'not-checked' as const,
    restoration: 'not-performed' as const,
  };
}

/** Validate every backup entry, including filtered-out jobs, before returning a metadata page. */
export function listProposalQueueBackupJobs(value: unknown, input: unknown = {}) {
  const query = parseProposalQueueBackupListQuery(input);
  const backup = inspectProposalQueueBackup(value);
  assertDigest(backup, query.backup_sha256);
  if (query.before !== null && !backup.jobs.some((job) => job.job_id === query.before))
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_POSITION_INVALID',
      'Use a before position from this complete backup, or start from its first page',
    );
  const matching = backup.jobs.filter((job) => query.state === 'all' || job.status === query.state);
  const remaining = matching
    .filter((job) => query.before === null || job.job_id < query.before)
    .reverse();
  const selected = remaining.slice(0, query.limit);
  const boundQuery = { ...query, backup_sha256: backup.sha256 };
  return {
    ...context(backup),
    kind: 'proposal-queue-backup-job-page' as const,
    query: boundQuery,
    total_jobs: backup.jobs.length,
    matching_jobs: matching.length,
    generation_history_present: backup.generation_history_present,
    entries: selected.map((job) => ({
      job_id: job.job_id,
      status: job.status,
      attempts: job.attempts,
      uncertain: job.uncertain,
      error_code: job.error_code,
      created_at: job.created_at,
      generation_records: backup.generation_records.filter((row) => row.job_id === job.job_id)
        .length,
      get_query: { backup_sha256: backup.sha256, job_id: job.job_id },
    })),
    next_query:
      remaining.length > selected.length
        ? { ...boundQuery, before: selected[selected.length - 1]!.job_id }
        : null,
  };
}

/** A historical view only; even copied sending leases or submitted receipts grant no authority. */
export function getProposalQueueBackupJob(value: unknown, input: unknown) {
  const selection = parseProposalQueueBackupJobSelection(input);
  const backup = inspectProposalQueueBackup(value);
  assertDigest(backup, selection.backup_sha256);
  const job = backup.jobs.find((row) => row.job_id === selection.job_id);
  if (!job)
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_JOB_NOT_FOUND',
      'This job is absent from the selected backup; no current queue or remote state was checked',
    );
  return {
    ...context(backup),
    kind: 'proposal-queue-backup-job' as const,
    job,
    generation_history_present: backup.generation_history_present,
    generation_records: backup.generation_records.filter((row) => row.job_id === job.job_id),
  };
}

/** Recover the original read-only receipt query, without querying or changing any task. */
export function prepareProposalQueueBackupReceiptQuery(value: unknown, input: unknown) {
  const selected = getProposalQueueBackupJob(value, input);
  const { gateway_url: _gateway, ...identity } = selected.binding;
  const query = parseProposalCreateReceiptQuery({
    identity,
    request_key: selected.job.request_key,
    draft: JSON.parse(selected.job.payload),
  });
  return {
    schema_version: 1 as const,
    kind: 'proposal-queue-backup-receipt-query' as const,
    backup_sha256: selected.backup_sha256,
    captured_at: selected.captured_at,
    job_id: selected.job.job_id,
    binding: selected.binding,
    query,
    verification: selected.verification,
    queue_access: selected.queue_access,
    current_queue: selected.current_queue,
    current_remote: selected.current_remote,
    restoration: selected.restoration,
  };
}
