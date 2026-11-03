import {
  isUlid,
  validateIdempotencyKey,
  parseSessionCommandIdentity,
  parseSessionCommandReceiptLookup,
  type SessionCommandIdentity,
  type SessionCommandReceiptLookup,
  type SessionCommandReceiptQuery,
} from '@planemem/contracts';

export type FinishOperation = 'run.finish' | 'tool.finish' | 'end';
export function finishRecoveryStorageKey(
  identity: SessionCommandIdentity | undefined,
  operation: FinishOperation,
  sessionId: string,
  resourceId: string,
): string {
  return (
    'planemem-session-finish-v1:' + JSON.stringify([identity, operation, sessionId, resourceId])
  );
}
export type FinishOutcome = 'completed' | 'succeeded' | 'failed' | 'ended' | 'abandoned';
interface FinishRequestBase {
  identity: SessionCommandIdentity;
  key: string;
  sessionId: string;
  version: number;
}
export type FinishRequest = FinishRequestBase &
  (
    | {
        operation: 'run.finish';
        resourceId: string;
        resourceVersion: number;
        outcome: 'completed' | 'failed';
      }
    | {
        operation: 'tool.finish';
        resourceId: string;
        resourceVersion: number;
        outcome: 'succeeded' | 'failed';
      }
    | {
        operation: 'end';
        outcome: 'ended' | 'abandoned' | 'failed';
        resourceId?: never;
        resourceVersion?: never;
      }
  );
export type FinishReceipt = Extract<
  SessionCommandReceiptLookup,
  { status: 'recorded'; operation: FinishOperation }
>;
export type FinishFeedback =
  | { status: 'idle' }
  | { status: 'error'; request: FinishRequest; uncertain: boolean; message: string; trace?: string }
  | {
      status: 'done';
      request: FinishRequest;
      receipt: FinishReceipt;
      message: string;
      trace?: string;
    };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid result recovery data');
  return value as Record<string, unknown>;
}
export function parseFinishRequest(value: unknown): FinishRequest {
  const row = object(value);
  const fields = ['operation', 'identity', 'key', 'sessionId', 'version', 'outcome'];
  if (row.operation !== 'end') fields.push('resourceId', 'resourceVersion');
  if (
    Object.keys(row).some((key) => !fields.includes(key)) ||
    (row.operation !== 'run.finish' &&
      row.operation !== 'tool.finish' &&
      row.operation !== 'end') ||
    !isUlid(row.sessionId) ||
    typeof row.version !== 'number' ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    typeof row.outcome !== 'string'
  )
    throw new TypeError('Invalid original result request');
  validateIdempotencyKey(row.key);
  const base: FinishRequestBase = {
    identity: parseSessionCommandIdentity(row.identity),
    key: row.key as string,
    sessionId: row.sessionId,
    version: row.version,
  };
  if (row.operation === 'end') {
    if (row.outcome !== 'ended' && row.outcome !== 'abandoned' && row.outcome !== 'failed')
      throw new TypeError('Invalid closing status');
    return { ...base, operation: 'end', outcome: row.outcome };
  }
  if (
    !isUlid(row.resourceId) ||
    typeof row.resourceVersion !== 'number' ||
    !Number.isSafeInteger(row.resourceVersion) ||
    row.resourceVersion < 1
  )
    throw new TypeError('Invalid original activity binding');
  const resource = { resourceId: row.resourceId, resourceVersion: row.resourceVersion };
  if (row.operation === 'run.finish' && (row.outcome === 'completed' || row.outcome === 'failed'))
    return { ...base, ...resource, operation: 'run.finish', outcome: row.outcome };
  if (row.operation === 'tool.finish' && (row.outcome === 'succeeded' || row.outcome === 'failed'))
    return { ...base, ...resource, operation: 'tool.finish', outcome: row.outcome };
  throw new TypeError('Invalid activity outcome');
}
export function sameFinishRequest(left: FinishRequest, right: FinishRequest): boolean {
  return JSON.stringify(parseFinishRequest(left)) === JSON.stringify(parseFinishRequest(right));
}
export function finishReceiptQuery(request: FinishRequest): SessionCommandReceiptQuery {
  return {
    request_key: request.key,
    operation: request.operation,
    command: {
      ...(request.operation === 'run.finish'
        ? { run_id: request.resourceId, expected_run_version: request.resourceVersion }
        : request.operation === 'tool.finish'
          ? { tool_call_id: request.resourceId, expected_tool_version: request.resourceVersion }
          : {}),
      status: request.outcome,
      expected_version: request.version,
    },
  };
}
export function parseFinishFeedback(
  value: unknown,
  expected: FinishRequest,
): Exclude<FinishFeedback, { status: 'idle' }> {
  const row = object(value);
  const request = parseFinishRequest(row.request);
  if (
    !sameFinishRequest(request, expected) ||
    typeof row.message !== 'string' ||
    row.message.length > 4000 ||
    (row.trace !== undefined && (typeof row.trace !== 'string' || row.trace.length > 1024))
  )
    throw new TypeError('The result does not match the original request');
  const base = {
    request,
    message: row.message,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
  if (row.status === 'done') {
    const receipt = parseSessionCommandReceiptLookup(
      row.receipt,
      request.sessionId,
      finishReceiptQuery(request),
    );
    if (
      receipt.status !== 'recorded' ||
      (receipt.operation !== 'run.finish' &&
        receipt.operation !== 'tool.finish' &&
        receipt.operation !== 'end') ||
      row.uncertain === true
    )
      throw new TypeError('Invalid result receipt');
    return { ...base, status: 'done', receipt };
  }
  if (row.status === 'error' && typeof row.uncertain === 'boolean')
    return { ...base, status: 'error', uncertain: row.uncertain };
  throw new TypeError('Invalid result feedback');
}

export const FINISH_RECOVERY_LIMIT = 32768;
/** Recovery files carry the original request only, never trusted success or confirmation flags. */
export function decodeFinishRecovery(raw: string): FinishRequest {
  if (!raw || raw.length > FINISH_RECOVERY_LIMIT)
    throw new TypeError('Recovery data exceeds its limit');
  const row = object(JSON.parse(raw));
  if (
    row.schema_version !== 1 ||
    Object.keys(row).some((key) => !['schema_version', 'request'].includes(key))
  )
    throw new TypeError('Unsupported result recovery format');
  return parseFinishRequest(row.request);
}
export function encodeFinishRecovery(request: FinishRequest): string {
  const raw = JSON.stringify({ schema_version: 1, request: parseFinishRequest(request) });
  if (raw.length > FINISH_RECOVERY_LIMIT) throw new TypeError('Recovery data exceeds its limit');
  return raw;
}
