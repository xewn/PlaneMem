import { createHash } from 'node:crypto';
import type { SqliteSyncInbox } from '@planemem/context-bridge';
import { assertSyncCommandIdentity, ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { prepareArtifactOutput, type ArtifactOutput } from './artifact-output.js';
import { applicationArchiveFailure as fail } from './inbox-application-archive-file.js';
import { saveInboxApplicationRestoreRequest } from './inbox-application-restore-request.js';
import { saveInboxApplicationRestoreReceiptFile } from './inbox-application-restore-receipt-file.js';

/** Look up a historical record first; any original-query file is written after closing the reader. */
export async function runInboxApplicationRestoreReceiptGet(
  inboxPath: string,
  input: unknown,
  trace: string,
  outputPath?: string,
  receiptOutputPath?: string,
) {
  if (outputPath !== undefined && receiptOutputPath !== undefined)
    throw fail(
      'USAGE_ERROR',
      'Choose either --output for the original query or --receipt-output for the complete receipt',
      trace,
    );
  let bridge: typeof import('@planemem/context-bridge');
  try {
    bridge = await import('@planemem/context-bridge');
  } catch {
    throw fail('INBOX_STORAGE_UNAVAILABLE', 'The local inbox adapter is unavailable', trace, {
      inbox: inboxPath,
      receipt_lookup_completed: false,
      local_write_state: 'not-performed',
    });
  }
  const selection = bridge.parseInboxApplicationRestoreReceiptSelection(input, trace);
  const context = { selection, inbox: inboxPath, local_write_state: 'not-performed' as const };
  let output: ArtifactOutput | undefined;
  const selectedOutputPath = receiptOutputPath ?? outputPath;
  if (selectedOutputPath !== undefined) {
    try {
      output = await prepareArtifactOutput(selectedOutputPath, trace);
    } catch {
      throw fail(
        receiptOutputPath === undefined
          ? 'INBOX_APPLICATION_RESTORE_REQUEST_OUTPUT_UNAVAILABLE'
          : 'INBOX_APPLICATION_RESTORE_RECEIPT_OUTPUT_UNAVAILABLE',
        'Choose a new output file in an existing directory',
        trace,
        {
          ...context,
          output_path: selectedOutputPath,
          receipt_lookup_completed: false,
        },
      );
    }
  }
  let inbox: SqliteSyncInbox;
  try {
    inbox = new bridge.SqliteSyncInbox(inboxPath, {
      create: false,
      readonly: true,
      trace_id: trace,
    });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'INBOX_STORAGE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The existing inbox could not be opened for reading',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        ...context,
        receipt_lookup_completed: false,
      },
    );
  }
  let result: ReturnType<SqliteSyncInbox['getApplicationRestoreReceipt']>;
  try {
    result = inbox.getApplicationRestoreReceipt(selection, trace);
  } catch (error) {
    let close_pending = false;
    try {
      inbox.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'INBOX_APPLICATION_RESTORE_RECEIPT_GET_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The historical receipt could not be read',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        ...context,
        receipt_lookup_completed: false,
        close_pending,
      },
    );
  }
  let close_pending = false;
  try {
    inbox.close();
  } catch {
    close_pending = true;
  }
  const response = {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: result.scope,
    data: { ...result, inbox: inboxPath },
    close_pending,
  };
  const completedContext = {
    ...context,
    receipt_lookup_completed: true,
    close_pending,
    receipt: result.receipt,
    restore_query: result.restore_query,
    receipt_scope: 'historical-local-transaction',
  };
  try {
    syncJsonSnapshot(response, 256 * 1024);
  } catch {
    throw fail(
      'INBOX_APPLICATION_RESTORE_RECEIPT_GET_TOO_LARGE',
      'The complete historical receipt response exceeds 256 KiB',
      trace,
      {
        ...completedContext,
        response_completed: false,
      },
    );
  }
  if (output === undefined) return response;
  if (receiptOutputPath !== undefined) {
    let receiptFile:
      | Awaited<ReturnType<typeof saveInboxApplicationRestoreReceiptFile>>
      | { state: 'not-created'; path: string; reason: 'receipt-not-observed' };
    try {
      receiptFile =
        result.receipt === null
          ? { state: 'not-created', path: output.path, reason: 'receipt-not-observed' }
          : await saveInboxApplicationRestoreReceiptFile(result.receipt, output, trace);
    } catch (error) {
      throw fail(
        error instanceof ContractError
          ? error.envelope.code
          : 'INBOX_APPLICATION_RESTORE_RECEIPT_SAVE_FAILED',
        error instanceof ContractError
          ? error.envelope.message
          : 'The historical receipt could not be saved',
        trace,
        {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          ...completedContext,
          output_path: output.path,
        },
      );
    }
    const completed = { ...response, data: { ...response.data, receipt_file: receiptFile } };
    try {
      syncJsonSnapshot(completed, 256 * 1024);
    } catch {
      throw fail(
        'INBOX_APPLICATION_RESTORE_RECEIPT_GET_TOO_LARGE',
        'The complete receipt response exceeds 256 KiB; retain the reported receipt file state',
        trace,
        {
          ...completedContext,
          receipt_file: receiptFile,
          response_completed: false,
        },
      );
    }
    return completed;
  }
  let requestFile:
    | Awaited<ReturnType<typeof saveInboxApplicationRestoreRequest>>
    | { state: 'not-created'; path: string; reason: 'receipt-not-observed' };
  if (result.receipt === null) {
    requestFile = { state: 'not-created', path: output.path, reason: 'receipt-not-observed' };
  } else {
    try {
      const original = bridge.parseInboxApplicationRestoreReceiptQuery(result.restore_query, trace);
      assertSyncCommandIdentity(original.expected_identity, selection.expected_identity);
      const json = syncJsonSnapshot(original, 16384);
      if (
        original.restore_request_id !== selection.restore_request_id ||
        JSON.stringify(original.application) !== JSON.stringify(selection.application) ||
        json !== syncJsonSnapshot(result.receipt.query, 16384) ||
        createHash('sha256').update(json).digest('hex') !== result.receipt.request_sha256
      )
        throw new TypeError();
      // Keep the recorded timeout and guard exactly; selection.timeout_ms belongs only to this read.
      requestFile = await saveInboxApplicationRestoreRequest(original, output, trace);
    } catch (error) {
      throw fail(
        error instanceof ContractError
          ? error.envelope.code
          : 'INBOX_APPLICATION_RESTORE_REQUEST_INVALID',
        error instanceof ContractError
          ? error.envelope.message
          : 'The selected receipt did not provide its complete original query',
        trace,
        {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          ...completedContext,
          output_path: output.path,
        },
      );
    }
  }
  const completed = { ...response, data: { ...response.data, request_file: requestFile } };
  try {
    syncJsonSnapshot(completed, 256 * 1024);
  } catch {
    throw fail(
      'INBOX_APPLICATION_RESTORE_RECEIPT_GET_TOO_LARGE',
      'The complete receipt response exceeds 256 KiB; retain the reported request file state',
      trace,
      {
        ...completedContext,
        request_file: requestFile,
        response_completed: false,
      },
    );
  }
  return completed;
}
