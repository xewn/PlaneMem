'use server';

import {
  parseHandoffReadQuery,
  parseHandoffReadEnvelope,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import { AuthRequiredError, WorkbenchApiError, getWorkbenchHandoff } from '../../lib/server-api';
import type { HandoffRefreshFeedback } from './detail-model';

/** Read only; the caller retains original command drafts and their receipt status. */
export async function refreshHandoffDetail(
  handoffId: string,
  identity?: SessionCommandIdentity,
): Promise<HandoffRefreshFeedback> {
  try {
    parseHandoffReadQuery({ handoff_id: handoffId });
    const result = await getWorkbenchHandoff(handoffId, identity);
    return {
      status: 'done',
      snapshot: parseHandoffReadEnvelope(result, handoffId, result.data, result.trace_id, identity),
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account before refreshing. Original requests remain in this page.'
          : error instanceof WorkbenchApiError
            ? error.message
            : 'Current handoff details could not be read. Original requests remain in this page.',
      ...(error instanceof WorkbenchApiError ? { trace: error.trace_id } : {}),
    };
  }
}
