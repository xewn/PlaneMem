import {
  ContractError,
  parseResumeBinding,
  parseResumeCommand,
  parseResumeEnvelope,
  parseResumeReceiptEnvelope,
  type ResumeBinding,
} from '@planemem/contracts';
export interface PreparedResume {
  lookup: boolean;
  binding: ResumeBinding;
  input: Record<string, unknown>;
}
export function prepareResume(
  command: string,
  input: Record<string, unknown>,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
  key?: string,
): PreparedResume | undefined {
  if (command !== 'resume' && command !== 'resume receipt') return;
  try {
    const lookup = command === 'resume receipt';
    const { expected_identity, expected_checkpoint_id, session_id, idempotency_key, ...fields } =
      input;
    if (lookup && (key !== undefined || idempotency_key !== undefined))
      throw new TypeError('Resume receipt queries use request_key without --key');
    if (!lookup && key !== undefined && idempotency_key !== undefined && key !== idempotency_key)
      throw new TypeError('Original resume keys disagree');
    const binding = parseResumeBinding(
      session_id,
      lookup
        ? fields
        : {
            ...parseResumeCommand(fields),
            request_key: key ?? idempotency_key,
          },
      expected_identity,
      scope,
      expected_checkpoint_id,
    );
    const { request_key, ...resume } = binding.query;
    return {
      lookup,
      binding,
      input: lookup
        ? { session_id: binding.parent_session_id, ...binding.query }
        : {
            session_id: binding.parent_session_id,
            ...resume,
            ...(idempotency_key === undefined ? {} : { idempotency_key: request_key }),
          },
    };
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid original resume request',
      { trace_id: trace },
    );
  }
}
export function resumeResult(value: unknown, prepared: PreparedResume, trace: string) {
  try {
    return prepared.lookup
      ? parseResumeReceiptEnvelope(value, prepared.binding, trace)
      : parseResumeEnvelope(value, prepared.binding, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The resume response could not be confirmed. Keep the original identity, parent, handoff, checkpoint expectation, ownership requirement and key, then query its receipt.',
      { trace_id: trace, retryable: true },
    );
  }
}
