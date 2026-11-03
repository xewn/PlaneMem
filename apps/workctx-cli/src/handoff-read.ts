import {
  ContractError,
  parseHandoffReadQuery,
  parseHandoffReadEnvelope,
} from '@planemem/contracts';

export function prepareHandoffRead(command: string, input: unknown, trace: string, key?: string) {
  if (command !== 'handoffs get') return;
  try {
    if (key !== undefined) throw new TypeError('Handoff reads do not accept --key');
    return parseHandoffReadQuery(input);
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid handoff query',
      { trace_id: trace },
    );
  }
}
export function handoffReadResult(
  value: unknown,
  query: { handoff_id: string },
  scope: {
    tenant_id: string;
    workspace_id: string;
    project_id?: string;
  },
  trace: string,
) {
  try {
    return parseHandoffReadEnvelope(value, query.handoff_id, scope, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested current handoff detail',
      { trace_id: trace },
    );
  }
}
