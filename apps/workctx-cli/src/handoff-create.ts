import {
  ContractError,
  parseHandoffCreateBinding,
  parseHandoffCreateEnvelope,
  type HandoffCreateBinding,
} from '@planemem/contracts';

export interface PreparedHandoffCreate {
  lookup: boolean;
  binding: HandoffCreateBinding;
  input: Record<string, unknown>;
}
export function prepareHandoffCreate(
  command: string,
  input: Record<string, unknown>,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
  key?: string,
): PreparedHandoffCreate | undefined {
  if (command !== 'handoff' && command !== 'handoff receipt') return;
  try {
    const lookup = command === 'handoff receipt';
    const { session_id, expected_identity, idempotency_key, ...fields } = input;
    if (lookup && (key !== undefined || idempotency_key !== undefined))
      throw new TypeError('Creation receipt queries use request_key in JSON without --key');
    if (!lookup && key !== undefined && idempotency_key !== undefined && key !== idempotency_key)
      throw new TypeError('Creation request keys disagree');
    const binding = parseHandoffCreateBinding(
      session_id,
      lookup ? fields : { request_key: key ?? idempotency_key, handoff: fields },
      expected_identity,
      scope,
    );
    return {
      lookup,
      binding,
      input: lookup
        ? { session_id: binding.session_id, ...binding.query }
        : { ...binding.query.handoff, session_id: binding.session_id },
    };
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid original handoff creation',
      { trace_id: trace },
    );
  }
}
export function handoffCreateResult(
  value: unknown,
  prepared: PreparedHandoffCreate,
  trace: string,
) {
  try {
    return parseHandoffCreateEnvelope(value, prepared.binding, trace, prepared.lookup);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The creation response could not be confirmed. Keep the original identity, checkpoint, target and key, then query its receipt.',
      { trace_id: trace, retryable: true },
    );
  }
}
