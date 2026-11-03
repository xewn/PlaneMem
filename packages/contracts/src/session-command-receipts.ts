import { isUlid } from './ids.js';
import { validateIdempotencyKey } from './metadata.js';

export type SessionCommandOperation =
  | 'run.start'
  | 'run.finish'
  | 'tool.call'
  | 'tool.finish'
  | 'end';

export interface SessionCommandReceiptQuery {
  request_key: string;
  operation: SessionCommandOperation;
  /** Exact original body, including the effective version originally supplied by If-Match. */
  command: Record<string, unknown> & { expected_version: number };
}

export type SessionCommandReceiptLookup =
  | { status: 'not-observed'; session_id: string; operation: SessionCommandOperation }
  | ({ status: 'recorded'; session_id: string; session_version: number } & (
      | { operation: 'run.start'; run_id: string; sequence: number }
      | {
          operation: 'run.finish';
          run_id: string;
          run_version: number;
          run_status: 'completed' | 'failed';
          changed: boolean;
        }
      | { operation: 'tool.call'; run_id: string; tool_call_id: string }
      | {
          operation: 'tool.finish';
          run_id: string;
          tool_call_id: string;
          tool_version: number;
          tool_status: 'succeeded' | 'failed';
          changed: boolean;
        }
      | { operation: 'end'; ended_status: 'ended' | 'abandoned' | 'failed' }
    ));

export function parseSessionCommandReceiptQuery(value: unknown): SessionCommandReceiptQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a session command receipt query');
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some((key) => !['request_key', 'operation', 'command'].includes(key)))
    throw new TypeError('Only request_key, operation and command are accepted');
  if (
    !['run.start', 'run.finish', 'tool.call', 'tool.finish', 'end'].includes(
      query.operation as string,
    )
  )
    throw new TypeError('operation must be run.start, run.finish, tool.call, tool.finish or end');
  const request_key = validateIdempotencyKey(query.request_key);
  if (!query.command || typeof query.command !== 'object' || Array.isArray(query.command))
    throw new TypeError('command must contain the original request');
  const command = query.command as Record<string, unknown>;
  if (
    typeof command.expected_version !== 'number' ||
    !Number.isSafeInteger(command.expected_version) ||
    command.expected_version < 1
  )
    throw new TypeError('Include the original expected_version');
  if (command.idempotency_key !== undefined && command.idempotency_key !== request_key)
    throw new TypeError('Original idempotency_key and request_key disagree');
  if (
    query.operation === 'run.finish' &&
    (!isUlid(command.run_id) ||
      typeof command.expected_run_version !== 'number' ||
      !Number.isSafeInteger(command.expected_run_version) ||
      command.expected_run_version < 1 ||
      !['completed', 'failed'].includes(command.status as string))
  )
    throw new TypeError('Include the original run_id, expected_run_version and terminal status');
  if (
    query.operation === 'tool.finish' &&
    (!isUlid(command.tool_call_id) ||
      typeof command.expected_tool_version !== 'number' ||
      !Number.isSafeInteger(command.expected_tool_version) ||
      command.expected_tool_version < 1 ||
      !['succeeded', 'failed'].includes(command.status as string))
  )
    throw new TypeError(
      'Include the original tool_call_id, expected_tool_version and terminal status',
    );
  if (
    query.operation === 'tool.call' &&
    (!isUlid(command.run_id) ||
      typeof command.tool_name !== 'string' ||
      !command.tool_name.trim() ||
      !['started', 'succeeded', 'failed'].includes(command.status as string))
  )
    throw new TypeError('Include the original run_id, tool_name and status');
  if (
    query.operation === 'end' &&
    !['ended', 'abandoned', 'failed'].includes(command.status as string)
  )
    throw new TypeError('Include the original end status');
  // Extra fields and original values belong to the fingerprint, even when a handler ignores them.
  return {
    request_key,
    operation: query.operation as SessionCommandOperation,
    command: { ...command, expected_version: command.expected_version },
  };
}

export function parseSessionCommandReceiptLookup(
  value: unknown,
  sessionId: string,
  query: SessionCommandReceiptQuery,
): SessionCommandReceiptLookup {
  const fail = (): never => {
    throw new TypeError('Invalid session command receipt response');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const receipt = value as Record<string, unknown>;
  if (receipt.session_id !== sessionId || receipt.operation !== query.operation) return fail();
  if (receipt.status === 'not-observed')
    return { status: 'not-observed', session_id: sessionId, operation: query.operation };
  if (
    receipt.status !== 'recorded' ||
    typeof receipt.session_version !== 'number' ||
    !Number.isSafeInteger(receipt.session_version) ||
    receipt.session_version < 1
  )
    return fail();
  const base = {
    status: 'recorded' as const,
    session_id: sessionId,
    session_version: receipt.session_version,
  };
  if (query.operation === 'end') {
    if (
      !['ended', 'abandoned', 'failed'].includes(receipt.ended_status as string) ||
      receipt.ended_status !== query.command.status ||
      ![query.command.expected_version, query.command.expected_version + 1].includes(
        receipt.session_version,
      )
    )
      return fail();
    return {
      ...base,
      operation: 'end',
      ended_status: receipt.ended_status as 'ended' | 'abandoned' | 'failed',
    };
  }
  if (query.operation === 'run.finish') {
    if (
      !isUlid(receipt.run_id) ||
      receipt.run_id !== query.command.run_id ||
      typeof receipt.changed !== 'boolean' ||
      typeof query.command.expected_run_version !== 'number' ||
      !Number.isSafeInteger(query.command.expected_run_version) ||
      query.command.expected_run_version < 1 ||
      typeof receipt.run_version !== 'number' ||
      !Number.isSafeInteger(receipt.run_version) ||
      receipt.run_version !== query.command.expected_run_version + (receipt.changed ? 1 : 0) ||
      receipt.session_version !== query.command.expected_version + (receipt.changed ? 1 : 0) ||
      !['completed', 'failed'].includes(receipt.run_status as string) ||
      receipt.run_status !== query.command.status
    )
      return fail();
    return {
      ...base,
      operation: 'run.finish',
      run_id: receipt.run_id,
      run_version: receipt.run_version,
      run_status: receipt.run_status as 'completed' | 'failed',
      changed: receipt.changed,
    };
  }
  if (query.operation === 'tool.finish') {
    if (
      !isUlid(receipt.run_id) ||
      !isUlid(receipt.tool_call_id) ||
      receipt.tool_call_id !== query.command.tool_call_id ||
      typeof receipt.changed !== 'boolean' ||
      typeof query.command.expected_tool_version !== 'number' ||
      !Number.isSafeInteger(query.command.expected_tool_version) ||
      query.command.expected_tool_version < 1 ||
      typeof receipt.tool_version !== 'number' ||
      !Number.isSafeInteger(receipt.tool_version) ||
      receipt.tool_version !== query.command.expected_tool_version + (receipt.changed ? 1 : 0) ||
      receipt.session_version !== query.command.expected_version + (receipt.changed ? 1 : 0) ||
      !['succeeded', 'failed'].includes(receipt.tool_status as string) ||
      receipt.tool_status !== query.command.status
    )
      return fail();
    return {
      ...base,
      operation: 'tool.finish',
      run_id: receipt.run_id,
      tool_call_id: receipt.tool_call_id,
      tool_version: receipt.tool_version,
      tool_status: receipt.tool_status as 'succeeded' | 'failed',
      changed: receipt.changed,
    };
  }
  if (receipt.session_version !== query.command.expected_version + 1 || !isUlid(receipt.run_id))
    return fail();
  if (query.operation === 'run.start') {
    if (
      typeof receipt.sequence !== 'number' ||
      !Number.isSafeInteger(receipt.sequence) ||
      receipt.sequence < 1 ||
      receipt.sequence > 2147483647
    )
      return fail();
    return { ...base, operation: 'run.start', run_id: receipt.run_id, sequence: receipt.sequence };
  }
  if (!isUlid(receipt.tool_call_id) || receipt.run_id !== query.command.run_id) return fail();
  return {
    ...base,
    operation: 'tool.call',
    run_id: receipt.run_id,
    tool_call_id: receipt.tool_call_id,
  };
}
