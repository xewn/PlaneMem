import { ContractError } from '@planemem/contracts';
import { inspectProposalGenerationRecord } from './generation-record.js';
import {
  getProposalQueueBackupJob,
  parseProposalQueueBackupJobSelection,
  type ProposalQueueBackupJobSelection,
} from './proposal-queue-backup-access.js';
import type { ProposalQueueBackupGeneration } from './proposal-queue-backup.js';

export interface ProposalQueueBackupGenerationQuery extends ProposalQueueBackupJobSelection {
  limit: number;
  after: string | null;
}
export interface ProposalQueueBackupGenerationSelection extends ProposalQueueBackupJobSelection {
  record_sha256: string;
}

function object(value: unknown, fields: string[], required = fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((field) => !fields.includes(field)) ||
    required.some((field) => !Object.hasOwn(row, field))
  )
    throw new TypeError();
  return row;
}
function digest(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
}
export function parseProposalQueueBackupGenerationQuery(
  value: unknown,
): ProposalQueueBackupGenerationQuery {
  try {
    const row = object(
      value,
      ['backup_sha256', 'job_id', 'limit', 'after'],
      ['backup_sha256', 'job_id'],
    );
    const selection = parseProposalQueueBackupJobSelection({
      backup_sha256: row.backup_sha256,
      job_id: row.job_id,
    });
    const limit = Object.hasOwn(row, 'limit') ? row.limit : 10;
    const after = Object.hasOwn(row, 'after') ? row.after : null;
    if (
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 20 ||
      (after !== null && !digest(after))
    )
      throw new TypeError();
    return { ...selection, limit, after };
  } catch {
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_GENERATION_QUERY_INVALID',
      'Select the backup digest and job ID, limit 1-20, and an optional original record digest position',
    );
  }
}
export function parseProposalQueueBackupGenerationSelection(
  value: unknown,
): ProposalQueueBackupGenerationSelection {
  try {
    const row = object(value, ['backup_sha256', 'job_id', 'record_sha256']);
    const selection = parseProposalQueueBackupJobSelection({
      backup_sha256: row.backup_sha256,
      job_id: row.job_id,
    });
    if (!digest(row.record_sha256)) throw new TypeError();
    return { ...selection, record_sha256: row.record_sha256 };
  } catch {
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_GENERATION_SELECTION_INVALID',
      'Select the original backup digest, job ID and complete generation record digest',
    );
  }
}
function context(parent: ReturnType<typeof getProposalQueueBackupJob>) {
  return {
    schema_version: 1 as const,
    backup_sha256: parent.backup_sha256,
    captured_at: parent.captured_at,
    binding: parent.binding,
    job_id: parent.job.job_id,
    generation_history_present: parent.generation_history_present,
    verification: parent.verification,
    queue_access: parent.queue_access,
    current_queue: parent.current_queue,
    current_remote: parent.current_remote,
    restoration: parent.restoration,
  };
}
function readRecord(row: ProposalQueueBackupGeneration) {
  const record = inspectProposalGenerationRecord(JSON.parse(row.record_json));
  if (record.kind !== 'proposal-generation' || record.sha256 !== row.record_sha256)
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_INVALID',
      'Keep the complete original backup; its generation record is inconsistent',
    );
  return record;
}

/** Parent access validates every job/association and their original binding before pagination. */
export function listProposalQueueBackupGenerations(value: unknown, input: unknown) {
  const query = parseProposalQueueBackupGenerationQuery(input);
  const parent = getProposalQueueBackupJob(value, {
    backup_sha256: query.backup_sha256,
    job_id: query.job_id,
  });
  const records = parent.generation_records;
  if (query.after !== null && !records.some((row) => row.record_sha256 === query.after))
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_GENERATION_POSITION_INVALID',
      'Use a record position from this backup and job, or start from its first page',
    );
  const remaining = records.filter(
    (row) => query.after === null || row.record_sha256 > query.after,
  );
  const selected = remaining.slice(0, query.limit);
  return {
    ...context(parent),
    kind: 'proposal-queue-backup-generation-page' as const,
    query,
    total_records: records.length,
    entries: selected.map((row) => {
      const record = readRecord(row);
      return {
        record_sha256: row.record_sha256,
        preparation_sha256: record.preparation.sha256,
        attached_at: row.attached_at,
        generated_at: record.generation.generated_at,
        trace_id: record.generation.trace_id,
        requested_model: record.generation.requested_model,
        returned_model: record.generation.returned_model,
        prompt_version: record.generation.prompt_version,
        classification: record.generation.draft.classification,
        source_count: record.generation.source_refs.length,
        get_query: {
          backup_sha256: query.backup_sha256,
          job_id: query.job_id,
          record_sha256: row.record_sha256,
        },
      };
    }),
    next_query:
      remaining.length > selected.length
        ? { ...query, after: selected[selected.length - 1]!.record_sha256 }
        : null,
  };
}

/** Return the original standalone generation document; association provenance stays in the report. */
export function getProposalQueueBackupGeneration(value: unknown, input: unknown) {
  const selection = parseProposalQueueBackupGenerationSelection(input);
  const parent = getProposalQueueBackupJob(value, {
    backup_sha256: selection.backup_sha256,
    job_id: selection.job_id,
  });
  const row = parent.generation_records.find(
    (entry) => entry.record_sha256 === selection.record_sha256,
  );
  if (!row)
    throw new ContractError(
      'PROPOSAL_QUEUE_BACKUP_GENERATION_NOT_FOUND',
      'No generation record with this digest belongs to the selected job in this backup',
    );
  return {
    ...context(parent),
    kind: 'proposal-queue-backup-generation' as const,
    attached_at: row.attached_at,
    record_sha256: row.record_sha256,
    record: readRecord(row),
  };
}
