'use server';

import {
  isUlid,
  type SessionToolCallDetail,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchSessionToolCall,
} from '../../../../lib/server-api';
export type RefreshToolFeedback =
  | { status: 'done'; detail: SessionToolCallDetail; canWrite: boolean }
  | { status: 'error'; message: string; trace?: string };

/** Refresh data in place, without navigating away from a pending command's recovery state. */
export async function refreshTool(
  sessionId: string,
  toolCallId: string,
  identity?: SessionCommandIdentity,
): Promise<RefreshToolFeedback> {
  if (!isUlid(sessionId) || !isUlid(toolCallId))
    return { status: 'error', message: 'Select a valid session and tool call.' };
  try {
    const result = await getWorkbenchSessionToolCall(sessionId, toolCallId, identity);
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
          ? 'Sign in again before refreshing the tool. The original request is retained here.'
          : error instanceof WorkbenchApiError
            ? error.message
            : 'The current tool could not be read. The original request is retained here.',
      ...(error instanceof WorkbenchApiError ? { trace: error.trace_id } : {}),
    };
  }
}
