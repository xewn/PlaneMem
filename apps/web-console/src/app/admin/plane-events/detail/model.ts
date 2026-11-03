import {
  parsePlaneInboxIdentity,
  parsePlaneInboxRetryQuery,
  parsePlaneInboxRetryInput,
  parsePlaneInboxRetryReceipt,
  type PlaneInboxIdentity,
  type PlaneInboxRetryInput,
  type PlaneInboxRetryReceipt,
} from '@planemem/contracts';

export interface RetryRequest {
  key: string;
  input: PlaneInboxRetryInput;
  identity: PlaneInboxIdentity;
}
export type RetryFeedback =
  | { status: 'idle' }
  | {
      status: 'done';
      request: RetryRequest;
      receipt: PlaneInboxRetryReceipt;
      message: string;
      trace?: string;
    }
  | { status: 'error'; request: RetryRequest; uncertain: boolean; message: string; trace?: string };

export function parseRetryRequest(value: unknown): RetryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid retry request');
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((field) => !['key', 'input', 'identity'].includes(field)) ||
    !row.input ||
    typeof row.input !== 'object' ||
    Array.isArray(row.input)
  )
    throw new TypeError('Invalid retry request');
  const { request_key, ...input } = parsePlaneInboxRetryQuery({
    ...parsePlaneInboxRetryInput(row.input),
    request_key: row.key,
  });
  return { key: request_key, input, identity: parsePlaneInboxIdentity(row.identity) };
}
export function sameRetryRequest(left: RetryRequest, right: RetryRequest) {
  return JSON.stringify(parseRetryRequest(left)) === JSON.stringify(parseRetryRequest(right));
}
export function parseRetryFeedback(
  value: unknown,
  expected: RetryRequest,
): Exclude<RetryFeedback, { status: 'idle' }> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid retry response');
  const row = value as Record<string, unknown>;
  const request = parseRetryRequest(row.request);
  if (
    !sameRetryRequest(request, expected) ||
    typeof row.message !== 'string' ||
    (row.trace !== undefined && typeof row.trace !== 'string')
  )
    throw new TypeError('Retry response mismatch');
  const base = {
    request,
    message: row.message,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
  if (row.status === 'done')
    return {
      ...base,
      status: 'done',
      receipt: parsePlaneInboxRetryReceipt(
        row.receipt,
        request.input,
        request.identity,
        request.key,
      ),
    };
  if (row.status === 'error' && typeof row.uncertain === 'boolean')
    return { ...base, status: 'error', uncertain: row.uncertain };
  throw new TypeError('Invalid retry result');
}
