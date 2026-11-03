import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  ContractError,
  parseSyncAckResultDocument,
  parseSyncAckResultFile,
  syncAckResultDocumentJson,
  syncSavedPageDocumentJson,
  syncJsonSnapshot,
  SYNC_ACK_RESULT_FILE_BYTES,
  type SyncAckResultFile,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';
import { prepareSyncPageOutput, saveSyncPageArchive } from './sync-page-file.js';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function verify(value: unknown): SyncAckResultFile {
  const saved = parseSyncAckResultFile(value);
  if (
    hash(syncSavedPageDocumentJson(saved.document.page.document)) !==
      saved.document.page.document_sha256 ||
    hash(syncAckResultDocumentJson(saved.document)) !== saved.document_sha256
  )
    throw new TypeError('Acknowledgement result digest mismatch');
  return saved;
}
export async function prepareSyncAckResultOutput(path: string, trace: string) {
  try {
    return await prepareArtifactOutput(path, trace);
  } catch {
    throw new ContractError(
      'INBOX_ACK_RESULT_OUTPUT_UNAVAILABLE',
      'Choose a new result file in an existing directory before sending; existing files and links are never replaced',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
}
export async function readSyncAckResultFile(path: string, trace: string) {
  let bytes: Uint8Array;
  try {
    if (!path.trim() || path === '-') throw new TypeError();
    bytes = await readBoundedArtifactFile(path, SYNC_ACK_RESULT_FILE_BYTES, trace);
  } catch {
    throw new ContractError(
      'INBOX_ACK_RESULT_FILE_UNAVAILABLE',
      'Read a stable regular acknowledgement result file within its size limit',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    return { ...verify(JSON.parse(text)), file_bytes: bytes.byteLength, file_sha256: hash(bytes) };
  } catch {
    throw new ContractError(
      'INBOX_ACK_RESULT_FILE_INVALID',
      'The original page, pre-request snapshot, complete server result or digest does not match',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
}

/** File failures are data so callers can retain their original server result and journal error. */
export async function captureSyncAckResult(value: unknown, output: ArtifactOutput, trace: string) {
  const destination = { ...output };
  try {
    let saved: SyncAckResultFile;
    let bytes: Uint8Array;
    try {
      const document = parseSyncAckResultDocument(value);
      saved = verify({ document, document_sha256: hash(syncAckResultDocumentJson(document)) });
      bytes = new TextEncoder().encode(syncJsonSnapshot(saved, SYNC_ACK_RESULT_FILE_BYTES));
    } catch {
      throw new ContractError(
        'INBOX_ACK_RESULT_INVALID',
        'The complete result could not be archived',
        {
          trace_id: trace,
          retryable: false,
          details: { local_state: 'not-saved', output_path: destination.path },
        },
      );
    }
    const local = await saveArtifactOutput(destination, bytes, hash(bytes), trace);
    try {
      const stored = await readSyncAckResultFile(local.path, trace);
      if (
        stored.file_bytes !== bytes.byteLength ||
        stored.file_sha256 !== hash(bytes) ||
        stored.document_sha256 !== saved.document_sha256 ||
        syncAckResultDocumentJson(stored.document) !== syncAckResultDocumentJson(saved.document)
      )
        throw new TypeError();
    } catch {
      throw new ContractError(
        'INBOX_ACK_RESULT_READBACK_FAILED',
        'The result file was created but its final contents could not be confirmed; retain it for inspection',
        {
          trace_id: trace,
          retryable: false,
          details: {
            local_state: 'published-unconfirmed',
            output_path: local.path,
            cleanup_pending: local.cleanup_pending,
            ...(local.temporary_path === undefined ? {} : { temporary_path: local.temporary_path }),
          },
        },
      );
    }
    return {
      ...local,
      document_sha256: saved.document_sha256,
      file_bytes: bytes.byteLength,
      file_sha256: hash(bytes),
    };
  } catch (error) {
    return {
      state: 'save-failed' as const,
      path: destination.path,
      error: {
        code: error instanceof ContractError ? error.envelope.code : 'INBOX_ACK_RESULT_SAVE_FAILED',
        message:
          error instanceof ContractError
            ? error.envelope.message
            : 'The result file could not be saved; preserve the original command output',
        details:
          error instanceof ContractError
            ? error.envelope.details
            : { local_state: 'unconfirmed', output_path: destination.path },
      },
    };
  }
}

export function isInboxAckResultCommand(command: string) {
  return command === 'inbox ack-result-inspect' || command === 'inbox ack-result-page';
}
/** Offline only: this module never opens an inbox, sends a request or settles journal state. */
export async function runSyncAckResultArguments(argv: string[], trace: string) {
  let file: string;
  let output: string | undefined;
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: { 'result-file': { type: 'string' }, output: { type: 'string' } },
    });
    const path = args.values['result-file'];
    const command = args.positionals.join(' ');
    output = args.values.output;
    if (
      args.positionals.length !== 2 ||
      !isInboxAckResultCommand(command) ||
      args.tokens.filter((token) => token.kind === 'option').length !==
        (command === 'inbox ack-result-page' ? 2 : 1) ||
      (command === 'inbox ack-result-page'
        ? !output?.trim() || output === '-'
        : output !== undefined) ||
      !path?.trim() ||
      path === '-'
    )
      throw new TypeError();
    file = path;
  } catch {
    throw new ContractError(
      'USAGE_ERROR',
      'Use inbox ack-result-inspect --result-file SAVED.json or inbox ack-result-page --result-file SAVED.json --output NEW_PAGE.json; no other options, repeated options or stdin',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
  const saved = await readSyncAckResultFile(file, trace);
  if (output !== undefined) {
    const destination = await prepareSyncPageOutput(output, trace);
    const result = await saveSyncPageArchive(saved.document.page, destination, trace);
    return {
      ...result,
      data: {
        ...result.data,
        source_result_document_sha256: saved.document_sha256,
        source_result_version: saved.document.schema_version,
        provenance: 'local-capture-not-authenticated' as const,
      },
    };
  }
  const document = saved.document;
  const page = document.page.document;
  const identity = page.expected_identity;
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: {
      tenant_id: identity.tenant_id,
      workspace_id: identity.workspace_id,
      project_id: identity.project_id,
    },
    data: {
      archive_version: document.schema_version,
      document_sha256: saved.document_sha256,
      expected_identity: identity,
      record_before_request: document.record_before_request,
      dispatch_before_request: document.dispatch_before_request,
      invocation_trace_id: document.invocation_trace_id,
      server_result_kind: document.server_result_kind,
      server_result: document.server_result,
      journal_update: document.journal_update,
      page: {
        document_sha256: document.page.document_sha256,
        from_cursor: page.query.cursor,
        next_cursor: page.page.data.next_cursor,
        page_trace_id: page.page.trace_id,
        event_count: page.page.data.changes.length,
      },
      local: {
        state: 'read-and-verified' as const,
        path: file,
        file_bytes: saved.file_bytes,
        file_sha256: saved.file_sha256,
      },
      provenance: 'local-capture-not-authenticated' as const,
      current_server_state: 'not-queried' as const,
      event_application: 'not-verified' as const,
      acknowledgement_dispatch_state: 'not-sent' as const,
    },
  };
}
