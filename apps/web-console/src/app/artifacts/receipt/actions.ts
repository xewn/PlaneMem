'use server';

import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchArtifactReceipt,
} from '../../../lib/server-api';
import { decodeArtifactRequest, type ArtifactReceiptFeedback } from './model';

export async function checkArtifactReceipt(form: FormData): Promise<ArtifactReceiptFeedback> {
  if (!(form instanceof FormData) || form.getAll('request').length !== 1)
    throw new TypeError('Supply one saved request.');
  form.forEach((_value, name) => {
    if (name !== 'request') throw new TypeError('Unexpected receipt query field.');
  });
  const request = decodeArtifactRequest(form.get('request'));
  try {
    return { status: 'checked', response: await getWorkbenchArtifactReceipt(request) };
  } catch (error) {
    const known = error instanceof WorkbenchApiError;
    const reason =
      error instanceof AuthRequiredError
        ? 'signin'
        : known && error.status === 403
          ? 'denied'
          : known && error.code === 'IDEMPOTENCY_KEY_REUSED'
            ? 'mismatch'
            : known && error.code === 'ARTIFACT_LEGACY_UNVERIFIED'
              ? 'legacy'
              : known &&
                  ['GATEWAY_RESPONSE_INVALID', 'ARTIFACT_STORED_INVALID'].includes(error.code ?? '')
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
