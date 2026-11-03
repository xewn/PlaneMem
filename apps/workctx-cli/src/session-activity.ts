import {
  ContractError,
  parseSessionCommandBinding,
  parseSessionActivityCreateCommand,
  parseSessionActivityCreateEnvelope,
  parseSessionCommandReceiptEnvelope,
  parseSessionFinishCommand,
  parseSessionFinishEnvelope,
  type SessionCommandBinding,
} from '@planemem/contracts';

export interface PreparedSessionActivity {
  lookup: boolean;
  binding: SessionCommandBinding;
  input: Record<string, unknown>;
}
export function isSessionActivityCommand(command: string): boolean {
  return [
    'runs start',
    'tool-calls record',
    'runs finish',
    'tool-calls finish',
    'sessions end',
    'sessions receipt',
  ].includes(command);
}
export function prepareSessionActivity(
  command: string,
  input: Record<string, unknown>,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
  key?: string,
): PreparedSessionActivity | undefined {
  if (!isSessionActivityCommand(command)) return;
  try {
    const lookup = command === 'sessions receipt';
    const { expected_identity, ...fields } = input;
    if (lookup && (key !== undefined || fields.idempotency_key !== undefined))
      throw new TypeError(
        'Session receipt queries use the original request_key in JSON without --key',
      );
    if (
      !lookup &&
      key !== undefined &&
      fields.idempotency_key !== undefined &&
      key !== fields.idempotency_key
    )
      throw new TypeError('Activity request keys disagree');
    const { session_id, ...query } = fields;
    const operation =
      command === 'runs start'
        ? 'run.start'
        : command === 'tool-calls record'
          ? 'tool.call'
          : command === 'runs finish'
            ? 'run.finish'
            : command === 'tool-calls finish'
              ? 'tool.finish'
              : 'end';
    const binding = parseSessionCommandBinding(
      session_id,
      lookup
        ? query
        : {
            operation,
            request_key: key ?? fields.idempotency_key,
            command:
              operation === 'run.start' || operation === 'tool.call'
                ? parseSessionActivityCreateCommand(operation, fields)
                : parseSessionFinishCommand(operation, fields),
          },
      expected_identity,
      scope,
    );
    return {
      lookup,
      binding,
      input: lookup
        ? { session_id: binding.session_id, ...binding.query }
        : { ...binding.query.command },
    };
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid original activity command',
      { trace_id: trace },
    );
  }
}
export function sessionActivityResult(
  value: unknown,
  prepared: PreparedSessionActivity,
  trace: string,
) {
  try {
    return prepared.lookup
      ? parseSessionCommandReceiptEnvelope(value, prepared.binding, trace)
      : prepared.binding.query.operation === 'run.start' ||
          prepared.binding.query.operation === 'tool.call'
        ? parseSessionActivityCreateEnvelope(value, prepared.binding, trace)
        : parseSessionFinishEnvelope(value, prepared.binding, trace);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The activity response could not be confirmed. Keep the original identity, parameters, version and key, then query its receipt.',
      { trace_id: trace, retryable: true },
    );
  }
}
