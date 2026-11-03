import { createHash } from 'node:crypto';
import type { OutboxRestoreQuery } from '@planemem/context-bridge';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import { saveArtifactOutput, type ArtifactOutput } from './artifact-output.js';

/** Input is the complete parsed query from a finished preparation; freeze it before filesystem awaits. */
export async function saveOutboxRestoreRequest(
  input: OutboxRestoreQuery,
  output: ArtifactOutput,
  trace: string,
) {
  const destination = { ...output };
  let text: string;
  try {
    text = syncJsonSnapshot(input, 16384);
  } catch {
    throw new ContractError(
      'OUTBOX_RESTORE_REQUEST_INVALID',
      'The complete restore request exceeds its JSON limits',
      {
        trace_id: trace,
        details: { output_path: destination.path, local_state: 'not-saved' },
      },
    );
  }
  const bytes = new TextEncoder().encode(text);
  const file_sha256 = createHash('sha256').update(bytes).digest('hex');
  let local: Awaited<ReturnType<typeof saveArtifactOutput>>;
  try {
    local = await saveArtifactOutput(destination, bytes, file_sha256, trace);
  } catch (error) {
    throw new ContractError(
      'OUTBOX_RESTORE_REQUEST_SAVE_FAILED',
      'The prepared request could not be saved; retain the request and reported file state',
      {
        trace_id: trace,
        retryable: false,
        details: {
          output_path: destination.path,
          file_bytes: bytes.byteLength,
          file_sha256,
          ...(error instanceof ContractError
            ? { ...error.envelope.details, cause_code: error.envelope.code }
            : {}),
        },
      },
    );
  }
  try {
    const stored = await readBoundedArtifactFile(local.path, 16384, trace);
    if (
      stored.byteLength !== bytes.byteLength ||
      createHash('sha256').update(stored).digest('hex') !== file_sha256 ||
      stored.some((value, index) => value !== bytes[index]) ||
      syncJsonSnapshot(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored)),
        16384,
      ) !== text
    )
      throw new TypeError();
  } catch (error) {
    throw new ContractError(
      'OUTBOX_RESTORE_REQUEST_READBACK_FAILED',
      'The request was published but its final contents could not be confirmed; retain the output',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError
            ? { ...error.envelope.details, cause_code: error.envelope.code }
            : {}),
          local_state: 'published-unconfirmed',
          output_path: local.path,
          file_bytes: bytes.byteLength,
          file_sha256,
          cleanup_pending: local.cleanup_pending,
          ...(local.temporary_path === undefined ? {} : { temporary_path: local.temporary_path }),
        },
      },
    );
  }
  return {
    ...local,
    file_bytes: bytes.byteLength,
    file_sha256,
    format: 'outbox-restore-query-json' as const,
    verification: 'exact-final-file-bytes-and-json' as const,
  };
}
