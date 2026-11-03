import {
  ContractError,
  parseSessionStateQuery,
  parseSessionStateEnvelope,
} from '@planemem/contracts';

export function prepareSessionState(command: string, input: unknown, trace: string, key?: string) {
  if (command !== 'sessions get') return;
  try {
    if (key !== undefined) throw new TypeError('Session state reads do not accept --key');
    return parseSessionStateQuery(input);
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid session query',
      { trace_id: trace },
    );
  }
}

export function sessionStateResult(
  value: unknown,
  input: { session_id: string },
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
) {
  try {
    return parseSessionStateEnvelope(value, input.session_id, scope, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested current session state',
      { trace_id: trace },
    );
  }
}
