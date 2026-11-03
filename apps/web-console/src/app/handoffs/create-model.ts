import {
  isUlid,
  validateIdempotencyKey,
  parseSessionCommandIdentity,
  parseHandoffCreateCommand,
  parseHandoffCreateReceiptLookup,
  type SessionCommandIdentity,
  type HandoffCreateRecorded,
} from '@planemem/contracts';

export const CREATE_RECOVERY_LIMIT = 32768;
export interface CreateRequest {
  identity: SessionCommandIdentity;
  sessionId: string;
  checkpointId: string;
  target?: string;
  key: string;
}
export type CreateFeedback =
  | { status: 'idle' }
  | { status: 'error'; request: CreateRequest; uncertain: boolean; message: string; trace?: string }
  | {
      status: 'done';
      request: CreateRequest;
      receipt: HandoffCreateRecorded;
      message: string;
      trace?: string;
    };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid creation recovery data');
  return value as Record<string, unknown>;
}
export function parseCreateRequest(value: unknown): CreateRequest {
  const row = object(value);
  if (
    Object.keys(row).some(
      (key) => !['identity', 'sessionId', 'checkpointId', 'target', 'key'].includes(key),
    ) ||
    !isUlid(row.sessionId)
  )
    throw new TypeError('Invalid original creation request');
  const command = parseHandoffCreateCommand({
    checkpoint_id: row.checkpointId,
    ...(row.target === undefined ? {} : { target_client: row.target }),
  });
  return {
    identity: parseSessionCommandIdentity(row.identity),
    sessionId: row.sessionId,
    checkpointId: command.checkpoint_id,
    ...(command.target_client === undefined ? {} : { target: command.target_client }),
    key: validateIdempotencyKey(row.key),
  };
}
export function sameCreation(left: CreateRequest, right: CreateRequest): boolean {
  return JSON.stringify(parseCreateRequest(left)) === JSON.stringify(parseCreateRequest(right));
}
export function recordedCreation(value: unknown, request: CreateRequest): HandoffCreateRecorded {
  const receipt = parseHandoffCreateReceiptLookup(
    value,
    request.sessionId,
    {
      checkpoint_id: request.checkpointId,
      ...(request.target === undefined ? {} : { target_client: request.target }),
    },
    request.identity,
  );
  if (receipt.status !== 'recorded') throw new TypeError('No matching creation receipt');
  return receipt;
}
export function parseCreateFeedback(
  value: unknown,
  expected: CreateRequest,
): Exclude<CreateFeedback, { status: 'idle' }> {
  const row = object(value);
  const request = parseCreateRequest(row.request);
  if (
    !sameCreation(request, expected) ||
    typeof row.message !== 'string' ||
    row.message.length > 4000 ||
    (row.trace !== undefined && (typeof row.trace !== 'string' || row.trace.length > 1024))
  )
    throw new TypeError('Creation feedback mismatch');
  const base = {
    request,
    message: row.message,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
  if (row.status === 'error' && typeof row.uncertain === 'boolean')
    return { ...base, status: 'error', uncertain: row.uncertain };
  if (row.status === 'done' && row.uncertain !== true)
    return { ...base, status: 'done', receipt: recordedCreation(row.receipt, request) };
  throw new TypeError('Invalid creation feedback');
}
export function encodeCreateRecovery(request: CreateRequest): string {
  const raw = JSON.stringify({
    schema_version: 1,
    operation: 'handoff.create',
    request: parseCreateRequest(request),
  });
  if (raw.length > CREATE_RECOVERY_LIMIT)
    throw new TypeError('Creation recovery text is too large');
  return raw;
}
export function decodeCreateRecovery(raw: string): CreateRequest {
  if (!raw || raw.length > CREATE_RECOVERY_LIMIT)
    throw new TypeError('Creation recovery text is too large');
  const row = object(JSON.parse(raw));
  if (
    row.schema_version !== 1 ||
    row.operation !== 'handoff.create' ||
    Object.keys(row).some((key) => !['schema_version', 'operation', 'request'].includes(key))
  )
    throw new TypeError('Unsupported creation recovery format');
  return parseCreateRequest(row.request);
}
