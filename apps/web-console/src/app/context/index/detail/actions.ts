'use server';

import {
  parseLegacyContextIdentity,
  parseLegacyContextStatusQuery,
  type LegacyContextIdentity,
} from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchLegacyIndex,
  mutateWorkbenchLegacyIndex,
} from '../../../../lib/server-api';
import {
  parseIndexRequest,
  sameIndexRequest,
  type IndexRequest,
  type IndexFeedback,
} from './model';

export async function changeIndex(
  previous: IndexFeedback,
  raw: IndexRequest,
  confirmed: boolean,
): Promise<IndexFeedback> {
  const uncertain = previous.status === 'error' && previous.uncertain;
  let request: IndexRequest;
  try {
    request = parseIndexRequest(raw);
    if (uncertain && (!previous.request || !sameIndexRequest(previous.request, request)))
      return {
        ...previous,
        message: 'Keep the original request, identity and key until its result is confirmed.',
      };
  } catch {
    return uncertain
      ? { ...previous, message: 'Keep the original request until its result is confirmed.' }
      : {
          status: 'error',
          uncertain: false,
          message: 'Provide a valid index, revision, reason and request key.',
        };
  }
  if (confirmed !== true)
    return {
      status: 'error',
      request,
      uncertain,
      message: 'Confirm this change before submitting.',
    };
  try {
    const result = await mutateWorkbenchLegacyIndex(
      request.operation,
      request.input,
      request.key,
      request.identity,
    );
    return {
      status: 'done',
      request,
      receipt: result.data,
      trace: result.trace_id,
      message: `The original ${request.operation} request is confirmed at revision ${result.data.record.revision}. This is a historical receipt. Refresh to read the current state.`,
    };
  } catch (error) {
    const known = error instanceof WorkbenchApiError;
    return {
      status: 'error',
      request,
      uncertain:
        uncertain ||
        (known
          ? error.status === undefined ||
            error.status === 408 ||
            error.status >= 500 ||
            error.code === 'IDEMPOTENCY_KEY_REUSED'
          : !(error instanceof AuthRequiredError)),
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account, then retry this request.'
          : known
            ? error.message
            : 'The index change could not be confirmed. Keep the original request and retry.',
      ...(known ? { trace: error.trace_id } : {}),
    };
  }
}

export async function refreshIndex(id: string, identity: LegacyContextIdentity) {
  try {
    parseLegacyContextStatusQuery({ id });
    const result = await getWorkbenchLegacyIndex(id, parseLegacyContextIdentity(identity));
    return {
      status: 'done' as const,
      detail: result.data,
      identity: result.index_identity,
      canWrite: result.index_permissions.write,
    };
  } catch (error) {
    return {
      status: 'error' as const,
      message:
        error instanceof AuthRequiredError
          ? 'Sign in as the original account before refreshing. Your request stays here.'
          : error instanceof WorkbenchApiError
            ? error.message
            : 'The current index could not be read. Your request stays here.',
      ...(error instanceof WorkbenchApiError ? { trace: error.trace_id } : {}),
    };
  }
}
