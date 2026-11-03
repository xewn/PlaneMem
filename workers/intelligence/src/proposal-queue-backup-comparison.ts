import { isDeepStrictEqual } from 'node:util';
import { ContractError } from '@planemem/contracts';
import {
  inspectProposalQueueBackup,
  type ProposalQueueBackupJob,
  type ProposalQueueBackupGeneration,
} from './proposal-queue-backup.js';

type JobState = 'identical' | 'missing' | 'changed' | 'conflict';
function jobSummary(job: ProposalQueueBackupJob) {
  return {
    job_id: job.job_id,
    status: job.status,
    attempts: job.attempts,
    uncertain: job.uncertain === 1,
  };
}
function changedFields<T extends object>(left: T, right: T): Array<keyof T> {
  // Validated rows contain exactly the known primitive fields. Object key order is immaterial.
  return (Object.keys(left).sort() as Array<keyof T>).filter(
    (field) => left[field] !== right[field],
  );
}
function associationKey(row: ProposalQueueBackupGeneration) {
  return row.job_id + ':' + row.record_sha256;
}
function associationSummary(row: ProposalQueueBackupGeneration) {
  return { job_id: row.job_id, record_sha256: row.record_sha256 };
}

/** Compare complete validated snapshots; neither differences nor equality authorize queue writes. */
export function compareProposalQueueBackups(backupValue: unknown, currentValue: unknown) {
  const backup = inspectProposalQueueBackup(backupValue);
  const current = inspectProposalQueueBackup(currentValue);
  if (!isDeepStrictEqual(backup.binding, current.binding))
    throw new ContractError(
      'PROPOSAL_QUEUE_BINDING_MISMATCH',
      'Compare snapshots from the same original gateway, project and identity',
    );

  const currentById = new Map(current.jobs.map((row) => [row.job_id, row]));
  const currentByKey = new Map(current.jobs.map((row) => [row.request_key, row]));
  const backupIds = new Set(backup.jobs.map((row) => row.job_id));
  const jobs = backup.jobs.map((row) => {
    const byId = currentById.get(row.job_id);
    const byKey = currentByKey.get(row.request_key);
    const target = byId ?? byKey;
    const changed = target ? changedFields(row, target) : [];
    let state: JobState = 'missing';
    if (target) {
      state =
        target.job_id !== row.job_id ||
        target.request_key !== row.request_key ||
        target.payload !== row.payload ||
        target.payload_hash !== row.payload_hash
          ? 'conflict'
          : changed.length
            ? 'changed'
            : 'identical';
    }
    return {
      job_id: row.job_id,
      state,
      matched_by: byId ? ('job-id' as const) : byKey ? ('request-key' as const) : null,
      request_key_owner_job_id: byKey?.job_id ?? null,
      changed_fields: changed,
      backup: jobSummary(row),
      current: target ? jobSummary(target) : null,
    };
  });
  // Inventory by original IDs: a different-ID request-key collision also remains target-only.
  const currentOnlyJobs = current.jobs.filter((row) => !backupIds.has(row.job_id)).map(jobSummary);
  const parentStates = new Map(jobs.map((row) => [row.job_id, row.state]));
  const currentRecords = new Map(
    current.generation_records.map((row) => [associationKey(row), row]),
  );
  const backupRecordKeys = new Set(backup.generation_records.map(associationKey));
  const generations = backup.generation_records.map((row) => {
    const target = currentRecords.get(associationKey(row));
    const changed = target ? changedFields(row, target) : [];
    return {
      ...associationSummary(row),
      state: !target
        ? ('missing' as const)
        : changed.length
          ? ('changed' as const)
          : ('identical' as const),
      parent_job_state: parentStates.get(row.job_id)!,
      changed_fields: changed,
    };
  });
  const currentOnlyGenerations = current.generation_records
    .filter((row) => !backupRecordKeys.has(associationKey(row)))
    .map(associationSummary);
  const sameTable = backup.generation_history_present === current.generation_history_present;
  return {
    schema_version: 1 as const,
    kind: 'proposal-queue-backup-comparison' as const,
    binding: backup.binding,
    backup_sha256: backup.sha256,
    current_snapshot_sha256: current.sha256,
    backup_captured_at: backup.captured_at,
    current_captured_at: current.captured_at,
    identical:
      sameTable &&
      jobs.every((row) => row.state === 'identical') &&
      generations.every((row) => row.state === 'identical') &&
      currentOnlyJobs.length === 0 &&
      currentOnlyGenerations.length === 0,
    counts: {
      jobs: {
        backup: backup.jobs.length,
        current: current.jobs.length,
        identical: jobs.filter((row) => row.state === 'identical').length,
        missing: jobs.filter((row) => row.state === 'missing').length,
        changed: jobs.filter((row) => row.state === 'changed').length,
        conflict: jobs.filter((row) => row.state === 'conflict').length,
        current_only: currentOnlyJobs.length,
      },
      generation_records: {
        backup: backup.generation_records.length,
        current: current.generation_records.length,
        identical: generations.filter((row) => row.state === 'identical').length,
        missing: generations.filter((row) => row.state === 'missing').length,
        changed: generations.filter((row) => row.state === 'changed').length,
        current_only: currentOnlyGenerations.length,
      },
    },
    generation_history: {
      backup_present: backup.generation_history_present,
      current_present: current.generation_history_present,
      identical: sameTable,
    },
    jobs,
    current_only_jobs: currentOnlyJobs,
    generation_records: generations,
    current_only_generation_records: currentOnlyGenerations,
    verification: 'local-snapshot-comparison-only' as const,
    current_remote: 'not-checked' as const,
    restoration: 'not-performed' as const,
  };
}
export type ProposalQueueBackupComparison = ReturnType<typeof compareProposalQueueBackups>;
