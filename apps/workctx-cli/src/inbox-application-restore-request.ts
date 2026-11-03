import { createHash } from 'node:crypto';
import type {
  SyncInboxApplicationRestoreQuery,
  SyncInboxApplicationRestoreTarget,
} from '@planemem/context-bridge';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import { saveArtifactOutput, type ArtifactOutput } from './artifact-output.js';
import { applicationArchiveFailure as fail } from './inbox-application-archive-file.js';

type BoundRestoreQuery = SyncInboxApplicationRestoreQuery & {
  expected_target: SyncInboxApplicationRestoreTarget;
};

/** Caller has parsed/bound the query and ended the readonly preview transaction before publication. */
export async function saveInboxApplicationRestoreRequest(
  input: BoundRestoreQuery,
  output: ArtifactOutput,
  trace: string,
) {
  const destination = { ...output };
  // Freeze the original request bytes before any filesystem await.
  let bytes: Uint8Array;
  try {
    bytes = new TextEncoder().encode(syncJsonSnapshot(input, 16384));
  } catch {
    throw fail(
      'INBOX_APPLICATION_RESTORE_REQUEST_INVALID',
      'The complete bound restore query cannot be saved within 16 KiB',
      trace,
      { output_path: destination.path, local_state: 'not-saved' },
    );
  }
  const file_sha256 = createHash('sha256').update(bytes).digest('hex');
  let local: Awaited<ReturnType<typeof saveArtifactOutput>>;
  try {
    local = await saveArtifactOutput(destination, bytes, file_sha256, trace);
  } catch (error) {
    throw fail(
      'INBOX_APPLICATION_RESTORE_REQUEST_SAVE_FAILED',
      'The original restore query could not be saved; retain the reported paths and request',
      trace,
      {
        output_path: destination.path,
        file_bytes: bytes.byteLength,
        file_sha256,
        ...(error instanceof ContractError ? error.envelope.details : {}),
      },
    );
  }
  try {
    const stored = await readBoundedArtifactFile(local.path, 16384, trace);
    if (
      stored.byteLength !== bytes.byteLength ||
      createHash('sha256').update(stored).digest('hex') !== file_sha256 ||
      stored.some((value, index) => value !== bytes[index])
    )
      throw new TypeError();
  } catch {
    throw fail(
      'INBOX_APPLICATION_RESTORE_REQUEST_READBACK_FAILED',
      'The restore query was published but its final contents could not be confirmed; retain the output',
      trace,
      {
        local_state: 'published-unconfirmed',
        output_path: local.path,
        file_bytes: bytes.byteLength,
        file_sha256,
        cleanup_pending: local.cleanup_pending,
        ...(local.temporary_path === undefined ? {} : { temporary_path: local.temporary_path }),
      },
    );
  }
  return {
    ...local,
    file_bytes: bytes.byteLength,
    file_sha256,
    format: 'application-restore-query-json' as const,
    verification: 'exact-final-file-bytes' as const,
  };
}
