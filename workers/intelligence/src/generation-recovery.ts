import { isDeepStrictEqual } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import type { GeneratedProposalDraft } from './generation.js';
import { createGeneratedProposalRecord } from './generation-record.js';
import type { ProposalQueueBinding } from './queue-binding.js';
import {
  createGenerationOutcome,
  inspectGenerationAttempt,
  inspectGenerationOutcome,
  inspectGenerationRequest,
  type ProposalGenerationAttempt,
  type ProposalGenerationFailure,
  type ProposalGenerationOutcome,
  type ProposalGenerationRequestRecord,
} from './generation-request.js';

// A save-error envelope may repeat the preparation inside request and outcome, plus generation.
export const GENERATION_RECOVERY_BYTES = 8 * 1024 * 1024;
export interface PreparedGenerationRecovery {
  request: ProposalGenerationRequestRecord;
  attempt: ProposalGenerationAttempt;
  outcome: ProposalGenerationOutcome;
  outcome_preserved: boolean;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}
function fields(row: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError();
}

/** Inspect retained local work only. Error paths/dispatch claims never authorize a write or call. */
export function inspectGenerationRecovery(
  value: unknown,
  binding: ProposalQueueBinding,
  key: string,
): PreparedGenerationRecovery {
  try {
    let row = object(JSON.parse(syncJsonSnapshot(value, GENERATION_RECOVERY_BYTES)));
    if (Buffer.byteLength(JSON.stringify(row, null, 2) + '\n', 'utf8') > GENERATION_RECOVERY_BYTES)
      throw new TypeError();
    if (Object.hasOwn(row, 'recovery')) {
      fields(row, ['code', 'message', 'details', 'trace_id', 'retryable', 'recovery']);
      if (
        row.code !== 'PROPOSAL_GENERATION_REQUEST_SAVE_FAILED' ||
        typeof row.message !== 'string' ||
        typeof row.trace_id !== 'string' ||
        row.retryable !== false ||
        object(row.details).phase !== 'outcome'
      )
        throw new TypeError();
      row = object(row.recovery);
    }
    fields(row, ['request', 'attempt'], ['outcome', 'generation', 'failure']);
    const request = inspectGenerationRequest(row.request, binding, key);
    const attempt = inspectGenerationAttempt(row.attempt, request);
    const hasOutcome = Object.hasOwn(row, 'outcome');
    const hasGeneration = Object.hasOwn(row, 'generation');
    const hasFailure = Object.hasOwn(row, 'failure');
    if ((!hasOutcome && !hasGeneration && !hasFailure) || (hasGeneration && hasFailure))
      throw new TypeError();
    const record = hasGeneration
      ? createGeneratedProposalRecord(
          request.preparation,
          request.provider,
          row.generation as GeneratedProposalDraft,
        )
      : null;
    const failure = hasFailure
      ? createGenerationOutcome(request, attempt, null, row.failure as ProposalGenerationFailure)
          .failure
      : null;
    const outcome = hasOutcome
      ? inspectGenerationOutcome(row.outcome, request, attempt)
      : createGenerationOutcome(request, attempt, record, failure);
    if (
      (hasGeneration && !isDeepStrictEqual(outcome.record, record)) ||
      (hasFailure && !isDeepStrictEqual(outcome.failure, failure))
    )
      throw new TypeError();
    return { request, attempt, outcome, outcome_preserved: hasOutcome };
  } catch (error) {
    if (
      error instanceof ContractError &&
      error.envelope.code === 'PROPOSAL_GENERATION_BINDING_MISMATCH'
    )
      throw error;
    throw new ContractError(
      'PROPOSAL_GENERATION_REQUEST_RECOVERY_INVALID',
      'Provide complete retained work with its original request, attempt and consistent result',
    );
  }
}

/** A reconstructed envelope has a new local packaging time; preserve the stored time on replay. */
export function matchesGenerationRecovery(
  stored: ProposalGenerationOutcome,
  recovery: PreparedGenerationRecovery,
): boolean {
  return recovery.outcome_preserved
    ? isDeepStrictEqual(stored, recovery.outcome)
    : stored.request_id === recovery.request.request_id &&
        stored.request_sha256 === recovery.request.sha256 &&
        stored.attempt_id === recovery.attempt.attempt_id &&
        isDeepStrictEqual(stored.record, recovery.outcome.record) &&
        isDeepStrictEqual(stored.failure, recovery.outcome.failure);
}
