'use server';

import { isUlid, type SessionRunDetail, type SessionCommandIdentity } from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchSessionRun,
} from '../../../../lib/server-api';
export type RefreshRunFeedback =
  | { status: 'done'; detail: SessionRunDetail; canWrite: boolean }
  | { status: 'error'; message: string; trace?: string };

/** Refresh data in place, without navigating away from a pending command's recovery state. */
export async function refreshRun(
  sessionId: string,
  runId: string,
  identity?: SessionCommandIdentity,
): Promise<RefreshRunFeedback> {
  if (!isUlid(sessionId) || !isUlid(runId))
    return { status: 'error', message: 'Select a valid session and run.' };
  try {
    const result = await getWorkbenchSessionRun(sessionId, runId, identity);
    return {
      status: 'done',
      detail: result.data,
      canWrite: result.session_permissions?.write_sessions === true,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof AuthRequiredError
          ? 'Sign in again before refreshing the run. The original request is retained here.'
          : error instanceof WorkbenchApiError
            ? error.message
            : 'The current run could not be read. The original request is retained here.',
      ...(error instanceof WorkbenchApiError ? { trace: error.trace_id } : {}),
    };
  }
}
