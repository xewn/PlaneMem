import { resolve } from 'node:path';
import type { SqliteSyncInbox } from '@planemem/context-bridge';
import { assertSyncCommandIdentity, ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { prepareArtifactOutput, type ArtifactOutput } from './artifact-output.js';
import { saveInboxApplicationRestoreRequest } from './inbox-application-restore-request.js';
import {
  applicationArchiveFailure as fail,
  readApplicationArchiveFile,
} from './inbox-application-archive-file.js';

/** Original query/file binding must succeed before opening the existing inbox in the chosen mode. */
export async function runInboxApplicationRestore(
  inboxPath: string,
  archivePath: string,
  input: unknown,
  trace: string,
  mode: 'restore' | 'preview' = 'restore',
  outputPath?: string,
) {
  if (mode !== 'restore' && mode !== 'preview')
    throw fail('USAGE_ERROR', 'Select an explicit restore or preview operation', trace);
  const preview = mode === 'preview';
  if (outputPath !== undefined && !preview)
    throw fail('USAGE_ERROR', 'Only restore preview can save a new restore query file', trace);
  const incomplete = preview
    ? { preview_completed: false, local_write_state: 'not-performed' }
    : { restore_completed: false };
  let bridge: typeof import('@planemem/context-bridge');
  try {
    bridge = await import('@planemem/context-bridge');
  } catch {
    throw fail(
      'INBOX_STORAGE_UNAVAILABLE',
      'The local inbox archive adapter is unavailable',
      trace,
      incomplete,
    );
  }
  const query = bridge.parseInboxApplicationRestoreQuery(input, trace);
  const selection = {
    expected_identity: query.expected_identity,
    application: query.application,
    archive_document_sha256: query.archive_document_sha256,
    timeout_ms: query.timeout_ms,
    ...(query.restore_request_id === undefined
      ? {}
      : { restore_request_id: query.restore_request_id }),
    ...(query.expected_target === undefined ? {} : { expected_target: query.expected_target }),
  };
  let output: ArtifactOutput | undefined;
  if (outputPath !== undefined) {
    try {
      output = await prepareArtifactOutput(outputPath, trace);
    } catch {
      throw fail(
        'INBOX_APPLICATION_RESTORE_REQUEST_OUTPUT_UNAVAILABLE',
        'Choose a new restore query file in an existing directory; existing files and links are never replaced',
        trace,
        {
          ...selection,
          ...incomplete,
          output_path: outputPath,
          source_archive_path: resolve(archivePath),
          inbox: inboxPath,
        },
      );
    }
  }
  let local: Awaited<ReturnType<typeof readApplicationArchiveFile>>;
  try {
    local = await readApplicationArchiveFile(archivePath, trace);
  } catch (error) {
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'INBOX_APPLICATION_ARCHIVE_FILE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The original archive could not be read',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        ...selection,
        ...incomplete,
        source_archive_path: resolve(archivePath),
        inbox: inboxPath,
      },
    );
  }
  try {
    assertSyncCommandIdentity(local.saved.document.expected_identity, query.expected_identity);
    if (
      local.saved.document_sha256 !== query.archive_document_sha256 ||
      JSON.stringify(local.saved.document.application) !== JSON.stringify(query.application)
    )
      throw new TypeError();
  } catch {
    throw fail(
      'INBOX_APPLICATION_RESTORE_INPUT_MISMATCH',
      'The archive differs from the original identity, application or digest selected for restore',
      trace,
      {
        ...incomplete,
        ...selection,
        observed_archive_document_sha256: local.saved.document_sha256,
        source_archive_path: resolve(archivePath),
        source_file_bytes: local.file_bytes,
        source_file_sha256: local.file_sha256,
        inbox: inboxPath,
      },
    );
  }
  const source = {
    source_archive_path: resolve(archivePath),
    source_file_bytes: local.file_bytes,
    source_file_sha256: local.file_sha256,
    archive_document_sha256: local.saved.document_sha256,
  };
  let inbox: SqliteSyncInbox;
  try {
    inbox = new bridge.SqliteSyncInbox(inboxPath, {
      create: false,
      readonly: preview,
      trace_id: trace,
    });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'INBOX_STORAGE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The existing inbox could not be opened for the selected archive operation',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        ...source,
        ...selection,
        inbox: inboxPath,
        ...incomplete,
      },
    );
  }
  let result:
    | ReturnType<SqliteSyncInbox['restoreApplicationArchive']>
    | ReturnType<SqliteSyncInbox['previewApplicationArchiveRestore']>;
  try {
    result = preview
      ? inbox.previewApplicationArchiveRestore(local.saved, query, trace)
      : inbox.restoreApplicationArchive(local.saved, query, trace);
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
        : preview
          ? 'INBOX_APPLICATION_RESTORE_PREVIEW_FAILED'
          : 'INBOX_APPLICATION_RESTORE_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The application archive operation could not be completed',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        ...source,
        ...selection,
        inbox: inboxPath,
        close_pending,
        ...incomplete,
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
    data: { ...result, ...source, inbox: inboxPath },
    close_pending,
  };
  if (preview) {
    try {
      syncJsonSnapshot(response, 512 * 1024);
    } catch {
      throw fail(
        'INBOX_APPLICATION_RESTORE_PREVIEW_TOO_LARGE',
        'The complete restore preview response exceeds 512 KiB',
        trace,
        {
          ...source,
          ...incomplete,
          ...selection,
          inbox: inboxPath,
          close_pending,
        },
      );
    }
  }
  if (output === undefined) return response;
  // The preview transaction has ended and closing was attempted before any request file is created.
  if (!('restore_query' in result))
    throw fail(
      'INBOX_APPLICATION_RESTORE_REQUEST_INVALID',
      'A completed restore preview is required',
      trace,
      {
        ...source,
        ...selection,
        output_path: output.path,
        local_state: 'not-saved',
        local_write_state: 'not-performed',
        inbox: inboxPath,
        close_pending,
      },
    );
  let requestFile:
    | Awaited<ReturnType<typeof saveInboxApplicationRestoreRequest>>
    | { state: 'not-created'; path: string; reason: 'restore-not-allowed' };
  if (!result.restore_allowed) {
    requestFile = { state: 'not-created', path: output.path, reason: 'restore-not-allowed' };
  } else {
    try {
      const selected = bridge.parseInboxApplicationRestoreQuery(result.restore_query, trace);
      const expected = { ...query, expected_target: result.observed_target };
      if (
        selected.expected_target === undefined ||
        syncJsonSnapshot(selected, 16384) !== syncJsonSnapshot(expected, 16384)
      )
        throw new TypeError();
      requestFile = await saveInboxApplicationRestoreRequest(
        { ...selected, expected_target: selected.expected_target },
        output,
        trace,
      );
    } catch (error) {
      throw fail(
        error instanceof ContractError
          ? error.envelope.code
          : 'INBOX_APPLICATION_RESTORE_REQUEST_INVALID',
        error instanceof ContractError
          ? error.envelope.message
          : 'The preview did not provide the exact original bound restore query',
        trace,
        {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          ...source,
          ...selection,
          output_path: output.path,
          restore_query: result.restore_query,
          preview_completed: true,
          local_write_state: 'not-performed',
          inbox: inboxPath,
          close_pending,
        },
      );
    }
  }
  const completed = { ...response, data: { ...response.data, request_file: requestFile } };
  try {
    syncJsonSnapshot(completed, 512 * 1024);
  } catch {
    throw fail(
      'INBOX_APPLICATION_RESTORE_PREVIEW_TOO_LARGE',
      'The complete preview response exceeds 512 KiB; retain the reported request file state',
      trace,
      {
        ...source,
        ...selection,
        request_file: requestFile,
        restore_query: result.restore_query,
        preview_completed: true,
        response_completed: false,
        local_write_state: 'not-performed',
        inbox: inboxPath,
        close_pending,
      },
    );
  }
  return completed;
}
