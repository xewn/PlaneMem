'use server';

import { isUlid, type SessionClosureState, type SessionCommandIdentity } from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchSessionState,
} from '../../lib/server-api';

export type RefreshSessionEndFeedback =
  | { status: 'done'; state: SessionClosureState; canWrite: boolean }
  | { status: 'error'; message: string; trace?: string };

/** Re-read the selected session without replacing its original close request. */
export async function refreshSessionEnd(
  sessionId: string,
  identity?: SessionCommandIdentity,
): Promise<RefreshSessionEndFeedback> {
  if (!isUlid(sessionId)) return { status: 'error', message: 'Select a valid session.' };
  try {
    const result = await getWorkbenchSessionState(sessionId, identity);
    return {
      status: 'done',
      state: result.data,
      canWrite: result.session_permissions?.write_sessions === true,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account before refreshing. The close request is retained.'
          : error instanceof WorkbenchApiError
            ? error.message
            : 'Current session state could not be read. The close request is retained.',
      ...(error instanceof WorkbenchApiError ? { trace: error.trace_id } : {}),
    };
  }
}
