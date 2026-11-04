import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { ContractError } from '@planemem/contracts';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import type { ProposalGenerationRequestState } from './generation-request.js';
import { directory } from './generation-journal-read.js';
import { readGenerationJournalDispatchPolicy } from './generation-journal-guard.js';
import {
  captureGenerationJournalBackup,
  inspectGenerationJournalBackup,
} from './generation-journal-backup.js';

export type GenerationJournalComparisonState =
  | 'identical'
  | 'missing-in-current'
  | 'source-extends-current'
  | 'current-extends-source'
  | 'conflict';
export interface GenerationJournalFileDifference {
  state: 'absent' | 'identical' | 'source-only' | 'current-only' | 'conflict';
  changed_fields: string[];
}
const prefix = 'PROPOSAL_GENERATION_JOURNAL_COMPARISON_';
function keyDigest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function summary(item: ProposalGenerationRequestState) {
  return {
    request_key: item.request.request_key,
    request_key_sha256: keyDigest(item.request.request_key),
    request_id: item.request.request_id,
    request_sha256: item.request.sha256,
    created_at: item.request.created_at,
    state: item.state,
    attempt_id: item.attempt?.attempt_id ?? null,
    attempt_sha256: item.attempt?.sha256 ?? null,
    started_at: item.attempt?.started_at ?? null,
    outcome_sha256: item.outcome?.sha256 ?? null,
    finished_at: item.outcome?.finished_at ?? null,
    record_sha256: item.outcome?.record?.sha256 ?? null,
    failure_code: item.outcome?.failure?.code ?? null,
    failure_provider_dispatch: item.outcome?.failure?.provider_dispatch ?? null,
  };
}
function difference(
  source: object | null,
  current: object | null,
): GenerationJournalFileDifference {
  if (!source && !current) return { state: 'absent', changed_fields: [] };
  if (!current) return { state: 'source-only', changed_fields: [] };
  if (!source) return { state: 'current-only', changed_fields: [] };
  const left = source as Record<string, unknown>;
  const right = current as Record<string, unknown>;
  const changed_fields = Object.keys(left)
    .sort()
    .filter((key) => !isDeepStrictEqual(left[key], right[key]));
  return { state: changed_fields.length ? 'conflict' : 'identical', changed_fields };
}
function bindingMismatch() {
  return new ContractError(
    prefix + 'BINDING_MISMATCH',
    'Compare the same original gateway, project and identity',
  );
}

/** Compare complete immutable documents. File presence differences never authorize a merge or call. */
export function compareGenerationJournalBackups(sourceValue: unknown, currentValue: unknown) {
  const source = inspectGenerationJournalBackup(sourceValue);
  const current = inspectGenerationJournalBackup(currentValue);
  if (!isDeepStrictEqual(source.binding, current.binding)) throw bindingMismatch();
  const currentByKey = new Map(current.requests.map((item) => [item.request.request_key, item]));
  const currentById = new Map(current.requests.map((item) => [item.request.request_id, item]));
  const currentByAttempt = new Map<string, ProposalGenerationRequestState>();
  for (const item of current.requests)
    if (item.attempt) currentByAttempt.set(item.attempt.attempt_id, item);
  const sourceKeys = new Set(source.requests.map((item) => item.request.request_key));
  const requests = source.requests.map((item) => {
    const key = item.request.request_key;
    const target = currentByKey.get(key) ?? null;
    const identity_collisions: Array<{
      field: 'request_id' | 'attempt_id';
      id: string;
      current_request_key_sha256: string;
      current_request_id: string;
    }> = [];
    const collision = (
      field: 'request_id' | 'attempt_id',
      id: string,
      owner: ProposalGenerationRequestState | undefined,
    ) => {
      if (owner && owner.request.request_key !== key)
        identity_collisions.push({
          field,
          id,
          current_request_key_sha256: keyDigest(owner.request.request_key),
          current_request_id: owner.request.request_id,
        });
    };
    collision('request_id', item.request.request_id, currentById.get(item.request.request_id));
    if (item.attempt)
      collision(
        'attempt_id',
        item.attempt.attempt_id,
        currentByAttempt.get(item.attempt.attempt_id),
      );
    const files = {
      request: difference(item.request, target?.request ?? null),
      attempt: difference(item.attempt, target?.attempt ?? null),
      outcome: difference(item.outcome, target?.outcome ?? null),
    };
    const parts = Object.values(files);
    const sourceOnly = parts.some((part) => part.state === 'source-only');
    const currentOnly = parts.some((part) => part.state === 'current-only');
    const state: GenerationJournalComparisonState =
      identity_collisions.length > 0 ||
      parts.some((part) => part.state === 'conflict') ||
      (sourceOnly && currentOnly)
        ? 'conflict'
        : !target
          ? 'missing-in-current'
          : sourceOnly
            ? 'source-extends-current'
            : currentOnly
              ? 'current-extends-source'
              : 'identical';
    return {
      request_key_sha256: keyDigest(key),
      state,
      matched_by: target ? ('request-key' as const) : null,
      source: summary(item),
      current: target ? summary(target) : null,
      files,
      identity_collisions,
    };
  });
  // This list is by key, even when a target-only entry collides with an original request/attempt ID.
  const currentOnly = current.requests
    .filter((item) => !sourceKeys.has(item.request.request_key))
    .map(summary);
  return {
    schema_version: 1 as const,
    kind: 'proposal-generation-journal-comparison' as const,
    binding: source.binding,
    source_backup_sha256: source.sha256,
    current_snapshot_sha256: current.sha256,
    source_observation: {
      started_at: source.started_at,
      completed_at: source.completed_at,
      consistency: source.consistency,
    },
    current_observation: {
      started_at: current.started_at,
      completed_at: current.completed_at,
      consistency: current.consistency,
    },
    identical: currentOnly.length === 0 && requests.every((item) => item.state === 'identical'),
    has_conflicts: requests.some((item) => item.state === 'conflict'),
    counts: {
      source: source.requests.length,
      current: current.requests.length,
      identical: requests.filter((item) => item.state === 'identical').length,
      missing_in_current: requests.filter((item) => item.state === 'missing-in-current').length,
      source_extends_current: requests.filter((item) => item.state === 'source-extends-current')
        .length,
      current_extends_source: requests.filter((item) => item.state === 'current-extends-source')
        .length,
      conflict: requests.filter((item) => item.state === 'conflict').length,
      current_only: currentOnly.length,
    },
    requests,
    current_only_requests: currentOnly,
    verification: 'file-consistency-comparison-only' as const,
    journal_access: 'none' as const,
    current_journal: 'not-checked' as const,
    current_provider: 'not-checked' as const,
    restoration: 'not-performed' as const,
    merge_authorization: 'none' as const,
    provider_dispatch: 'not-sent' as const,
    provider_dispatch_scope: 'this-invocation' as const,
  };
}

/** Capture a bounded existing directory read-only, including quarantine policy observations. */
export async function compareGenerationJournalDirectory(
  sourceValue: unknown,
  directoryPath: string,
  input: ProposalQueueBinding,
) {
  const source = inspectGenerationJournalBackup(sourceValue);
  const binding = normalizeQueueBinding(input);
  if (!isDeepStrictEqual(source.binding, binding)) throw bindingMismatch();
  try {
    const root = await directory(directoryPath);
    const before = await stat(root, { bigint: true });
    const policy = await readGenerationJournalDispatchPolicy(root);
    const current = await captureGenerationJournalBackup(root, binding);
    const after = await stat(root, { bigint: true });
    if (
      !before.isDirectory() ||
      !after.isDirectory() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      policy !== (await readGenerationJournalDispatchPolicy(root))
    )
      throw new ContractError(
        prefix + 'CHANGED',
        'Directory identity or restore policy changed during comparison; read it again after coordinating writers',
      );
    return {
      ...compareGenerationJournalBackups(source, current),
      verification: 'local-journal-observation-only' as const,
      journal_access: 'read-only' as const,
      current_journal: 'two-pass-observed' as const,
      current_directory: root,
      journal_dispatch: policy,
      restore_provenance: 'not-verified' as const,
    };
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(
      prefix + 'UNAVAILABLE',
      'The existing journal could not be fully observed; no partial comparison is returned',
    );
  }
}
