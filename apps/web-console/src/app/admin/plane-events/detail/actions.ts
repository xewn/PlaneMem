'use server';

import { parsePlaneInboxIdentity, type PlaneInboxIdentity } from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchPlaneEvent,
  retryWorkbenchPlaneEvent,
  getWorkbenchPlaneRetryReceipt,
} from '../../../../lib/server-api';
import { parseRetryRequest, type RetryRequest, type RetryFeedback } from './model';

export async function submitPlaneRetry(
  raw: RetryRequest,
  intent: 'retry' | 'receipt',
  confirmed: boolean,
  previouslyUncertain: boolean,
): Promise<RetryFeedback> {
  const request = parseRetryRequest(raw);
  const uncertain = previouslyUncertain === true;
  if (intent !== 'retry' && intent !== 'receipt') throw new TypeError('Invalid retry intent');
  if (intent === 'retry' && confirmed !== true)
    return {
      status: 'error',
      request,
      uncertain,
      message: 'Confirm that this original event should be scheduled again.',
    };
  try {
    if (intent === 'receipt') {
      const result = await getWorkbenchPlaneRetryReceipt(
        request.input,
        request.key,
        request.identity,
      );
      if (result.data.status === 'not-observed')
        return {
          status: 'error',
          request,
          uncertain,
          trace: result.trace_id,
          message:
            'No matching retry receipt is visible yet. This does not prove failure. Keep the original request.',
        };
      return {
        status: 'done',
        request,
        receipt: result.data.receipt,
        trace: result.trace_id,
        message:
          'The original scheduling request is confirmed. Read the current event status to see subsequent processing.',
      };
    }
    const result = await retryWorkbenchPlaneEvent(request.input, request.key, request.identity);
    return {
      status: 'done',
      request,
      receipt: result.data,
      trace: result.trace_id,
      message:
        'Retry scheduling is recorded. This does not confirm that the event has been applied.',
    };
  } catch (error) {
    const known = error instanceof WorkbenchApiError;
    return {
      status: 'error',
      request,
      uncertain:
        uncertain ||
        (intent === 'retry' &&
          (known
            ? error.status === undefined ||
              error.status === 408 ||
              error.status >= 500 ||
              error.code === 'IDEMPOTENCY_KEY_REUSED'
            : !(error instanceof AuthRequiredError))),
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account, then check the original receipt.'
          : known
            ? error.message
            : 'The retry result could not be confirmed. Keep the original request.',
      ...(known ? { trace: error.trace_id } : {}),
    };
  }
}

export async function refreshPlaneRetryEvent(eventId: string, identity: PlaneInboxIdentity) {
  try {
    const result = await getWorkbenchPlaneEvent(eventId, parsePlaneInboxIdentity(identity));
    return {
      status: 'done' as const,
      detail: result.data,
      identity: result.plane_inbox_identity,
      canRetry: result.plane_inbox_permissions.retry,
    };
  } catch (error) {
    return {
      status: 'error' as const,
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account before refreshing. Your retry request is retained.'
          : error instanceof WorkbenchApiError
            ? error.message
            : 'Current event status could not be read. Your retry request is retained.',
      ...(error instanceof WorkbenchApiError ? { trace: error.trace_id } : {}),
    };
  }
}
