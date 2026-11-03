import { isDeepStrictEqual } from 'node:util';
import { ContractError, isUlid } from '@planemem/contracts';
import {
  generateProposalDraft,
  type GeneratedProposalDraft,
  type ProposalGenerationOptions,
} from './generation.js';
import { createGeneratedProposalRecord } from './generation-record.js';
import { prepareGenerationOutput, saveGenerationFile } from './generation-output.js';
import type { ProposalQueueBinding } from './queue-binding.js';
import { directory, paths, readOptional, readState, failure } from './generation-journal-read.js';
import {
  inspectGenerationRecovery,
  matchesGenerationRecovery,
  type PreparedGenerationRecovery,
} from './generation-recovery.js';
import {
  createGenerationRequest,
  createGenerationAttempt,
  createGenerationOutcome,
  GENERATION_REQUEST_BYTES,
  type ProposalGenerationRequestRecord,
  type ProposalGenerationRequestState,
  type ProposalGenerationAttempt,
  type ProposalGenerationOutcome,
  type ProposalGenerationFailure,
} from './generation-request.js';

/** Recovery contains only validated local work, never options, credentials or raw provider errors. */
export class GenerationJournalWriteError extends ContractError {
  constructor(
    readonly recovery: {
      request: ProposalGenerationRequestRecord;
      attempt?: ProposalGenerationAttempt;
      outcome?: ProposalGenerationOutcome;
      generation?: GeneratedProposalDraft;
      failure?: ProposalGenerationFailure;
    },
    phase: 'request' | 'attempt' | 'outcome',
    cause: unknown,
    outputPath: string,
    operation: 'generate' | 'recover' = 'generate',
  ) {
    super(
      'PROPOSAL_GENERATION_REQUEST_SAVE_FAILED',
      'Retain the original request and completed work; inspect the journal before any further action',
      {
        trace_id: 'trace_generation_request_' + recovery.request.request_id,
        request_id: recovery.request.request_id,
        request_key: recovery.request.request_key,
        request_sha256: recovery.request.sha256,
        phase,
        operation,
        output_path: outputPath,
        provider_dispatch_scope: 'this-invocation',
        provider_dispatch:
          operation === 'generate' && phase === 'outcome'
            ? (recovery.outcome?.failure?.provider_dispatch ??
              recovery.failure?.provider_dispatch ??
              'attempted')
            : 'not-sent',
        ...(cause instanceof ContractError &&
        cause.envelope.code === 'PROPOSAL_GENERATION_REQUEST_FILE_SAVE_FAILED'
          ? { output: cause.envelope.details }
          : {}),
      },
    );
  }
}
async function publish(
  path: string,
  value: unknown,
  request: ProposalGenerationRequestRecord,
  maximum = GENERATION_REQUEST_BYTES,
) {
  const output = await prepareGenerationOutput(path);
  return saveGenerationFile(
    output,
    Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'),
    maximum,
    'trace_generation_request_' + request.request_id,
    'PROPOSAL_GENERATION_REQUEST_FILE_SAVE_FAILED',
  );
}
export async function readGenerationRequest(
  directoryPath: string,
  binding: ProposalQueueBinding,
  key: string,
) {
  return readState(await directory(directoryPath), binding, key);
}

function compareRecovery(
  current: ProposalGenerationRequestState,
  recovery: PreparedGenerationRecovery,
) {
  if (
    !isDeepStrictEqual(current.request, recovery.request) ||
    !isDeepStrictEqual(current.attempt, recovery.attempt)
  )
    throw failure(
      'PROPOSAL_GENERATION_REQUEST_RECOVERY_MISMATCH',
      'Recovery requires the complete original request and existing winning attempt',
      current.request,
    );
  if (current.outcome && !matchesGenerationRecovery(current.outcome, recovery))
    throw failure(
      'PROPOSAL_GENERATION_REQUEST_RECOVERY_CONFLICT',
      'A different complete outcome already exists; it cannot be replaced',
      current.request,
    );
  return current.outcome ? ('retain' as const) : ('create' as const);
}

/** Recover a saved result, never an execution lease. Preview performs the same reads without writes. */
export async function recoverGenerationRequest(
  directoryPath: string,
  binding: ProposalQueueBinding,
  key: string,
  value: unknown,
  options: { preview?: boolean } = {},
) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((name) => name !== 'preview') ||
    (options.preview !== undefined && typeof options.preview !== 'boolean')
  )
    throw new TypeError('Use a boolean recovery preview option');
  const preview = options.preview === true;
  const recovery = inspectGenerationRecovery(value, binding, key);
  const root = await directory(directoryPath);
  const current = await readState(root, binding, key);
  const action = compareRecovery(current, recovery);
  const describe = (
    state: ProposalGenerationRequestState,
    selectedAction: 'create' | 'retain',
  ) => ({
    ...state,
    action: selectedAction,
    preview,
    replayed: selectedAction === 'retain',
    outcome_origin: recovery.outcome_preserved
      ? ('preserved' as const)
      : ('reconstructed' as const),
    result_state: recovery.outcome.record ? ('generated' as const) : ('failed' as const),
    outcome_sha256: state.outcome?.sha256 ?? recovery.outcome.sha256,
    result_record_sha256: recovery.outcome.record?.sha256 ?? null,
    result_failure: recovery.outcome.failure,
    result_finished_at: state.outcome?.finished_at ?? recovery.outcome.finished_at,
  });
  if (preview || action === 'retain') return describe(current, action);
  const file = paths(root, key).outcome;
  try {
    const output = await publish(file, recovery.outcome, recovery.request);
    return {
      ...describe(
        {
          request: recovery.request,
          attempt: recovery.attempt,
          outcome: recovery.outcome,
          state: recovery.outcome.record ? 'generated' : 'failed',
        },
        'create',
      ),
      output,
    };
  } catch (error) {
    // Exclusive publication may have succeeded or another writer may have completed first.
    // Re-read the original prerequisites and compare complete results; never overwrite/retry.
    try {
      const after = await readState(root, binding, key);
      if (compareRecovery(after, recovery) === 'retain') return describe(after, 'retain');
    } catch (comparison) {
      if (
        comparison instanceof ContractError &&
        [
          'PROPOSAL_GENERATION_REQUEST_RECOVERY_MISMATCH',
          'PROPOSAL_GENERATION_REQUEST_RECOVERY_CONFLICT',
        ].includes(comparison.envelope.code)
      )
        throw comparison;
    }
    throw new GenerationJournalWriteError(
      { request: recovery.request, attempt: recovery.attempt, outcome: recovery.outcome },
      'outcome',
      error,
      file,
      'recover',
    );
  }
}
export async function prepareGenerationRequest(
  directoryPath: string,
  binding: ProposalQueueBinding,
  preparation: unknown,
  provider: unknown,
  key: string,
) {
  const candidate = createGenerationRequest(preparation, provider, binding, key);
  const root = await directory(directoryPath);
  const files = paths(root, key);
  const compare = async () => {
    const state = await readState(root, binding, key);
    if (
      !isDeepStrictEqual(state.request.preparation, candidate.preparation) ||
      !isDeepStrictEqual(state.request.provider, candidate.provider)
    )
      throw failure(
        'IDEMPOTENCY_KEY_REUSED',
        'This generation request key already belongs to different input or provider settings',
        state.request,
      );
    return { ...state, replayed: true };
  };
  if ((await readOptional(files.request, GENERATION_REQUEST_BYTES)) !== undefined) return compare();
  if (
    (await readOptional(files.attempt, 8192)) !== undefined ||
    (await readOptional(files.outcome, GENERATION_REQUEST_BYTES)) !== undefined
  )
    throw failure(
      'PROPOSAL_GENERATION_REQUEST_INVALID',
      'Attempt or outcome files exist without their original request',
    );
  try {
    const output = await publish(files.request, candidate, candidate);
    return {
      request: candidate,
      attempt: null,
      outcome: null,
      state: 'prepared' as const,
      replayed: false,
      output,
    };
  } catch (error) {
    // Another preparer may have won the exclusive publication. Only identical complete input replays.
    try {
      return await compare();
    } catch (comparison) {
      if (
        comparison instanceof ContractError &&
        comparison.envelope.code === 'IDEMPOTENCY_KEY_REUSED'
      )
        throw comparison;
      throw new GenerationJournalWriteError(
        { request: candidate },
        'request',
        error,
        files.request,
      );
    }
  }
}
function safeFailure(error: unknown): ProposalGenerationFailure {
  const code =
    error instanceof ContractError && /^[A-Z][A-Z0-9_]{1,127}$/.test(error.envelope.code)
      ? error.envelope.code
      : 'PROPOSAL_GENERATION_FAILED';
  const trace = error instanceof ContractError ? error.envelope.trace_id : null;
  const dispatch =
    error instanceof ContractError ? error.envelope.details.provider_dispatch : undefined;
  return {
    code,
    trace_id:
      typeof trace === 'string' &&
      trace.startsWith('trace_generation_') &&
      isUlid(trace.slice('trace_generation_'.length))
        ? trace
        : null,
    provider_dispatch: dispatch === 'attempted' || dispatch === 'not-sent' ? dispatch : 'unknown',
  };
}
/** A permanent exclusive marker must be fully saved before the single model invocation. */
export async function runGenerationRequest(
  directoryPath: string,
  binding: ProposalQueueBinding,
  key: string,
  options: ProposalGenerationOptions,
) {
  const root = await directory(directoryPath);
  const current = await readState(root, binding, key);
  if (current.state === 'generated') return { ...current, replayed: true };
  if (current.attempt)
    throw new ContractError(
      'PROPOSAL_GENERATION_REQUEST_ALREADY_ATTEMPTED',
      'This request has already been claimed; inspect its saved result or failure instead of sending it again',
      {
        request_id: current.request.request_id,
        request_key: key,
        request_sha256: current.request.sha256,
        attempt_id: current.attempt.attempt_id,
        state: current.state,
      },
    );
  // Check common local mistakes before claiming; credentials remain exclusively in this invocation.
  if (
    !options ||
    typeof options.api_key !== 'string' ||
    !/^[\x21-\x7e]{1,8192}$/.test(options.api_key) ||
    typeof (options.fetch ?? globalThis.fetch) !== 'function' ||
    (options.signal !== undefined &&
      (!options.signal ||
        typeof options.signal.aborted !== 'boolean' ||
        typeof options.signal.addEventListener !== 'function' ||
        typeof options.signal.removeEventListener !== 'function'))
  )
    throw failure(
      'PROPOSAL_GENERATION_INPUT_INVALID',
      'Provide valid invocation credentials and options before running the request',
      current.request,
    );
  const invocation: ProposalGenerationOptions = {
    api_key: options.api_key,
    fetch: options.fetch ?? globalThis.fetch,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  if (invocation.signal?.aborted)
    throw failure(
      'PROPOSAL_GENERATION_CANCELED',
      'Generation was canceled before claiming the request',
      current.request,
    );
  const request = current.request;
  const attempt = createGenerationAttempt(request);
  const files = paths(root, key);
  let claim: Awaited<ReturnType<typeof publish>>;
  try {
    claim = await publish(files.attempt, attempt, request, 8192);
  } catch (error) {
    throw new GenerationJournalWriteError({ request, attempt }, 'attempt', error, files.attempt);
  }
  let generated: GeneratedProposalDraft | undefined;
  let errorResult: ProposalGenerationFailure | null = null;
  try {
    generated = await generateProposalDraft(
      request.preparation.preparation.input,
      request.provider,
      invocation,
    );
  } catch (error) {
    errorResult = safeFailure(error);
  }
  let outcome: ProposalGenerationOutcome | undefined;
  try {
    const record = generated
      ? createGeneratedProposalRecord(request.preparation, request.provider, generated)
      : null;
    outcome = createGenerationOutcome(request, attempt, record, errorResult);
    const output = await publish(files.outcome, outcome, request);
    return {
      request,
      attempt,
      outcome,
      state: record ? ('generated' as const) : ('failed' as const),
      replayed: false,
      claim,
      output,
    };
  } catch (error) {
    throw new GenerationJournalWriteError(
      {
        request,
        attempt,
        ...(outcome ? { outcome } : {}),
        ...(generated ? { generation: generated } : {}),
        ...(errorResult ? { failure: errorResult } : {}),
      },
      'outcome',
      error,
      files.outcome,
    );
  }
}
