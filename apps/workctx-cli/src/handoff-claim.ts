import {
  ContractError,
  parseHandoffClaimBinding,
  parseHandoffClaimEnvelope,
  type HandoffClaimBinding,
} from '@planemem/contracts';

export interface PreparedHandoffClaim {
  lookup: boolean;
  binding: HandoffClaimBinding;
  input: Record<string, unknown>;
}

/** Both CLI transports use the saved original identity and exact command fields. */
export function prepareHandoffClaim(
  command: string,
  input: Record<string, unknown>,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
  key?: string,
): PreparedHandoffClaim | undefined {
  if (command !== 'handoff claim' && command !== 'handoff claim-receipt') return;
  try {
    const lookup = command === 'handoff claim-receipt';
    const { expected_identity, handoff_id, idempotency_key, ...fields } = input;
    if (lookup && (key !== undefined || idempotency_key !== undefined))
      throw new TypeError('Claim receipt queries use request_key in JSON without --key');
    if (!lookup && key !== undefined && idempotency_key !== undefined && key !== idempotency_key)
      throw new TypeError('Claim request keys disagree');
    const binding = parseHandoffClaimBinding(
      handoff_id,
      lookup ? fields : { request_key: key ?? idempotency_key, claim: fields },
      expected_identity,
      scope,
    );
    return {
      lookup,
      binding,
      input: lookup
        ? { handoff_id: binding.handoff_id, ...binding.query }
        : { ...binding.query.claim, handoff_id: binding.handoff_id },
    };
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid original handoff claim',
      { trace_id: trace },
    );
  }
}

export function handoffClaimResult(value: unknown, prepared: PreparedHandoffClaim, trace: string) {
  try {
    return parseHandoffClaimEnvelope(value, prepared.binding, trace, prepared.lookup);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The claim response could not be confirmed. Keep the original identity, version and key, then query its receipt.',
      { trace_id: trace, retryable: true },
    );
  }
}
