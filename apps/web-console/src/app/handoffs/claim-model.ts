import {
  isUlid,
  parseSessionCommandIdentity,
  parseHandoffClaimCommand,
  parseHandoffClaimReceiptLookup,
  type SessionCommandIdentity,
  type HandoffClaimRecorded,
} from '@planemem/contracts';

export const CLAIM_RECOVERY_LIMIT = 32768;
export interface ClaimRequest {
  identity: SessionCommandIdentity;
  sessionId: string;
  handoffId: string;
  checkpointId: string;
  version: number;
  key: string;
}
export function claimRecoveryStorageKey(
  identity: SessionCommandIdentity | undefined,
  session: string,
  handoff: string,
): string {
  return 'planemem-handoff-claim-v1:' + JSON.stringify([identity, session, handoff]);
}
export type ClaimFeedback =
  | { status: 'idle' }
  | { status: 'error'; request: ClaimRequest; uncertain: boolean; message: string; trace?: string }
  | {
      status: 'done';
      request: ClaimRequest;
      receipt: HandoffClaimRecorded;
      message: string;
      trace?: string;
    };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid claim recovery data');
  return value as Record<string, unknown>;
}
export function parseClaimRequest(value: unknown): ClaimRequest {
  const row = object(value);
  const command = parseHandoffClaimCommand({ expected_version: row.version });
  if (
    Object.keys(row).some(
      (key) =>
        !['identity', 'sessionId', 'handoffId', 'checkpointId', 'version', 'key'].includes(key),
    ) ||
    !isUlid(row.sessionId) ||
    !isUlid(row.handoffId) ||
    !isUlid(row.checkpointId) ||
    row.key !== `claim-${row.handoffId}-v${command.expected_version}`
  )
    throw new TypeError('Invalid original claim request');
  return {
    identity: parseSessionCommandIdentity(row.identity),
    sessionId: row.sessionId,
    handoffId: row.handoffId,
    checkpointId: row.checkpointId,
    version: command.expected_version,
    key: row.key as string,
  };
}
export function sameClaim(left: ClaimRequest, right: ClaimRequest): boolean {
  return JSON.stringify(parseClaimRequest(left)) === JSON.stringify(parseClaimRequest(right));
}
export function recordedClaim(value: unknown, request: ClaimRequest): HandoffClaimRecorded {
  const receipt = parseHandoffClaimReceiptLookup(
    value,
    request.handoffId,
    request.version,
    request.identity,
  );
  if (
    receipt.status !== 'recorded' ||
    receipt.session_id !== request.sessionId ||
    receipt.checkpoint_id !== request.checkpointId
  )
    throw new TypeError('Claim receipt does not match this original checkpoint');
  return receipt;
}
export function parseClaimFeedback(
  value: unknown,
  expected: ClaimRequest,
): Exclude<ClaimFeedback, { status: 'idle' }> {
  const row = object(value);
  const request = parseClaimRequest(row.request);
  if (
    !sameClaim(request, expected) ||
    typeof row.message !== 'string' ||
    row.message.length > 4000 ||
    (row.trace !== undefined && (typeof row.trace !== 'string' || row.trace.length > 1024))
  )
    throw new TypeError('Claim feedback mismatch');
  const base = {
    request,
    message: row.message,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
  if (row.status === 'error' && typeof row.uncertain === 'boolean')
    return { ...base, status: 'error', uncertain: row.uncertain };
  if (row.status === 'done' && row.uncertain !== true)
    return { ...base, status: 'done', receipt: recordedClaim(row.receipt, request) };
  throw new TypeError('Invalid claim feedback');
}
export function encodeClaimRecovery(request: ClaimRequest): string {
  const raw = JSON.stringify({
    schema_version: 1,
    operation: 'handoff.claim',
    request: parseClaimRequest(request),
  });
  if (raw.length > CLAIM_RECOVERY_LIMIT) throw new TypeError('Claim recovery text is too large');
  return raw;
}
export function decodeClaimRecovery(raw: string): ClaimRequest {
  if (!raw || raw.length > CLAIM_RECOVERY_LIMIT)
    throw new TypeError('Claim recovery text is too large');
  const row = object(JSON.parse(raw));
  if (
    row.schema_version !== 1 ||
    row.operation !== 'handoff.claim' ||
    Object.keys(row).some((key) => !['schema_version', 'operation', 'request'].includes(key))
  )
    throw new TypeError('Unsupported claim recovery format');
  return parseClaimRequest(row.request);
}
