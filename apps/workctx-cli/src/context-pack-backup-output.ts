import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { ContractError, PACK_RECEIPT_BACKUP_FILE_BYTES } from '@planemem/contracts';
import type { WcpContextPackReceiptBackupContents } from '@planemem/sdk';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pathKey = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
export const contextBackupFileStates = {
  identity_state: 'not-authenticated',
  server_outcome: 'not-checked',
  content_state: 'not-checked',
  save_dispatch_state: 'not-sent',
  browser_history_access: 'not-performed',
  restore_state: 'not-started',
} as const;

export async function assertDirectory(path: string, identity: BigIntStats) {
  const current = await lstat(path, { bigint: true });
  if (
    !identity.isDirectory() ||
    !current.isDirectory() ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino ||
    pathKey(await realpath(path)) !== pathKey(path)
  )
    throw new TypeError();
}

/** Fixed local names are derived from verified contents, never from historical paths. */
export function createContextBackupPlan(
  contents: WcpContextPackReceiptBackupContents,
  directory: string,
) {
  const files =
    contents.kind === 'single'
      ? [
          {
            name: `backup-${contents.backup.file.document_sha256}.json`,
            candidate: contents.backup,
          },
        ]
      : [
          ...contents.collection.volumes.map((candidate, index) => ({
            name: `volume-${String(index + 1).padStart(3, '0')}-${candidate.file.document_sha256}.json`,
            candidate,
          })),
          {
            name: `manifest-${contents.collection.file.document_sha256}.json`,
            candidate: contents.collection,
          },
        ];
  return files.map(({ name, candidate }) => {
    const bytes = new TextEncoder().encode(candidate.raw);
    return {
      name,
      path: join(directory, name),
      bytes,
      file_sha256: hash(bytes),
      file_bytes: bytes.byteLength,
      document_sha256: candidate.file.document_sha256,
    };
  });
}

/** No timer races publication; every destination is new, and failures retain earlier files. */
export async function saveContextBackupOutput(
  output: ArtifactOutput,
  parentIdentity: BigIntStats,
  plan: ReturnType<typeof createContextBackupPlan>,
  trace: string,
  beforeCreate?: () => Promise<void>,
) {
  const written: {
    path: string;
    state: 'published-unconfirmed' | 'saved-and-read-back';
    file_sha256: string;
    file_bytes: number;
    cleanup_pending: boolean;
    temporary_path?: string;
  }[] = [];
  let directoryCreated = false;
  let identity: BigIntStats | undefined;
  let phase = 'create-directory';
  let currentPath: string | undefined;
  try {
    if (beforeCreate) {
      phase = 'source-readback';
      await beforeCreate();
      phase = 'create-directory';
    }
    await assertDirectory(output.directory, parentIdentity);
    await mkdir(output.path, { recursive: false, mode: 0o700 });
    directoryCreated = true;
    identity = await lstat(output.path, { bigint: true });
    await assertDirectory(output.directory, parentIdentity);
    await assertDirectory(output.path, identity);
    for (const file of plan) {
      currentPath = file.path;
      phase = 'publish-file';
      await assertDirectory(output.path, identity);
      const destination = await prepareArtifactOutput(file.path, trace);
      if (
        pathKey(destination.path) !== pathKey(file.path) ||
        pathKey(destination.directory) !== pathKey(output.path)
      )
        throw new TypeError();
      await assertDirectory(output.path, identity);
      const saved = await saveArtifactOutput(destination, file.bytes, file.file_sha256, trace);
      const record = {
        path: saved.path,
        state: 'published-unconfirmed' as 'published-unconfirmed' | 'saved-and-read-back',
        file_sha256: file.file_sha256,
        file_bytes: file.file_bytes,
        cleanup_pending: saved.cleanup_pending,
        ...(saved.temporary_path === undefined ? {} : { temporary_path: saved.temporary_path }),
      };
      written.push(record);
      phase = 'readback-file';
      await assertDirectory(output.path, identity);
      const bytes = await readBoundedArtifactFile(
        file.path,
        PACK_RECEIPT_BACKUP_FILE_BYTES,
        trace,
        file.file_bytes,
      );
      if (!Buffer.from(bytes).equals(file.bytes) || hash(bytes) !== file.file_sha256)
        throw new TypeError();
      await assertDirectory(output.path, identity);
      record.state = 'saved-and-read-back';
    }
    phase = 'readback-set';
    // The manifest is already last in the publication plan; now recheck every destination.
    for (const file of plan) {
      currentPath = file.path;
      await assertDirectory(output.path, identity);
      const bytes = await readBoundedArtifactFile(
        file.path,
        PACK_RECEIPT_BACKUP_FILE_BYTES,
        trace,
        file.file_bytes,
      );
      if (!Buffer.from(bytes).equals(file.bytes) || hash(bytes) !== file.file_sha256)
        throw new TypeError();
    }
    await assertDirectory(output.path, identity);
    await assertDirectory(output.directory, parentIdentity);
    return {
      state: 'saved-and-read-back' as const,
      directory: output.path,
      files: written,
      cleanup_pending: written.some((file) => file.cleanup_pending),
    };
  } catch (error) {
    const details =
      error instanceof ContractError &&
      error.envelope.trace_id === trace &&
      error.envelope.code === 'ARTIFACT_SAVE_FAILED'
        ? error.envelope.details
        : undefined;
    return {
      state: 'save-failed' as const,
      directory: output.path,
      directory_created: directoryCreated,
      phase,
      ...(currentPath === undefined ? {} : { current_path: currentPath }),
      files: written,
      ...(details === undefined ? {} : { details }),
      message:
        'Keep this complete backup candidate and any files already saved. The set was not confirmed. Recover the complete output into a new directory, or inspect the saved files explicitly.',
    };
  }
}
