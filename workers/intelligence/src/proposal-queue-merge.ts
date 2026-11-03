import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, proposalReceiptJson } from '@planemem/contracts';
import {
  captureProposalQueueBackup,
  inspectProposalQueueBackup,
  PROPOSAL_QUEUE_BACKUP_BYTES,
  type ProposalQueueBackup,
} from './proposal-queue-backup.js';
import { compareProposalQueueBackups } from './proposal-queue-backup-comparison.js';
import { restoredProposalQueueJob } from './proposal-queue-restore-state.js';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import {
  PROPOSAL_QUEUE_GENERATION_SCHEMA,
  PROPOSAL_QUEUE_JOB_COLUMNS,
  PROPOSAL_QUEUE_GENERATION_COLUMNS,
} from './proposal-queue-schema.js';

function digest(value: unknown) {
  return createHash('sha256')
    .update(proposalReceiptJson(value, PROPOSAL_QUEUE_BACKUP_BYTES), 'utf8')
    .digest('hex');
}
function stateDigest(backup: ProposalQueueBackup) {
  const { sha256: _sha, captured_at: _time, ...state } = backup;
  return digest(state);
}
function recordKey(row: { job_id: string; record_sha256: string }) {
  return row.job_id + ':' + row.record_sha256;
}
function order(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function prepare(backupValue: unknown, currentValue: unknown) {
  const backup = inspectProposalQueueBackup(backupValue);
  const current = inspectProposalQueueBackup(currentValue);
  if (!isDeepStrictEqual(backup.binding, current.binding))
    throw new ContractError('PROPOSAL_QUEUE_BINDING_MISMATCH', 'Keep the original queue binding');
  const byId = new Map(current.jobs.map((row) => [row.job_id, row]));
  const byKey = new Map(current.jobs.map((row) => [row.request_key, row]));
  const additions = backup.jobs
    .filter((row) => !byId.has(row.job_id) && !byKey.has(row.request_key))
    .map(restoredProposalQueueJob);
  const jobs = backup.jobs.map((row) => {
    const target = byId.get(row.job_id);
    const owner = byKey.get(row.request_key);
    const action =
      !target && !owner
        ? 'add'
        : target && isDeepStrictEqual(target, row)
          ? 'keep-original'
          : target && isDeepStrictEqual(target, restoredProposalQueueJob(row))
            ? 'keep-restored'
            : 'conflict';
    return {
      job_id: row.job_id,
      action,
      request_key_owner_job_id: owner?.job_id ?? null,
      backup_status: row.status,
      current_status: (target ?? owner)?.status ?? null,
      conflict_reason:
        action !== 'conflict'
          ? null
          : owner && owner.job_id !== row.job_id
            ? 'request-key-owned'
            : 'different-row',
      changed_fields:
        action === 'conflict' && target
          ? PROPOSAL_QUEUE_JOB_COLUMNS.filter((field) => target[field] !== row[field])
          : [],
      inserted_status: action === 'add' ? restoredProposalQueueJob(row).status : null,
    };
  });
  const currentRecords = new Map(current.generation_records.map((row) => [recordKey(row), row]));
  const records = backup.generation_records.map((row) => {
    const target = currentRecords.get(recordKey(row));
    return {
      job_id: row.job_id,
      record_sha256: row.record_sha256,
      action: !target ? 'add' : isDeepStrictEqual(target, row) ? 'keep' : 'conflict',
      changed_fields: target
        ? PROPOSAL_QUEUE_GENERATION_COLUMNS.filter((field) => target[field] !== row[field])
        : [],
    };
  });
  const recordAdditions = backup.generation_records.filter(
    (row) => !currentRecords.has(recordKey(row)),
  );
  const conflicts =
    jobs.filter((row) => row.action === 'conflict').length +
    records.filter((row) => row.action === 'conflict').length;
  const createTable = backup.generation_history_present && !current.generation_history_present;
  let expected: ProposalQueueBackup | undefined;
  if (!conflicts) {
    const { sha256: _sha, ...original } = current;
    const body = {
      ...original,
      jobs: [...current.jobs, ...additions].sort((a, b) => order(a.job_id, b.job_id)),
      generation_history_present:
        current.generation_history_present || backup.generation_history_present,
      generation_records: [...current.generation_records, ...recordAdditions].sort((a, b) =>
        order(recordKey(a), recordKey(b)),
      ),
    };
    try {
      expected = inspectProposalQueueBackup({ ...body, sha256: digest(body) });
    } catch {
      throw new ContractError(
        'PROPOSAL_QUEUE_MERGE_LIMIT',
        'The complete combined queue exceeds restore format limits; no partial merge is allowed',
      );
    }
  }
  const currentDigest = stateDigest(current);
  const expectedDigest = expected ? stateDigest(expected) : null;
  const policy = 'missing-only-quarantine-v1' as const;
  const sourceIds = new Set(backup.jobs.map((row) => row.job_id));
  const sourceRecords = new Set(backup.generation_records.map(recordKey));
  const plan = {
    schema_version: 1 as const,
    kind: 'proposal-queue-merge-plan' as const,
    policy,
    binding: backup.binding,
    backup_sha256: backup.sha256,
    target_content_sha256: currentDigest,
    expected_content_sha256: expectedDigest,
    can_merge: conflicts === 0,
    plan_sha256: conflicts
      ? null
      : digest({
          schema_version: 1,
          kind: 'proposal-queue-merge-plan',
          policy,
          backup_sha256: backup.sha256,
          target_content_sha256: currentDigest,
          expected_content_sha256: expectedDigest,
        }),
    create_generation_history: createTable,
    counts: {
      backup_jobs: backup.jobs.length,
      current_jobs: current.jobs.length,
      add_jobs: additions.length,
      add_quarantined_jobs: additions.filter((row) => row.status !== 'submitted').length,
      keep_original_jobs: jobs.filter((row) => row.action === 'keep-original').length,
      keep_restored_jobs: jobs.filter((row) => row.action === 'keep-restored').length,
      current_only_jobs: current.jobs.filter((row) => !sourceIds.has(row.job_id)).length,
      add_generation_records: recordAdditions.length,
      keep_generation_records: records.filter((row) => row.action === 'keep').length,
      current_only_generation_records: current.generation_records.filter(
        (row) => !sourceRecords.has(recordKey(row)),
      ).length,
      conflicts,
    },
    jobs,
    generation_records: records,
    current_remote: 'not-checked' as const,
    existing_jobs_updated: false,
    automatic_dispatch: false,
  };
  return { backup, current, expected, additions, recordAdditions, plan };
}

/** Pure preview; callers must acquire a fresh stable target snapshot before applying anything. */
export function planProposalQueueMerge(backup: unknown, current: unknown) {
  return prepare(backup, current).plan;
}
export type ProposalQueueMergePlan = ReturnType<typeof planProposalQueueMerge>;

/** Internal writer. Owns the complete immediate transaction; no network dispatch or job updates. */
export function mergeProposalQueueBackup(
  db: DatabaseSync,
  inputBinding: ProposalQueueBinding,
  value: unknown,
  confirmation: string,
) {
  const backup = inspectProposalQueueBackup(value);
  const binding = normalizeQueueBinding(inputBinding);
  if (!isDeepStrictEqual(backup.binding, binding))
    throw new ContractError('PROPOSAL_QUEUE_BINDING_MISMATCH', 'Keep the original queue binding');
  if (typeof confirmation !== 'string' || !/^[a-f0-9]{64}$/.test(confirmation))
    throw new ContractError(
      'PROPOSAL_QUEUE_MERGE_CONFIRMATION_REQUIRED',
      'Confirm the complete preview plan SHA-256',
    );
  let begun = false;
  let writeAttempted = false;
  let phase = 'begin';
  let plan: ProposalQueueMergePlan | undefined;
  try {
    db.exec('BEGIN IMMEDIATE');
    begun = true;
    phase = 'prepare';
    const prepared = prepare(backup, captureProposalQueueBackup(db, binding));
    plan = prepared.plan;
    if (!plan.can_merge || !prepared.expected)
      throw new ContractError(
        'PROPOSAL_QUEUE_MERGE_CONFLICT',
        'Existing content conflicts with the complete backup',
      );
    phase = 'confirm';
    if (confirmation !== plan.plan_sha256)
      throw new ContractError(
        'PROPOSAL_QUEUE_MERGE_STALE',
        'The backup or complete target changed; preview again',
      );
    phase = 'table';
    if (plan.create_generation_history) {
      writeAttempted = true;
      db.exec(PROPOSAL_QUEUE_GENERATION_SCHEMA);
    }
    phase = 'jobs';
    if (prepared.additions.length) {
      const insert = db.prepare(
        'INSERT INTO proposal_jobs (' +
          PROPOSAL_QUEUE_JOB_COLUMNS.join(',') +
          ') VALUES (' +
          PROPOSAL_QUEUE_JOB_COLUMNS.map(() => '?').join(',') +
          ')',
      );
      writeAttempted = true;
      for (const row of prepared.additions)
        insert.run(...PROPOSAL_QUEUE_JOB_COLUMNS.map((field) => row[field]));
    }
    phase = 'records';
    if (prepared.recordAdditions.length) {
      const insert = db.prepare(
        'INSERT INTO proposal_generation_records (' +
          PROPOSAL_QUEUE_GENERATION_COLUMNS.join(',') +
          ') VALUES (' +
          PROPOSAL_QUEUE_GENERATION_COLUMNS.map(() => '?').join(',') +
          ')',
      );
      writeAttempted = true;
      for (const row of prepared.recordAdditions)
        insert.run(...PROPOSAL_QUEUE_GENERATION_COLUMNS.map((field) => row[field]));
    }
    phase = 'readback';
    const observed = captureProposalQueueBackup(db, binding);
    if (!compareProposalQueueBackups(prepared.expected, observed).identical)
      throw new ContractError(
        'PROPOSAL_QUEUE_MERGE_READBACK_FAILED',
        'The complete merged queue differs from its plan',
      );
    phase = 'commit';
    db.exec('COMMIT');
    return {
      ...plan,
      state: writeAttempted ? ('merged' as const) : ('unchanged' as const),
      mutation: writeAttempted ? ('committed' as const) : ('none' as const),
    };
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
      'PROPOSAL_QUEUE_MERGE_FAILED',
      'Retain the original backup and preview again before any further merge',
      {
        backup_sha256: backup.sha256,
        ...(plan ? { plan } : {}),
        phase,
        rollback,
        mutation: !writeAttempted
          ? 'none'
          : phase !== 'commit' && rollback === 'completed'
            ? 'rolled-back'
            : 'not-confirmed',
        ...(error instanceof ContractError ? { cause_code: error.envelope.code } : {}),
      },
    );
  }
}
