import {
  parseSessionStartBinding,
  parseSessionStartReceiptLookup,
  parseSessionCommandIdentity,
  type SessionCommandIdentity,
  type SessionStartCommand,
  type SessionStartRecorded,
} from '@planemem/contracts';

export const START_RECOVERY_LIMIT = 32768;
export function startRecoveryStorageKey(identity: SessionCommandIdentity | undefined): string {
  return 'planemem-session-start-v1:' + JSON.stringify(identity);
}
export interface StartRequest {
  identity: SessionCommandIdentity;
  session: SessionStartCommand;
  key: string;
}
export type StartFeedback =
  | { status: 'idle' }
  | { status: 'error'; request: StartRequest; uncertain: boolean; message: string; trace?: string }
  | {
      status: 'done';
      request: StartRequest;
      receipt: SessionStartRecorded;
      message: string;
      trace?: string;
    };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid start recovery data');
  return value as Record<string, unknown>;
}
export function parseStartRequest(value: unknown): StartRequest {
  const row = object(value);
  if (Object.keys(row).some((key) => !['identity', 'session', 'key'].includes(key)))
    throw new TypeError('Unknown original start field');
  const identity = parseSessionCommandIdentity(row.identity);
  const binding = parseSessionStartBinding(
    { request_key: row.key, session: row.session },
    identity,
    identity,
  );
  return { identity, session: binding.query.session, key: binding.query.request_key };
}
export function sameStart(left: StartRequest, right: StartRequest): boolean {
  return JSON.stringify(parseStartRequest(left)) === JSON.stringify(parseStartRequest(right));
}
export function recordedStart(value: unknown, request: StartRequest): SessionStartRecorded {
  const receipt = parseSessionStartReceiptLookup(value, request.session, request.identity);
  if (receipt.status !== 'recorded') throw new TypeError('No matching original start receipt');
  return receipt;
}
export function parseStartFeedback(
  value: unknown,
  expected: StartRequest,
): Exclude<StartFeedback, { status: 'idle' }> {
  const row = object(value);
  const request = parseStartRequest(row.request);
  if (
    !sameStart(request, expected) ||
    typeof row.message !== 'string' ||
    row.message.length > 4000 ||
    (row.trace !== undefined && (typeof row.trace !== 'string' || row.trace.length > 1024))
  )
    throw new TypeError('Start feedback mismatch');
  const base = {
    request,
    message: row.message,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
  if (row.status === 'error' && typeof row.uncertain === 'boolean')
    return { ...base, status: 'error', uncertain: row.uncertain };
  if (row.status === 'done' && row.uncertain !== true)
    return { ...base, status: 'done', receipt: recordedStart(row.receipt, request) };
  throw new TypeError('Invalid start feedback');
}
export function encodeStartRecovery(request: StartRequest): string {
  const raw = JSON.stringify({
    schema_version: 1,
    operation: 'session.start',
    request: parseStartRequest(request),
  });
  if (raw.length > START_RECOVERY_LIMIT) throw new TypeError('Start recovery text is too large');
  return raw;
}
export function decodeStartRecovery(raw: string): StartRequest {
  if (!raw || raw.length > START_RECOVERY_LIMIT)
    throw new TypeError('Start recovery text is too large');
  const row = object(JSON.parse(raw));
  if (
    row.schema_version !== 1 ||
    row.operation !== 'session.start' ||
    Object.keys(row).some((key) => !['schema_version', 'operation', 'request'].includes(key))
  )
    throw new TypeError('Unsupported start recovery format');
  return parseStartRequest(row.request);
}
