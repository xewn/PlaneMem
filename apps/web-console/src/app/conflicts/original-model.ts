import {
  assertConflictReceiptIdentity,
  parseConflictCommandIdentity,
  parseConflictReadQuery,
  type ConflictCommandIdentity,
  type ConflictReceiptQuery,
} from '@planemem/contracts';
import { decodeConflictRequest, encodeConflictRequest } from './receipt/model';

export function conflictOriginalStorageKey(identity: ConflictCommandIdentity, conflictId: string) {
  const scope = parseConflictCommandIdentity(identity);
  const id = parseConflictReadQuery({ conflict_id: conflictId }).conflict_id;
  return (
    'planemem:conflict-original:v1:' +
    JSON.stringify([
      scope.tenant_id,
      scope.workspace_id,
      scope.project_id,
      scope.actor_id,
      scope.client_id,
      id,
    ])
  );
}
export function decodeScopedConflictOriginal(
  raw: unknown,
  identity: ConflictCommandIdentity,
  conflictId?: string,
) {
  const original = decodeConflictRequest(raw);
  assertConflictReceiptIdentity(original.identity, identity);
  if (conflictId !== undefined && original.command.conflict_id !== conflictId)
    throw new TypeError('The saved request belongs to another conflict');
  return original;
}
export const submissionMessages = {
  received:
    'The gateway responded. Keep this original request and explicitly check its receipt to confirm the saved decision.',
  signin:
    'Sign in as the original account and client, then check the receipt. The decision outcome remains unknown.',
  denied:
    'Restore the original account, client and project with conflict resolution access. Keep this original request unchanged.',
  unavailable:
    'The decision outcome remains unknown. Keep the original request and explicitly check its receipt before deciding whether to resend it.',
} as const;
export interface ConflictSubmissionFeedback {
  status: 'unconfirmed';
  request: ConflictReceiptQuery;
  reason: keyof typeof submissionMessages;
  trace?: string;
}
export function parseConflictSubmissionFeedback(
  value: unknown,
  original: ConflictReceiptQuery,
): ConflictSubmissionFeedback {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => !['status', 'request', 'reason', 'trace'].includes(key)) ||
    row.status !== 'unconfirmed' ||
    typeof row.reason !== 'string' ||
    !Object.hasOwn(submissionMessages, row.reason) ||
    encodeConflictRequest(row.request) !== encodeConflictRequest(original) ||
    (row.trace !== undefined &&
      (typeof row.trace !== 'string' ||
        !row.trace.trim() ||
        row.trace.length > 1024 ||
        /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.trace)))
  )
    throw new TypeError();
  return {
    status: 'unconfirmed',
    request: decodeConflictRequest(encodeConflictRequest(original)),
    reason: row.reason as keyof typeof submissionMessages,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
}
