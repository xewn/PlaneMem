import {
  parseConflictReceiptQuery,
  parseConflictReceiptEnvelope,
  conflictReceiptJson,
  CONFLICT_RECEIPT_REQUEST_BYTES,
  type ConflictReceiptQuery,
  type ConflictReceiptEnvelope,
} from '@planemem/contracts';
export { CONFLICT_RECEIPT_REQUEST_BYTES };
export const receiptMessages = {
  signin: 'Sign in as the original account and client, then check again. Keep the saved request.',
  denied:
    'Use the original account, client and project with conflict resolution access. The saved request remains unchanged.',
  mismatch:
    'This key is bound to different parameters. Recover the exact original request; do not generate a new key.',
  legacy: 'The legacy decision has no complete original binding. This request remains unconfirmed.',
  invalid:
    'The receipt could not be validated against the original request. Keep it for another explicit check.',
  unavailable:
    'The original outcome remains unconfirmed. Keep the saved request and check again later; this error does not prove the decision failed.',
} as const;
export type ConflictReceiptFeedback =
  | { status: 'checked'; response: ConflictReceiptEnvelope }
  | {
      status: 'error';
      request: ConflictReceiptQuery;
      reason: keyof typeof receiptMessages;
      trace?: string;
    };
export function decodeConflictRequest(raw: unknown) {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > CONFLICT_RECEIPT_REQUEST_BYTES ||
    new TextEncoder().encode(raw).byteLength > CONFLICT_RECEIPT_REQUEST_BYTES
  )
    throw new TypeError('Use saved request JSON no larger than 1 MB');
  return parseConflictReceiptQuery(JSON.parse(raw.replace(/^\uFEFF/, '')));
}
export function encodeConflictRequest(value: unknown) {
  return conflictReceiptJson(parseConflictReceiptQuery(value));
}
export function parseConflictReceiptFeedback(
  value: unknown,
  original: ConflictReceiptQuery,
): ConflictReceiptFeedback {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid receipt feedback');
  const row = value as Record<string, unknown>;
  if (row.status === 'checked') {
    if (
      Object.keys(row).some((key) => !['status', 'response'].includes(key)) ||
      !row.response ||
      typeof row.response !== 'object'
    )
      throw new TypeError();
    const response = row.response as Record<string, unknown>;
    if (typeof response.trace_id !== 'string') throw new TypeError();
    return {
      status: 'checked',
      response: parseConflictReceiptEnvelope(response, original, response.trace_id),
    };
  }
  if (
    Object.keys(row).some((key) => !['status', 'request', 'reason', 'trace'].includes(key)) ||
    row.status !== 'error' ||
    typeof row.reason !== 'string' ||
    !Object.hasOwn(receiptMessages, row.reason) ||
    encodeConflictRequest(row.request) !== encodeConflictRequest(original) ||
    (row.trace !== undefined &&
      (typeof row.trace !== 'string' ||
        !row.trace.trim() ||
        row.trace.length > 1024 ||
        /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.trace)))
  )
    throw new TypeError('Receipt feedback differs from original request');
  return {
    status: 'error',
    request: parseConflictReceiptQuery(row.request),
    reason: row.reason as keyof typeof receiptMessages,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
}
