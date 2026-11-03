'use server';

import { parseSessionCommandReceiptLookup } from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  finishWorkbenchSessionRun,
  finishWorkbenchSessionToolCall,
  endWorkbenchSession,
  getWorkbenchSessionCommandReceipt,
} from '../../../lib/server-api';
import {
  parseFinishRequest,
  finishReceiptQuery,
  type FinishRequest,
  type FinishFeedback,
} from './finish-model';

export async function submitActivityFinish(
  raw: FinishRequest,
  intent: 'finish' | 'receipt',
  confirmed: boolean,
  previouslyUncertain: boolean,
): Promise<FinishFeedback> {
  const request = parseFinishRequest(raw);
  if (intent !== 'finish' && intent !== 'receipt') throw new TypeError('Invalid result intent');
  const uncertain = previouslyUncertain === true;
  if (intent === 'finish' && confirmed !== true)
    return {
      status: 'error',
      request,
      uncertain,
      message: 'Confirm the original selected result before submitting.',
    };
  const query = finishReceiptQuery(request);
  try {
    let value: unknown;
    let trace: string;
    if (intent === 'receipt') {
      const result = await getWorkbenchSessionCommandReceipt(
        request.sessionId,
        query,
        request.identity,
      );
      value = result.data;
      trace = result.trace_id;
    } else if (request.operation === 'run.finish') {
      const result = await finishWorkbenchSessionRun(
        request.sessionId,
        request.resourceId,
        request.version,
        request.resourceVersion,
        request.outcome,
        request.key,
        request.identity,
      );
      const run = result.data;
      if (!run || run.schema_version !== 1 || run.session_id !== request.sessionId)
        throw new TypeError();
      value = {
        status: 'recorded',
        operation: 'run.finish',
        session_id: run.session_id,
        session_version: run.session_version,
        run_id: run.run_id,
        run_version: run.version,
        run_status: run.status,
        changed: run.version === request.resourceVersion + 1,
      };
      trace = result.trace_id;
    } else if (request.operation === 'tool.finish') {
      const result = await finishWorkbenchSessionToolCall(
        request.sessionId,
        request.resourceId,
        request.version,
        request.resourceVersion,
        request.outcome,
        request.key,
        request.identity,
      );
      const tool = result.data;
      if (!tool || tool.schema_version !== 1 || tool.session_id !== request.sessionId)
        throw new TypeError();
      value = {
        status: 'recorded',
        operation: 'tool.finish',
        session_id: tool.session_id,
        session_version: tool.session_version,
        tool_call_id: tool.tool_call_id,
        run_id: tool.run_id,
        tool_version: tool.version,
        tool_status: tool.status,
        changed: tool.version === request.resourceVersion + 1,
      };
      trace = result.trace_id;
    } else {
      const result = await endWorkbenchSession(
        request.sessionId,
        request.version,
        request.outcome,
        request.key,
        request.identity,
      );
      const session = result.data;
      if (
        !session ||
        session.schema_version !== 1 ||
        session.session_id !== request.sessionId ||
        typeof session.ended_at !== 'string' ||
        !Number.isFinite(Date.parse(session.ended_at))
      )
        throw new TypeError();
      value = {
        status: 'recorded',
        operation: 'end',
        session_id: session.session_id,
        session_version: session.version,
        ended_status: session.status,
      };
      trace = result.trace_id;
    }
    const receipt = parseSessionCommandReceiptLookup(value, request.sessionId, query);
    if (receipt.status !== 'recorded')
      return {
        status: 'error',
        request,
        uncertain,
        trace,
        message:
          'No matching result is visible yet. This does not prove failure. Keep the original request.',
      };
    if (
      receipt.operation !== 'run.finish' &&
      receipt.operation !== 'tool.finish' &&
      receipt.operation !== 'end'
    )
      throw new TypeError();
    if (receipt.operation === 'end')
      return {
        status: 'done',
        request,
        receipt,
        trace,
        message: `Confirmed the original closure as ${receipt.ended_status} at session version ${receipt.session_version}. This receipt is historical. Refresh the current state to see later changes.`,
      };
    const resourceVersion =
      receipt.operation === 'run.finish' ? receipt.run_version : receipt.tool_version;
    return {
      status: 'done',
      request,
      receipt,
      trace,
      message: `Confirmed the original ${request.outcome} request at record version ${resourceVersion} and session version ${receipt.session_version}.${receipt.changed ? '' : ' The matching terminal result was already recorded; versions did not change.'} This receipt is historical. Refresh the current record to see later changes.`,
    };
  } catch (error) {
    const known = error instanceof WorkbenchApiError;
    return {
      status: 'error',
      request,
      uncertain:
        uncertain ||
        (intent === 'finish' &&
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
