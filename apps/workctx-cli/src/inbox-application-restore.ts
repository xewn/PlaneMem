import { resolve } from 'node:path';
import type { SqliteSyncInbox } from '@planemem/context-bridge';
import { assertSyncCommandIdentity, ContractError, syncJsonSnapshot } from '@planemem/contracts';
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
) {
  if (mode !== 'restore' && mode !== 'preview')
    throw fail('USAGE_ERROR', 'Select an explicit restore or preview operation', trace);
  const preview = mode === 'preview';
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
    ...(query.expected_target === undefined ? {} : { expected_target: query.expected_target }),
  };
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
  return response;
}
