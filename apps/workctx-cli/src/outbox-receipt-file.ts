import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  parseSyncEventReceiptDocument,
  parseSyncEventReceiptFile,
  syncEventReceiptDocumentJson,
  syncJsonSnapshot,
  SYNC_EVENT_RECEIPT_FILE_BYTES,
  type SyncEventReceiptFile,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function verify(value: unknown): SyncEventReceiptFile {
  const saved = parseSyncEventReceiptFile(value);
  if (hash(syncEventReceiptDocumentJson(saved.document)) !== saved.document_sha256)
    throw new TypeError('Event receipt digest mismatch');
  return saved;
}
export async function prepareOutboxReceiptOutput(path: string, trace: string) {
  try {
    return await prepareArtifactOutput(path, trace);
  } catch {
    throw new ContractError(
      'OUTBOX_RECEIPT_OUTPUT_UNAVAILABLE',
      'Choose a new result file in an existing directory before reconciliation; existing files and links are never replaced',
      { trace_id: trace, retryable: false, reconciliation_state: 'not-started' },
    );
  }
}
export async function readOutboxReceiptFile(path: string, trace: string) {
  let bytes: Uint8Array;
  try {
    if (!path.trim() || path === '-') throw new TypeError();
    bytes = await readBoundedArtifactFile(path, SYNC_EVENT_RECEIPT_FILE_BYTES, trace);
  } catch {
    throw new ContractError(
      'OUTBOX_RECEIPT_FILE_UNAVAILABLE',
      'Read a stable regular event receipt file within its size limit',
      { trace_id: trace, retryable: false },
    );
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    return { ...verify(JSON.parse(raw)), file_bytes: bytes.byteLength, file_sha256: hash(bytes) };
  } catch {
    throw new ContractError(
      'OUTBOX_RECEIPT_FILE_INVALID',
      'The complete original event receipt or document digest does not match',
      { trace_id: trace, retryable: false },
    );
  }
}

/** Save failure is data so it cannot erase the original receipt or reconciliation outcome. */
export async function captureOutboxReceipt(
  receipt: unknown,
  output: ArtifactOutput,
  trace: string,
) {
  const destination = { ...output };
  try {
    let saved: SyncEventReceiptFile;
    let bytes: Uint8Array;
    try {
      const document = parseSyncEventReceiptDocument({
        schema_version: 1,
        kind: 'workctx.sync-event-receipt',
        receipt,
      });
      if (document.receipt.trace_id !== trace) throw new TypeError('Receipt invocation differs');
      saved = verify({ document, document_sha256: hash(syncEventReceiptDocumentJson(document)) });
      bytes = new TextEncoder().encode(syncJsonSnapshot(saved, SYNC_EVENT_RECEIPT_FILE_BYTES));
    } catch {
      throw new ContractError(
        'OUTBOX_RECEIPT_RESULT_INVALID',
        'The complete receipt could not be archived',
        {
          trace_id: trace,
          retryable: false,
          details: { local_state: 'not-saved', output_path: destination.path },
        },
      );
    }
    const file_sha256 = hash(bytes);
    const local = await saveArtifactOutput(destination, bytes, file_sha256, trace);
    try {
      const stored = await readOutboxReceiptFile(local.path, trace);
      if (
        stored.file_bytes !== bytes.byteLength ||
        stored.file_sha256 !== file_sha256 ||
        stored.document_sha256 !== saved.document_sha256 ||
        syncEventReceiptDocumentJson(stored.document) !==
          syncEventReceiptDocumentJson(saved.document)
      )
        throw new TypeError();
    } catch {
      throw new ContractError(
        'OUTBOX_RECEIPT_RESULT_READBACK_FAILED',
        'The receipt file was created but its final contents could not be confirmed; retain it for inspection',
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
      file_sha256,
    };
  } catch (error) {
    return {
      state: 'save-failed' as const,
      path: destination.path,
      error: {
        code:
          error instanceof ContractError
            ? error.envelope.code
            : 'OUTBOX_RECEIPT_RESULT_SAVE_FAILED',
        message:
          error instanceof ContractError
            ? error.envelope.message
            : 'The receipt file could not be saved; preserve the original command output',
        details:
          error instanceof ContractError
            ? error.envelope.details
            : { local_state: 'unconfirmed', output_path: destination.path },
      },
    };
  }
}

/** Offline path: no Bridge import, database, current credentials or network calls. */
export async function inspectOutboxReceiptArguments(argv: string[], trace: string) {
  let file: string;
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: { 'result-file': { type: 'string' } },
    });
    const path = args.values['result-file'];
    if (
      args.positionals.join(' ') !== 'outbox inspect-result' ||
      args.positionals.length !== 2 ||
      args.tokens.filter((token) => token.kind === 'option').length !== 1 ||
      !path?.trim() ||
      path === '-'
    )
      throw new TypeError();
    file = resolve(path);
  } catch {
    throw new ContractError(
      'USAGE_ERROR',
      'Use outbox inspect-result --result-file SAVED.json; no other options, repeated options or stdin',
      { trace_id: trace, retryable: false },
    );
  }
  const saved = await readOutboxReceiptFile(file, trace);
  const receipt = saved.document.receipt;
  const identity = receipt.data.identity;
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
      archive_version: saved.document.schema_version,
      document_sha256: saved.document_sha256,
      receipt,
      local: {
        state: 'read-and-verified' as const,
        path: file,
        file_bytes: saved.file_bytes,
        file_sha256: saved.file_sha256,
      },
      provenance: 'local-capture-not-authenticated' as const,
      current_server_state: 'not-queried' as const,
      local_queue_state: 'not-read' as const,
      event_application: 'not-verified' as const,
    },
  };
}
