'use server';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchConflictReceipt,
} from '../../../lib/server-api';
import { decodeConflictRequest, type ConflictReceiptFeedback } from './model';
export async function checkConflictReceipt(form: FormData): Promise<ConflictReceiptFeedback> {
  if (!(form instanceof FormData) || form.getAll('request').length !== 1)
    throw new TypeError('Supply one saved request');
  form.forEach((_value, key) => {
    if (key !== 'request') throw new TypeError('Unexpected receipt query field');
  });
  const request = decodeConflictRequest(form.get('request'));
  try {
    return { status: 'checked', response: await getWorkbenchConflictReceipt(request) };
  } catch (error) {
    const known = error instanceof WorkbenchApiError;
    const reason =
      error instanceof AuthRequiredError
        ? 'signin'
        : known && error.status === 403
          ? 'denied'
          : known && error.code === 'IDEMPOTENCY_KEY_REUSED'
            ? 'mismatch'
            : known && error.code === 'CONFLICT_RECEIPT_LEGACY_UNVERIFIED'
              ? 'legacy'
              : known &&
                  [
                    'CONFLICT_RECEIPT_INVALID',
                    'GATEWAY_RESPONSE_INVALID',
                    'INVALID_INPUT',
                  ].includes(error.code ?? '')
                ? 'invalid'
                : 'unavailable';
    return {
      status: 'error',
      request,
      reason,
      ...(known && typeof error.trace_id === 'string' ? { trace: error.trace_id } : {}),
    };
  }
}
