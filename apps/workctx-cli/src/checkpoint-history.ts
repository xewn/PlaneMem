import {
  ContractError,
  parseCheckpointHistoryQuery,
  parseCheckpointHistoryEnvelope,
  parseCheckpointHistoryWorkbenchEnvelope,
  type CheckpointHistoryQuery,
} from '@planemem/contracts';

export function prepareCheckpointHistory(
  command: string,
  input: unknown,
  trace: string,
  key?: string,
) {
  if (command !== 'checkpoints history') return;
  try {
    if (key !== undefined) throw new TypeError('Checkpoint history does not accept --key');
    return parseCheckpointHistoryQuery(input);
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid checkpoint history query',
      { trace_id: trace },
    );
  }
}
export function checkpointHistoryResult(
  value: unknown,
  query: CheckpointHistoryQuery,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
) {
  try {
    return parseCheckpointHistoryEnvelope(value, query, scope, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested checkpoint history page',
      { trace_id: trace },
    );
  }
}

export function checkpointWorkbenchHistoryResult(
  value: unknown,
  query: CheckpointHistoryQuery,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
) {
  try {
    return parseCheckpointHistoryWorkbenchEnvelope(value, query, scope, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the complete requested checkpoint history page',
      { trace_id: trace, retryable: false },
    );
  }
}
