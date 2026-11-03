import { createHash } from 'node:crypto';
import {
  ContractError,
  parseSyncApplicationArchiveFile,
  syncApplicationArchiveDocumentJson,
  syncApplicationArchiveProjectionJson,
  syncSavedPageDocumentJson,
  syncJsonSnapshot,
  SYNC_APPLICATION_ARCHIVE_FILE_BYTES,
  type SyncApplicationArchiveFile,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import { saveArtifactOutput, type ArtifactOutput } from './artifact-output.js';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function applicationArchiveFailure(
  code: string,
  message: string,
  trace: string,
  details: Record<string, unknown> = {},
) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { ...details, acknowledgement_dispatch_state: 'not-sent' },
  });
}
function verify(value: unknown) {
  const saved = parseSyncApplicationArchiveFile(value);
  if (hash(syncApplicationArchiveDocumentJson(saved.document)) !== saved.document_sha256)
    throw new TypeError();
  for (const step of saved.document.steps) {
    if (
      hash(syncSavedPageDocumentJson(step.page.document)) !== step.page.document_sha256 ||
      hash(syncApplicationArchiveProjectionJson(step.projection)) !== step.projection_sha256
    )
      throw new TypeError();
  }
  return saved;
}
export async function readApplicationArchiveFile(path: string, trace: string) {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedArtifactFile(path, SYNC_APPLICATION_ARCHIVE_FILE_BYTES, trace);
  } catch {
    throw applicationArchiveFailure(
      'INBOX_APPLICATION_ARCHIVE_FILE_UNAVAILABLE',
      'Read a stable regular application archive within its file limit',
      trace,
    );
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    return {
      saved: verify(JSON.parse(raw)),
      file_bytes: bytes.byteLength,
      file_sha256: hash(bytes),
    };
  } catch {
    throw applicationArchiveFailure(
      'INBOX_APPLICATION_ARCHIVE_FILE_INVALID',
      'The complete application archive or one of its page/projection/document digests is invalid; preserve the original file',
      trace,
    );
  }
}
export async function saveApplicationArchiveFile(
  value: unknown,
  output: ArtifactOutput,
  trace: string,
) {
  const destination = { ...output };
  let saved: SyncApplicationArchiveFile;
  let bytes: Uint8Array;
  try {
    saved = verify(value);
    bytes = new TextEncoder().encode(syncJsonSnapshot(saved, SYNC_APPLICATION_ARCHIVE_FILE_BYTES));
  } catch {
    throw applicationArchiveFailure(
      'INBOX_APPLICATION_ARCHIVE_INVALID',
      'The complete archive cannot be represented within its format limits',
      trace,
    );
  }
  const file_sha256 = hash(bytes);
  let local;
  try {
    local = await saveArtifactOutput(destination, bytes, file_sha256, trace);
  } catch (error) {
    throw applicationArchiveFailure(
      'INBOX_APPLICATION_ARCHIVE_SAVE_FAILED',
      'The archive could not be saved completely; inspect the reported paths before exporting again',
      trace,
      error instanceof ContractError ? error.envelope.details : { output_path: destination.path },
    );
  }
  try {
    const stored = await readApplicationArchiveFile(local.path, trace);
    if (
      stored.file_bytes !== bytes.byteLength ||
      stored.file_sha256 !== file_sha256 ||
      stored.saved.document_sha256 !== saved.document_sha256
    )
      throw new TypeError();
  } catch {
    throw applicationArchiveFailure(
      'INBOX_APPLICATION_ARCHIVE_READBACK_FAILED',
      'The archive was created but its final contents could not be confirmed; retain it for inspection',
      trace,
      {
        local_state: 'published-unconfirmed',
        output_path: local.path,
        cleanup_pending: local.cleanup_pending,
        ...(local.temporary_path === undefined ? {} : { temporary_path: local.temporary_path }),
      },
    );
  }
  return { saved, local: { ...local, file_bytes: bytes.byteLength, file_sha256 } };
}
