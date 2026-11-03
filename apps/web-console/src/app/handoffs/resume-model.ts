import {
  isUlid,
  parseSessionCommandIdentity,
  parseResumeReceiptLookup,
  type SessionCommandIdentity,
  type ResumeReceiptLookup,
} from '@planemem/contracts';

export const RESUME_RECOVERY_LIMIT = 32768;
export interface ResumeRequest {
  identity: SessionCommandIdentity;
  parentSessionId: string;
  handoffId: string;
  checkpointId: string;
  key: string;
  requireClaimed: true;
}
export function resumeRecoveryStorageKey(
  identity: SessionCommandIdentity | undefined,
  session: string,
  handoff: string,
): string {
  return 'planemem-session-resume-v1:' + JSON.stringify([identity, session, handoff]);
}
export type ResumeFeedback =
  | { status: 'idle' }
  | { status: 'error'; request: ResumeRequest; uncertain: boolean; message: string; trace?: string }
  | {
      status: 'done';
      request: ResumeRequest;
      receipt: Extract<ResumeReceiptLookup, { status: 'recorded' }>;
      message: string;
      trace?: string;
      contextPackId?: string;
      nextActions?: string[];
    };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid resume recovery data');
  return value as Record<string, unknown>;
}
export function parseResumeRequest(value: unknown): ResumeRequest {
  const row = record(value);
  if (
    Object.keys(row).some(
      (key) =>
        ![
          'identity',
          'parentSessionId',
          'handoffId',
          'checkpointId',
          'key',
          'requireClaimed',
        ].includes(key),
    ) ||
    !isUlid(row.parentSessionId) ||
    !isUlid(row.handoffId) ||
    !isUlid(row.checkpointId) ||
    row.key !== `workbench-resume-${row.handoffId}` ||
    row.requireClaimed !== true
  )
    throw new TypeError('Invalid original resume request');
  return {
    identity: parseSessionCommandIdentity(row.identity),
    parentSessionId: row.parentSessionId,
    handoffId: row.handoffId,
    checkpointId: row.checkpointId,
    key: row.key as string,
    requireClaimed: true,
  };
}
export function sameResume(left: ResumeRequest, right: ResumeRequest): boolean {
  return JSON.stringify(parseResumeRequest(left)) === JSON.stringify(parseResumeRequest(right));
}
export function recordedResume(value: unknown, request: ResumeRequest) {
  const receipt = parseResumeReceiptLookup(value, request.parentSessionId, request.handoffId);
  if (
    receipt.status !== 'recorded' ||
    receipt.require_claimed !== true ||
    receipt.checkpoint_id !== request.checkpointId ||
    receipt.session_id === request.parentSessionId
  )
    throw new TypeError('Resume receipt does not match the original request');
  return receipt;
}
export function parseResumeNextActions(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 200 ||
    Object.keys(value).length !== value.length ||
    value.some(
      (item) =>
        typeof item !== 'string' ||
        item.length > 16384 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cs}]/u.test(item),
    ) ||
    value.join('\n').length > 16384
  )
    throw new TypeError('Invalid resume next actions');
  return [...value] as string[];
}
export function parseResumeFeedback(
  value: unknown,
  expected: ResumeRequest,
): Exclude<ResumeFeedback, { status: 'idle' }> {
  const row = record(value);
  const request = parseResumeRequest(row.request);
  if (
    !sameResume(request, expected) ||
    typeof row.message !== 'string' ||
    row.message.length > 4000 ||
    (row.trace !== undefined && (typeof row.trace !== 'string' || row.trace.length > 1024))
  )
    throw new TypeError('Resume feedback mismatch');
  const base = {
    request,
    message: row.message,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
  if (row.status === 'error' && typeof row.uncertain === 'boolean')
    return { ...base, status: 'error', uncertain: row.uncertain };
  if (
    row.status !== 'done' ||
    row.uncertain === true ||
    (row.contextPackId !== undefined && !isUlid(row.contextPackId))
  )
    throw new TypeError('Invalid resume feedback');
  return {
    ...base,
    status: 'done',
    receipt: recordedResume(row.receipt, request),
    ...(typeof row.contextPackId === 'string' ? { contextPackId: row.contextPackId } : {}),
    ...(row.nextActions === undefined
      ? {}
      : { nextActions: parseResumeNextActions(row.nextActions) }),
  };
}
export function encodeResumeRecovery(request: ResumeRequest): string {
  const raw = JSON.stringify({
    schema_version: 1,
    operation: 'session.resume',
    request: parseResumeRequest(request),
  });
  if (raw.length > RESUME_RECOVERY_LIMIT) throw new TypeError('Resume recovery text is too large');
  return raw;
}
export function decodeResumeRecovery(raw: string): ResumeRequest {
  if (!raw || raw.length > RESUME_RECOVERY_LIMIT)
    throw new TypeError('Resume recovery text is too large');
  const row = record(JSON.parse(raw));
  if (
    row.schema_version !== 1 ||
    row.operation !== 'session.resume' ||
    Object.keys(row).some((key) => !['schema_version', 'operation', 'request'].includes(key))
  )
    throw new TypeError('Unsupported resume recovery format');
  return parseResumeRequest(row.request);
}
