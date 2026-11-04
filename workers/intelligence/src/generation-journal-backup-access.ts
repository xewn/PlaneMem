import { createHash } from 'node:crypto';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import {
  inspectGenerationJournalBackup,
  type ProposalGenerationJournalBackup,
} from './generation-journal-backup.js';
import {
  validateGenerationRequestKey,
  type ProposalGenerationRequestState,
} from './generation-request.js';
import { inspectGenerationRecovery } from './generation-recovery.js';

export interface GenerationJournalBackupQuery {
  limit: number;
  state: ProposalGenerationRequestState['state'] | 'all';
  after: string | null;
  backup_sha256: string | null;
}
export interface GenerationJournalBackupSelection {
  backup_sha256: string;
  request_key: string;
}
const prefix = 'PROPOSAL_GENERATION_JOURNAL_BACKUP_';
function object(value: unknown, fields: string[], required: string[] = []) {
  const row: unknown = JSON.parse(syncJsonSnapshot(value, 4096));
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError();
  if (
    Object.keys(row).some((key) => !fields.includes(key)) ||
    required.some((key) => !Object.hasOwn(row, key))
  )
    throw new TypeError();
  return row as Record<string, unknown>;
}
function digest(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
}
function keyDigest(key: string) {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}
export function parseGenerationJournalBackupQuery(value: unknown): GenerationJournalBackupQuery {
  try {
    const row = object(value, ['limit', 'state', 'after', 'backup_sha256']);
    const limit = Object.hasOwn(row, 'limit') ? row.limit : 10;
    const state = Object.hasOwn(row, 'state') ? row.state : 'all';
    const after = Object.hasOwn(row, 'after') ? row.after : null;
    const backup_sha256 = Object.hasOwn(row, 'backup_sha256') ? row.backup_sha256 : null;
    if (
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 20 ||
      !['all', 'prepared', 'attempted', 'generated', 'failed'].includes(state as string) ||
      (after !== null && !digest(after)) ||
      (backup_sha256 !== null && !digest(backup_sha256)) ||
      (after !== null && backup_sha256 === null)
    )
      throw new TypeError();
    return { limit, state: state as GenerationJournalBackupQuery['state'], after, backup_sha256 };
  } catch {
    throw new ContractError(
      prefix + 'QUERY_INVALID',
      'Use limit 1-20, a known state, and the original backup digest with any request-key digest position',
    );
  }
}
export function parseGenerationJournalBackupSelection(
  value: unknown,
): GenerationJournalBackupSelection {
  try {
    const row = object(value, ['backup_sha256', 'request_key'], ['backup_sha256', 'request_key']);
    if (!digest(row.backup_sha256)) throw new TypeError();
    validateGenerationRequestKey(row.request_key);
    return { backup_sha256: row.backup_sha256, request_key: row.request_key };
  } catch {
    throw new ContractError(
      prefix + 'SELECTION_INVALID',
      'Select the complete backup SHA-256 and original request key',
    );
  }
}
function assertDigest(backup: ProposalGenerationJournalBackup, expected: string | null) {
  if (expected !== null && expected !== backup.sha256)
    throw new ContractError(
      prefix + 'CHANGED',
      'This is a different backup; inspect its first page before selecting original work',
    );
}
function context(backup: ProposalGenerationJournalBackup) {
  return {
    schema_version: 1 as const,
    backup_sha256: backup.sha256,
    started_at: backup.started_at,
    completed_at: backup.completed_at,
    coverage: backup.coverage,
    consistency: backup.consistency,
    binding: backup.binding,
    verification: 'file-consistency-only' as const,
    journal_access: 'none' as const,
    queue_access: 'none' as const,
    current_journal: 'not-checked' as const,
    current_provider: 'not-checked' as const,
    restoration: 'not-performed' as const,
    provider_dispatch: 'not-sent' as const,
  };
}
function metadata(entry: ProposalGenerationRequestState) {
  return {
    request_key: entry.request.request_key,
    request_key_sha256: keyDigest(entry.request.request_key),
    request_id: entry.request.request_id,
    request_sha256: entry.request.sha256,
    created_at: entry.request.created_at,
    preparation_sha256: entry.request.preparation.sha256,
    state: entry.state,
    attempt_id: entry.attempt?.attempt_id ?? null,
    attempt_sha256: entry.attempt?.sha256 ?? null,
    started_at: entry.attempt?.started_at ?? null,
    outcome_sha256: entry.outcome?.sha256 ?? null,
    finished_at: entry.outcome?.finished_at ?? null,
    record_sha256: entry.outcome?.record?.sha256 ?? null,
    failure: entry.outcome?.failure ?? null,
  };
}
/** Validate the complete backup, including entries excluded by the filter, before selection. */
export function listGenerationJournalBackupRequests(value: unknown, input: unknown = {}) {
  const query = parseGenerationJournalBackupQuery(input);
  const backup = inspectGenerationJournalBackup(value);
  assertDigest(backup, query.backup_sha256);
  if (
    query.after !== null &&
    !backup.requests.some((entry) => keyDigest(entry.request.request_key) === query.after)
  )
    throw new ContractError(
      prefix + 'POSITION_INVALID',
      'Use an original request-key digest from this backup, or start from its first page',
    );
  const matching = backup.requests.filter(
    (entry) => query.state === 'all' || entry.state === query.state,
  );
  const remaining = matching.filter(
    (entry) => query.after === null || keyDigest(entry.request.request_key) > query.after,
  );
  const selected = remaining.slice(0, query.limit);
  const boundQuery = { ...query, backup_sha256: backup.sha256 };
  return {
    ...context(backup),
    kind: 'proposal-generation-journal-backup-page' as const,
    query: boundQuery,
    total_requests: backup.requests.length,
    matching_requests: matching.length,
    entries: selected.map((entry) => ({
      ...metadata(entry),
      get_query: { backup_sha256: backup.sha256, request_key: entry.request.request_key },
    })),
    next_query:
      remaining.length > selected.length
        ? { ...boundQuery, after: keyDigest(selected[selected.length - 1]!.request.request_key) }
        : null,
  };
}
export function getGenerationJournalBackupRequest(value: unknown, input: unknown) {
  const selection = parseGenerationJournalBackupSelection(input);
  const backup = inspectGenerationJournalBackup(value);
  assertDigest(backup, selection.backup_sha256);
  const entry = backup.requests.find((item) => item.request.request_key === selection.request_key);
  if (!entry)
    throw new ContractError(
      prefix + 'REQUEST_NOT_FOUND',
      'The original request key is absent from this backup',
    );
  return {
    ...context(backup),
    kind: 'proposal-generation-journal-backup-request' as const,
    selection,
    entry,
  };
}
export function prepareGenerationJournalBackupResult(value: unknown, input: unknown) {
  const { entry, kind: _kind, ...provenance } = getGenerationJournalBackupRequest(value, input);
  if (!entry.outcome?.record)
    throw new ContractError(
      prefix + 'RESULT_UNAVAILABLE',
      'This backup contains no successful result for the original request; generation is not performed',
    );
  return {
    ...provenance,
    kind: 'proposal-generation-journal-backup-result' as const,
    request: metadata(entry),
    format: 'proposal-generation' as const,
    content: entry.outcome.record,
  };
}
export function prepareGenerationJournalBackupOutcome(value: unknown, input: unknown) {
  const { entry, kind: _kind, ...provenance } = getGenerationJournalBackupRequest(value, input);
  if (!entry.attempt || !entry.outcome)
    throw new ContractError(
      prefix + 'OUTCOME_UNAVAILABLE',
      'This backup contains no complete original attempt and outcome; missing work is not reconstructed',
    );
  const recovery = inspectGenerationRecovery(
    { request: entry.request, attempt: entry.attempt, outcome: entry.outcome },
    provenance.binding,
    entry.request.request_key,
  );
  return {
    ...provenance,
    kind: 'proposal-generation-journal-backup-outcome' as const,
    request: metadata(entry),
    format: 'proposal-generation-outcome-recovery' as const,
    content: { request: recovery.request, attempt: recovery.attempt, outcome: recovery.outcome },
  };
}
