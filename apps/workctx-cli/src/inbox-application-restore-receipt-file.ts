import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  parseSyncApplicationRestoreReceiptDocument,
  parseSyncApplicationRestoreReceiptFile,
  syncApplicationRestoreReceiptDocumentJson,
  syncApplicationRestoreQueryJson,
  syncJsonSnapshot,
  SYNC_APPLICATION_RESTORE_RECEIPT_FILE_BYTES,
  type SyncApplicationRestoreReceiptFile,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';
import { applicationArchiveFailure as fail } from './inbox-application-archive-file.js';
import { saveInboxApplicationRestoreRequest } from './inbox-application-restore-request.js';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function verify(value: unknown): SyncApplicationRestoreReceiptFile {
  const saved = parseSyncApplicationRestoreReceiptFile(value);
  if (
    hash(syncApplicationRestoreReceiptDocumentJson(saved.document)) !== saved.document_sha256 ||
    hash(syncApplicationRestoreQueryJson(saved.document.receipt.query)) !==
      saved.document.receipt.request_sha256
  )
    throw new TypeError();
  return saved;
}
export async function readInboxApplicationRestoreReceiptFile(path: string, trace: string) {
  let bytes: Uint8Array;
  try {
    if (!path.trim() || path === '-') throw new TypeError();
    bytes = await readBoundedArtifactFile(path, SYNC_APPLICATION_RESTORE_RECEIPT_FILE_BYTES, trace);
  } catch {
    throw fail(
      'INBOX_APPLICATION_RESTORE_RECEIPT_FILE_UNAVAILABLE',
      'Read a stable regular restore receipt file within its size limit',
      trace,
      { receipt_path: path, local_write_state: 'not-performed' },
    );
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    return { ...verify(JSON.parse(raw)), file_bytes: bytes.byteLength, file_sha256: hash(bytes) };
  } catch {
    throw fail(
      'INBOX_APPLICATION_RESTORE_RECEIPT_FILE_INVALID',
      'The complete historical receipt, original query or document digest is invalid',
      trace,
      { receipt_path: path, local_write_state: 'not-performed' },
    );
  }
}
/** Called only after the successful read transaction ended and closing was attempted. */
export async function saveInboxApplicationRestoreReceiptFile(
  receipt: unknown,
  output: ArtifactOutput,
  trace: string,
) {
  const destination = { ...output };
  let saved: SyncApplicationRestoreReceiptFile;
  let bytes: Uint8Array;
  try {
    const document = parseSyncApplicationRestoreReceiptDocument({
      schema_version: 1,
      kind: 'workctx.sync-application-restore-receipt',
      receipt,
    });
    saved = verify({
      document,
      document_sha256: hash(syncApplicationRestoreReceiptDocumentJson(document)),
    });
    bytes = new TextEncoder().encode(
      syncJsonSnapshot(saved, SYNC_APPLICATION_RESTORE_RECEIPT_FILE_BYTES),
    );
  } catch {
    throw fail(
      'INBOX_APPLICATION_RESTORE_RECEIPT_FILE_INVALID',
      'The complete historical receipt cannot be saved',
      trace,
      { output_path: destination.path, local_state: 'not-saved' },
    );
  }
  const file_sha256 = hash(bytes);
  let local: Awaited<ReturnType<typeof saveArtifactOutput>>;
  try {
    local = await saveArtifactOutput(destination, bytes, file_sha256, trace);
  } catch (error) {
    throw fail(
      'INBOX_APPLICATION_RESTORE_RECEIPT_SAVE_FAILED',
      'The receipt file could not be saved; retain the historical receipt and reported paths',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        output_path: destination.path,
        file_sha256,
        file_bytes: bytes.byteLength,
        document_sha256: saved.document_sha256,
      },
    );
  }
  try {
    const stored = await readInboxApplicationRestoreReceiptFile(local.path, trace);
    if (
      stored.file_bytes !== bytes.byteLength ||
      stored.file_sha256 !== file_sha256 ||
      stored.document_sha256 !== saved.document_sha256 ||
      syncApplicationRestoreReceiptDocumentJson(stored.document) !==
        syncApplicationRestoreReceiptDocumentJson(saved.document)
    )
      throw new TypeError();
  } catch {
    throw fail(
      'INBOX_APPLICATION_RESTORE_RECEIPT_FILE_READBACK_FAILED',
      'The receipt file was published but its final contents could not be confirmed; retain the file',
      trace,
      {
        local_state: 'published-unconfirmed',
        output_path: local.path,
        document_sha256: saved.document_sha256,
        file_sha256,
        file_bytes: bytes.byteLength,
        cleanup_pending: local.cleanup_pending,
        ...(local.temporary_path === undefined ? {} : { temporary_path: local.temporary_path }),
      },
    );
  }
  return {
    ...local,
    format: 'workctx.sync-application-restore-receipt' as const,
    document_sha256: saved.document_sha256,
    file_bytes: bytes.byteLength,
    file_sha256,
  };
}
export function isInboxApplicationRestoreReceiptFileCommand(command: string) {
  return [
    'inbox application-restore-receipt-inspect',
    'inbox application-restore-receipt-query',
  ].includes(command);
}
/** Offline inspection/extraction: no runtime Bridge import, database or network. */
export async function runInboxApplicationRestoreReceiptFileArguments(
  argv: string[],
  trace: string,
) {
  let file: string;
  let outputPath: string | undefined;
  try {
    const args = parseArgs({
      args: [...argv],
      tokens: true,
      allowPositionals: true,
      options: { 'receipt-file': { type: 'string' }, output: { type: 'string' } },
    });
    const command = args.positionals.join(' ');
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const path = args.values['receipt-file'];
    outputPath = args.values.output;
    if (
      !isInboxApplicationRestoreReceiptFileCommand(command) ||
      args.positionals.length !== 2 ||
      !path?.trim() ||
      path === '-' ||
      (command.endsWith('-query')
        ? !outputPath?.trim() || outputPath === '-'
        : outputPath !== undefined)
    )
      throw new TypeError();
    file = resolve(path);
  } catch {
    throw fail(
      'USAGE_ERROR',
      'Use inbox application-restore-receipt-inspect --receipt-file FILE, or application-restore-receipt-query --receipt-file FILE --output NEW_QUERY; no inbox, JSON, archive, repeated options or stdin',
      trace,
    );
  }
  let output: ArtifactOutput | undefined;
  if (outputPath !== undefined) {
    try {
      output = await prepareArtifactOutput(outputPath, trace);
    } catch {
      throw fail(
        'INBOX_APPLICATION_RESTORE_REQUEST_OUTPUT_UNAVAILABLE',
        'Choose a new original-query file in an existing directory',
        trace,
        { output_path: outputPath, receipt_path: file, local_state: 'not-saved' },
      );
    }
  }
  const saved = await readInboxApplicationRestoreReceiptFile(file, trace);
  const receipt = saved.document.receipt;
  const identity = receipt.query.expected_identity;
  const response = {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: {
      tenant_id: identity.tenant_id,
      workspace_id: identity.workspace_id,
      project_id: identity.project_id,
    },
    data: {
      receipt,
      restore_query: receipt.query,
      document_sha256: saved.document_sha256,
      source_file: { path: file, file_bytes: saved.file_bytes, file_sha256: saved.file_sha256 },
      receipt_scope: 'historical-file-content' as const,
      provenance: 'local-file-not-authenticated' as const,
      current_state: 'not-read' as const,
      database_receipt_presence: 'not-checked' as const,
      file_verification: 'document-and-query-sha256' as const,
      full_application_history_audit: 'not-performed' as const,
      projection_semantics: 'not-verified' as const,
      local_write_state: 'not-performed' as const,
      acknowledgement_dispatch_state: 'not-sent' as const,
    },
  };
  const responseLimit = (value: unknown, request_file?: unknown) => {
    try {
      syncJsonSnapshot(value, 256 * 1024);
    } catch {
      throw fail(
        'INBOX_APPLICATION_RESTORE_RECEIPT_FILE_TOO_LARGE',
        'The complete receipt-file response exceeds 256 KiB',
        trace,
        {
          ...response.data,
          response_completed: false,
          ...(request_file === undefined ? {} : { request_file }),
        },
      );
    }
  };
  responseLimit(response);
  if (output === undefined) return response;
  let requestFile: Awaited<ReturnType<typeof saveInboxApplicationRestoreRequest>>;
  try {
    requestFile = await saveInboxApplicationRestoreRequest(receipt.query, output, trace);
  } catch (error) {
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'INBOX_APPLICATION_RESTORE_REQUEST_SAVE_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The original query could not be saved',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        ...response.data,
        output_path: output.path,
      },
    );
  }
  const completed = { ...response, data: { ...response.data, request_file: requestFile } };
  responseLimit(completed, requestFile);
  return completed;
}
