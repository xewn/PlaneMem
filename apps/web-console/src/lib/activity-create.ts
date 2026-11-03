import {
  isUlid,
  validateIdempotencyKey,
  parseSessionCommandBinding,
  parseSessionActivityCreateEnvelope,
  parseSessionCommandIdentity,
  parseSessionCommandReceiptLookup,
  parseSessionRunDetail,
  parseSessionRunPage,
  type SessionCommandIdentity,
  type SessionCommandReceiptLookup,
  type SessionCommandReceiptQuery,
  type SessionActivitySession,
  type SessionRunRecord,
} from '@planemem/contracts';

export type ActivityCreateOperation = 'run.start' | 'tool.call';
export type ToolInitialStatus = 'started' | 'succeeded' | 'failed';
export const ACTIVITY_CREATE_RECOVERY_LIMIT = 32768;
export function activityCreateRecoveryStorageKey(
  identity: SessionCommandIdentity | undefined,
  sessionId: string,
  operation: ActivityCreateOperation,
  runId?: string,
): string {
  return 'planemem-activity-create-v1:' + JSON.stringify([identity, sessionId, operation, runId]);
}
export type ActivityCreateRequest = {
  identity: SessionCommandIdentity;
  sessionId: string;
  key: string;
  version: number;
} & (
  | { operation: 'run.start'; model?: string }
  | { operation: 'tool.call'; runId: string; toolName: string; status: ToolInitialStatus }
);
export type ActivityCreateReceipt = Extract<
  SessionCommandReceiptLookup,
  { status: 'recorded'; operation: ActivityCreateOperation }
>;
export type ActivityCreateFeedback =
  | { status: 'idle' }
  | {
      status: 'error';
      request: ActivityCreateRequest;
      uncertain: boolean;
      message: string;
      trace?: string;
    }
  | {
      status: 'done';
      request: ActivityCreateRequest;
      receipt: ActivityCreateReceipt;
      message: string;
      trace?: string;
    };
export interface ActivityCreateState {
  session: SessionActivitySession;
  run?: SessionRunRecord;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid activity creation data.');
  return value as Record<string, unknown>;
}
function name(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Enter a name of at most 1024 characters without control characters.');
  // Preserve original characters: they are part of the stored request fingerprint.
  return value;
}
export function parseActivityCreateRequest(value: unknown): ActivityCreateRequest {
  const row = object(value);
  const fields = [
    'identity',
    'sessionId',
    'key',
    'version',
    'operation',
    ...(row.operation === 'run.start' ? ['model'] : ['runId', 'toolName', 'status']),
  ];
  if (
    Object.keys(row).some((key) => !fields.includes(key)) ||
    !isUlid(row.sessionId) ||
    typeof row.version !== 'number' ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    !Number.isSafeInteger(row.version + 1)
  )
    throw new TypeError('Invalid original activity request.');
  const base = {
    identity: parseSessionCommandIdentity(row.identity),
    sessionId: row.sessionId,
    key: validateIdempotencyKey(row.key),
    version: row.version,
  };
  if (row.operation === 'run.start')
    return {
      ...base,
      operation: 'run.start',
      ...(row.model === undefined ? {} : { model: name(row.model) }),
    };
  if (
    row.operation === 'tool.call' &&
    isUlid(row.runId) &&
    ['started', 'succeeded', 'failed'].includes(row.status as string)
  )
    return {
      ...base,
      operation: 'tool.call',
      runId: row.runId,
      toolName: name(row.toolName),
      status: row.status as ToolInitialStatus,
    };
  throw new TypeError('Invalid original activity operation.');
}
export function sameActivityCreate(left: ActivityCreateRequest, right: ActivityCreateRequest) {
  return (
    JSON.stringify(parseActivityCreateRequest(left)) ===
    JSON.stringify(parseActivityCreateRequest(right))
  );
}
export function activityCreateQuery(raw: ActivityCreateRequest): SessionCommandReceiptQuery {
  const request = parseActivityCreateRequest(raw);
  return {
    request_key: request.key,
    operation: request.operation,
    command: {
      expected_version: request.version,
      ...(request.operation === 'run.start'
        ? request.model === undefined
          ? {}
          : { model: request.model }
        : { run_id: request.runId, tool_name: request.toolName, status: request.status }),
    },
  };
}
export function recordedActivityCreate(
  value: unknown,
  request: ActivityCreateRequest,
): ActivityCreateReceipt {
  const receipt = parseSessionCommandReceiptLookup(
    value,
    request.sessionId,
    activityCreateQuery(request),
  );
  if (
    receipt.status !== 'recorded' ||
    (receipt.operation !== 'run.start' && receipt.operation !== 'tool.call')
  )
    throw new TypeError('No matching original activity receipt.');
  return receipt;
}
/** Normal creation returns the original committed record, including on replay. */
export function parseActivityCreateResponse(
  value: unknown,
  request: ActivityCreateRequest,
  trace: string,
): ActivityCreateReceipt {
  const binding = parseSessionCommandBinding(
    request.sessionId,
    activityCreateQuery(request),
    request.identity,
    request.identity,
  );
  const { data } = parseSessionActivityCreateEnvelope(value, binding, trace);
  return recordedActivityCreate(
    {
      status: 'recorded',
      operation: request.operation,
      session_id: request.sessionId,
      session_version: data.session_version,
      run_id: data.run_id,
      ...('sequence' in data ? { sequence: data.sequence } : { tool_call_id: data.tool_call_id }),
    },
    request,
  );
}
export function parseActivityCreateState(
  value: unknown,
  sessionId: string,
  runId?: string,
): ActivityCreateState {
  const row = object(value);
  return runId === undefined
    ? { session: parseSessionRunPage({ session: row.session, runs: [] }, sessionId).session }
    : parseSessionRunDetail(row, sessionId, runId);
}
export function parseActivityCreateFeedback(
  value: unknown,
  expected: ActivityCreateRequest,
): Exclude<ActivityCreateFeedback, { status: 'idle' }> {
  const row = object(value);
  const request = parseActivityCreateRequest(row.request);
  if (
    !sameActivityCreate(request, expected) ||
    typeof row.message !== 'string' ||
    row.message.length > 4000 ||
    (row.trace !== undefined && (typeof row.trace !== 'string' || row.trace.length > 1024))
  )
    throw new TypeError('Activity feedback mismatch.');
  const base = {
    request,
    message: row.message,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
  if (row.status === 'error' && typeof row.uncertain === 'boolean')
    return { ...base, status: 'error', uncertain: row.uncertain };
  if (row.status === 'done' && row.uncertain !== true)
    return { ...base, status: 'done', receipt: recordedActivityCreate(row.receipt, request) };
  throw new TypeError('Invalid activity feedback.');
}
export function encodeActivityCreateRecovery(request: ActivityCreateRequest): string {
  const raw = JSON.stringify({ schema_version: 1, request: parseActivityCreateRequest(request) });
  if (raw.length > ACTIVITY_CREATE_RECOVERY_LIMIT)
    throw new TypeError('Recovery text is too large.');
  return raw;
}
export function decodeActivityCreateRecovery(raw: string): ActivityCreateRequest {
  if (!raw || raw.length > ACTIVITY_CREATE_RECOVERY_LIMIT)
    throw new TypeError('Recovery text is too large.');
  const row = object(JSON.parse(raw));
  if (
    row.schema_version !== 1 ||
    Object.keys(row).some((key) => !['schema_version', 'request'].includes(key))
  )
    throw new TypeError('Unsupported activity recovery format.');
  return parseActivityCreateRequest(row.request);
}
