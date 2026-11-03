'use server';

import {
  isUlid,
  parseSessionCommandIdentity,
  parseSessionCommandReceiptLookup,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  createWorkbenchSessionActivity,
  getWorkbenchSessionCommandReceipt,
  getWorkbenchSessionState,
  getWorkbenchSessionRun,
} from '../../../../lib/server-api';
import {
  activityCreateQuery,
  parseActivityCreateRequest,
  recordedActivityCreate,
  type ActivityCreateRequest,
  type ActivityCreateFeedback,
  type ActivityCreateState,
} from '../../../../lib/activity-create';

export async function submitActivityCreate(
  raw: ActivityCreateRequest,
  intent: 'create' | 'receipt',
  confirmed: boolean,
  previouslyUncertain: boolean,
): Promise<ActivityCreateFeedback> {
  const request = parseActivityCreateRequest(raw);
  if (intent !== 'create' && intent !== 'receipt') throw new TypeError('Invalid activity intent.');
  const uncertain = previouslyUncertain === true;
  if (intent === 'create' && confirmed !== true)
    return {
      status: 'error',
      request,
      uncertain,
      message: 'Confirm the original activity request before submitting.',
    };
  try {
    const query = activityCreateQuery(request);
    const result =
      intent === 'create'
        ? await createWorkbenchSessionActivity(request)
        : await getWorkbenchSessionCommandReceipt(request.sessionId, query, request.identity);
    const receipt = parseSessionCommandReceiptLookup(result.data, request.sessionId, query);
    if (receipt.status !== 'recorded')
      return {
        status: 'error',
        request,
        uncertain,
        trace: result.trace_id,
        message:
          'No matching receipt is visible yet. This does not prove failure. Keep the original request.',
      };
    return {
      status: 'done',
      request,
      receipt: recordedActivityCreate(receipt, request),
      trace: result.trace_id,
      message: `The original activity request is confirmed at session version ${receipt.session_version}. This is a historical receipt. Read the current state before preparing another request.`,
    };
  } catch (error) {
    const known = error instanceof WorkbenchApiError;
    return {
      status: 'error',
      request,
      uncertain:
        uncertain ||
        (intent === 'create' &&
          (known
            ? error.status === undefined ||
              error.status === 408 ||
              error.status >= 500 ||
              error.code === 'IDEMPOTENCY_KEY_REUSED' ||
              error.code === 'SESSION_RECEIPT_INVALID'
            : !(error instanceof AuthRequiredError))),
      ...(known ? { trace: error.trace_id } : {}),
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account, then check the original receipt.'
          : known
            ? error.message
            : 'The result could not be confirmed. Keep the original request and check its receipt.',
    };
  }
}

export async function refreshActivityCreate(
  sessionId: string,
  runId: string | undefined,
  identity: SessionCommandIdentity,
): Promise<
  | { status: 'done'; current: ActivityCreateState; canWrite: boolean }
  | { status: 'error'; message: string }
> {
  if (!isUlid(sessionId) || (runId !== undefined && !isUlid(runId)))
    return { status: 'error', message: 'Select a valid session and run.' };
  try {
    const expected = parseSessionCommandIdentity(identity);
    if (runId !== undefined) {
      const result = await getWorkbenchSessionRun(sessionId, runId, expected);
      return {
        status: 'done',
        current: result.data,
        canWrite: result.session_permissions?.write_sessions === true,
      };
    }
    const result = await getWorkbenchSessionState(sessionId, expected);
    return {
      status: 'done',
      current: { session: result.data },
      canWrite: result.session_permissions?.write_sessions === true,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account before reading the current state. The original request is retained.'
          : error instanceof WorkbenchApiError
            ? error.message
            : 'The current state could not be read. The original request is retained.',
    };
  }
}
