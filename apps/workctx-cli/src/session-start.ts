import {
  ContractError,
  parseSessionStartBinding,
  parseSessionStartEnvelope,
  type SessionStartBinding,
} from '@planemem/contracts';

export interface PreparedSessionStart {
  lookup: boolean;
  binding: SessionStartBinding;
  input: Record<string, unknown>;
}
export function prepareSessionStart(
  command: string,
  input: Record<string, unknown>,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
  key?: string,
): PreparedSessionStart | undefined {
  if (command !== 'sessions start' && command !== 'sessions start-receipt') return;
  try {
    const lookup = command === 'sessions start-receipt';
    const { expected_identity, idempotency_key, ...fields } = input;
    if (lookup && (key !== undefined || idempotency_key !== undefined))
      throw new TypeError('Start receipt queries use request_key in JSON without --key');
    if (!lookup && key !== undefined && idempotency_key !== undefined && key !== idempotency_key)
      throw new TypeError('Start request keys disagree');
    const binding = parseSessionStartBinding(
      lookup ? fields : { request_key: key ?? idempotency_key, session: fields },
      expected_identity,
      scope,
    );
    return { lookup, binding, input: lookup ? { ...binding.query } : { ...binding.query.session } };
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid original session start',
      { trace_id: trace },
    );
  }
}
export function sessionStartResult(value: unknown, prepared: PreparedSessionStart, trace: string) {
  try {
    return parseSessionStartEnvelope(value, prepared.binding, trace, prepared.lookup);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The start response could not be confirmed. Keep the original identity, parameters and key, then query its receipt.',
      { trace_id: trace, retryable: true },
    );
  }
}
