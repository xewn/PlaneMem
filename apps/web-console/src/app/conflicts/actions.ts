'use server';

import {
  AuthRequiredError,
  WorkbenchApiError,
  submitWorkbenchConflictOriginal,
} from '../../lib/server-api';
import { decodeConflictRequest } from './receipt/model';
import type { ConflictSubmissionFeedback } from './original-model';

export async function submitConflictOriginal(form: FormData): Promise<ConflictSubmissionFeedback> {
  if (
    !(form instanceof FormData) ||
    form.getAll('request').length !== 1 ||
    form.getAll('confirmed').length !== 1 ||
    form.get('confirmed') !== 'yes'
  )
    throw new TypeError('Confirm one complete original conflict request');
  form.forEach((_value, key) => {
    if (key !== 'request' && key !== 'confirmed') throw new TypeError('Unexpected decision field');
  });
  const request = decodeConflictRequest(form.get('request'));
  try {
    const response = await submitWorkbenchConflictOriginal(request);
    return { status: 'unconfirmed', request, reason: 'received', trace: response.trace_id };
  } catch (error) {
    const known = error instanceof WorkbenchApiError;
    return {
      status: 'unconfirmed',
      request,
      reason:
        error instanceof AuthRequiredError
          ? 'signin'
          : known && error.status === 403
            ? 'denied'
            : 'unavailable',
      ...(known && typeof error.trace_id === 'string' ? { trace: error.trace_id } : {}),
    };
  }
}
