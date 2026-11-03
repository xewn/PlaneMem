import { resolve } from 'node:path';
import type { SqliteSyncInbox } from '@planemem/context-bridge';
import { assertSyncCommandIdentity, ContractError } from '@planemem/contracts';
import {
  applicationArchiveFailure as fail,
  readApplicationArchiveFile,
} from './inbox-application-archive-file.js';

/** Original query/file binding must succeed before opening the existing writable inbox. */
export async function runInboxApplicationRestore(
  inboxPath: string,
  archivePath: string,
  input: unknown,
  trace: string,
) {
  let bridge: typeof import('@planemem/context-bridge');
  try {
    bridge = await import('@planemem/context-bridge');
  } catch {
    throw fail(
      'INBOX_STORAGE_UNAVAILABLE',
      'The local inbox restore adapter is unavailable',
      trace,
    );
  }
  const query = bridge.parseInboxApplicationRestoreQuery(input, trace);
  const local = await readApplicationArchiveFile(archivePath, trace);
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
      readonly: false,
      trace_id: trace,
    });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'INBOX_STORAGE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The existing inbox could not be opened for explicit restore',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        ...source,
        expected_identity: query.expected_identity,
        application: query.application,
        timeout_ms: query.timeout_ms,
        inbox: inboxPath,
        restore_completed: false,
      },
    );
  }
  let result: ReturnType<SqliteSyncInbox['restoreApplicationArchive']>;
  try {
    result = inbox.restoreApplicationArchive(local.saved, query, trace);
  } catch (error) {
    let close_pending = false;
    try {
      inbox.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'INBOX_APPLICATION_RESTORE_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The application restore could not be completed',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        ...source,
        expected_identity: query.expected_identity,
        application: query.application,
        inbox: inboxPath,
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
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: result.scope,
    data: { ...result, ...source, inbox: inboxPath },
    close_pending,
  };
}
