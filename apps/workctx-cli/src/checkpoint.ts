import {
  ContractError,
  parseCheckpointBinding,
  parseCheckpointSaveCommand,
  parseCheckpointSaveEnvelope,
  parseCheckpointReceiptEnvelope,
  type CheckpointBinding,
  parseCheckpointReadQuery,
  parseCheckpointReadEnvelope,
  type CheckpointReadQuery,
} from '@planemem/contracts';

export interface PreparedCheckpoint {
  lookup: boolean;
  binding: CheckpointBinding;
  input: Record<string, unknown>;
}
export function prepareCheckpoint(
  command: string,
  input: Record<string, unknown>,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
  key?: string,
): PreparedCheckpoint | undefined {
  if (command !== 'checkpoint' && command !== 'checkpoint receipt') return;
  try {
    const lookup = command === 'checkpoint receipt';
    const { expected_identity, ...fields } = input;
    if (lookup && (key !== undefined || fields.idempotency_key !== undefined))
      throw new TypeError('Checkpoint receipt queries use request_key without --key');
    if (
      !lookup &&
      key !== undefined &&
      fields.idempotency_key !== undefined &&
      key !== fields.idempotency_key
    )
      throw new TypeError('Original checkpoint keys disagree');
    const { session_id, ...query } = fields;
    const binding = parseCheckpointBinding(
      session_id,
      lookup
        ? query
        : {
            request_key: key ?? fields.idempotency_key,
            checkpoint: parseCheckpointSaveCommand(fields),
          },
      expected_identity,
      scope,
    );
    return {
      lookup,
      binding,
      input: lookup
        ? { session_id: binding.session_id, ...binding.query }
        : { ...binding.query.checkpoint },
    };
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid original checkpoint',
      { trace_id: trace },
    );
  }
}
export function checkpointResult(value: unknown, prepared: PreparedCheckpoint, trace: string) {
  try {
    return prepared.lookup
      ? parseCheckpointReceiptEnvelope(value, prepared.binding, trace)
      : parseCheckpointSaveEnvelope(value, prepared.binding, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The checkpoint response could not be confirmed. Keep the original identity, notes, references, version and key, then query its receipt.',
      { trace_id: trace, retryable: true },
    );
  }
}

export function prepareCheckpointRead(
  command: string,
  input: unknown,
  trace: string,
  key?: string,
) {
  if (command !== 'checkpoints get') return;
  try {
    if (key !== undefined) throw new TypeError('Checkpoint detail reads do not accept --key');
    return parseCheckpointReadQuery(input);
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid checkpoint detail query',
      { trace_id: trace },
    );
  }
}
export function checkpointReadResult(
  value: unknown,
  query: CheckpointReadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
) {
  try {
    return parseCheckpointReadEnvelope(value, query, scope, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested historical checkpoint detail',
      { trace_id: trace },
    );
  }
}
