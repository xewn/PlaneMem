import { lstat, mkdir, opendir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, createUlid, syncJsonSnapshot } from '@planemem/contracts';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import { prepareGenerationOutput, saveGenerationFile } from './generation-output.js';
import { paths, readOptional } from './generation-journal-read.js';
import { GENERATION_REQUEST_BYTES } from './generation-request.js';
import {
  captureGenerationJournalBackup,
  inspectGenerationJournalBackup,
  readGenerationJournalBackup,
  GENERATION_JOURNAL_BACKUP_BYTES,
} from './generation-journal-backup.js';
import {
  GENERATION_JOURNAL_RESTORE_MARKER,
  GENERATION_JOURNAL_RESTORE_SOURCE,
  readGenerationJournalDispatchPolicy,
} from './generation-journal-guard.js';

export interface GenerationJournalRestoreOptions {
  preview?: boolean;
  confirm_sha256?: string;
}
const prefix = 'PROPOSAL_GENERATION_JOURNAL_RESTORE_';
const markerBytes = 64 * 1024;

function confirmation(value: unknown, digest: string) {
  try {
    const row: unknown = JSON.parse(syncJsonSnapshot(value, 4096));
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError();
    const options = row as Record<string, unknown>;
    if (
      Object.keys(options).some((key) => !['preview', 'confirm_sha256'].includes(key)) ||
      (options.preview !== undefined && typeof options.preview !== 'boolean')
    )
      throw new TypeError();
    if (options.preview === true) {
      if (options.confirm_sha256 !== undefined) throw new TypeError();
      return true;
    }
    if (options.confirm_sha256 !== digest) throw new TypeError();
    return false;
  } catch {
    throw new ContractError(
      prefix + 'CONFIRMATION_REQUIRED',
      'Preview or explicitly confirm the complete source backup SHA-256',
    );
  }
}

/** Restore historical files into a new guarded directory. No model or queue can be called here. */
export async function restoreGenerationJournalBackup(
  value: unknown,
  input: ProposalQueueBinding,
  outputPath: string,
  options: GenerationJournalRestoreOptions = {},
) {
  const backup = inspectGenerationJournalBackup(value);
  const binding = normalizeQueueBinding(input);
  if (!isDeepStrictEqual(binding, backup.binding))
    throw new ContractError(
      prefix + 'BINDING_MISMATCH',
      'Restore using the original backup gateway, project and identity',
    );
  const preview = confirmation(options, backup.sha256);
  // Shared path preparation only inspects the existing parent and requires the target to be absent.
  let destination: Awaited<ReturnType<typeof prepareGenerationOutput>>;
  try {
    destination = await prepareGenerationOutput(outputPath);
  } catch {
    throw new ContractError(
      prefix + 'OUTPUT_UNAVAILABLE',
      'Choose a new journal directory name inside an existing parent directory',
    );
  }
  const root = destination.path;
  const expected = new Set<string>([
    GENERATION_JOURNAL_RESTORE_MARKER,
    GENERATION_JOURNAL_RESTORE_SOURCE,
  ]);
  for (const item of backup.requests) {
    const files = paths(root, item.request.request_key);
    expected.add(basename(files.request));
    if (item.attempt) expected.add(basename(files.attempt));
    if (item.outcome) expected.add(basename(files.outcome));
  }
  const summary = {
    schema_version: 1 as const,
    kind: 'proposal-generation-journal-restore' as const,
    source_backup_sha256: backup.sha256,
    source_started_at: backup.started_at,
    source_completed_at: backup.completed_at,
    binding,
    path: root,
    policy: 'block-new-generation' as const,
    requests: backup.requests.length,
    attempts: backup.requests.filter((item) => item.attempt !== null).length,
    outcomes: backup.requests.filter((item) => item.outcome !== null).length,
    prepared_observations: backup.requests.filter((item) => item.state === 'prepared').length,
    expected_files: expected.size,
    source_backup_file: join(root, GENERATION_JOURNAL_RESTORE_SOURCE),
    restore_marker: join(root, GENERATION_JOURNAL_RESTORE_MARKER),
    current_provider: 'not-checked' as const,
    original_process: 'not-coordinated' as const,
    provider_dispatch: 'not-sent' as const,
    provider_dispatch_scope: 'this-invocation' as const,
    queue_access: 'none' as const,
  };
  if (preview) return { ...summary, state: 'preview' as const, mutation: 'none' as const };

  const restoreId = createUlid();
  const marker = {
    schema_version: 1,
    kind: 'proposal-generation-journal-restore-marker',
    restore_id: restoreId,
    created_at: new Date().toISOString(),
    source_backup_sha256: backup.sha256,
    binding,
    policy: 'block-new-generation',
    // Written before any request; presence alone cannot attest a completed restoration.
    completion: 'not-attested',
  };
  const markerContent = Buffer.from(JSON.stringify(marker, null, 2) + '\n', 'utf8');
  if (markerContent.byteLength > markerBytes)
    throw new ContractError(prefix + 'LIMIT', 'Restore metadata exceeds its byte budget');
  let phase = 'create-directory';
  let created = false;
  let guardConfirmed = false;
  let savedFiles = 0;
  let activeFile: string | null = null;
  const temporaryPaths = new Set<string>();
  let identity: { dev: bigint; ino: bigint } | undefined;
  const assertDirectory = async () => {
    const current = await lstat(root, { bigint: true });
    if (
      !identity ||
      !current.isDirectory() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino
    )
      throw new TypeError('The new journal directory identity changed');
  };
  const save = async (path: string, content: unknown, maximum: number) => {
    activeFile = path;
    await assertDirectory();
    if (
      phase === 'save-requests' &&
      (await readGenerationJournalDispatchPolicy(root)) !== 'blocked-restored'
    )
      throw new TypeError('The restore quarantine is no longer observable');
    const output = await prepareGenerationOutput(path);
    const saved = await saveGenerationFile(
      output,
      Buffer.from(JSON.stringify(content, null, 2) + '\n', 'utf8'),
      maximum,
      'trace_generation_journal_restore_' + restoreId,
      prefix + 'FILE_SAVE_FAILED',
    );
    savedFiles++;
    if (saved.cleanup_pending && saved.temporary_path) temporaryPaths.add(saved.temporary_path);
    await assertDirectory();
    if (
      phase === 'save-requests' &&
      (await readGenerationJournalDispatchPolicy(root)) !== 'blocked-restored'
    )
      throw new TypeError('The restore quarantine is no longer observable');
  };
  try {
    // mkdir without recursive is exclusive even if another writer wins after path preparation.
    await mkdir(root, { mode: 0o700 });
    created = true;
    const current = await lstat(root, { bigint: true });
    if (!current.isDirectory()) throw new TypeError();
    identity = { dev: current.dev, ino: current.ino };

    phase = 'save-guard';
    await save(summary.restore_marker, marker, markerBytes);
    guardConfirmed = true;
    phase = 'save-source-backup';
    await save(summary.source_backup_file, backup, GENERATION_JOURNAL_BACKUP_BYTES);
    phase = 'save-requests';
    for (const item of backup.requests) {
      const files = paths(root, item.request.request_key);
      await save(files.request, item.request, GENERATION_REQUEST_BYTES);
      if (item.attempt) await save(files.attempt, item.attempt, 8192);
      if (item.outcome) await save(files.outcome, item.outcome, GENERATION_REQUEST_BYTES);
    }

    phase = 'verify';
    activeFile = null;
    await assertDirectory();
    const observed = await captureGenerationJournalBackup(root, binding);
    if (
      !isDeepStrictEqual(observed.requests, backup.requests) ||
      !isDeepStrictEqual(await readGenerationJournalBackup(summary.source_backup_file), backup) ||
      !isDeepStrictEqual(await readOptional(summary.restore_marker, markerBytes), marker) ||
      (await readGenerationJournalDispatchPolicy(root)) !== 'blocked-restored'
    )
      throw new TypeError();
    const expectedWithTemporary = new Set([
      ...expected,
      ...[...temporaryPaths].map((path) => basename(path)),
    ]);
    let count = 0;
    const seen = new Set<string>();
    for await (const entry of await opendir(root)) {
      if (
        ++count > expectedWithTemporary.size ||
        !entry.isFile() ||
        !expectedWithTemporary.has(entry.name) ||
        seen.has(entry.name)
      )
        throw new TypeError();
      seen.add(entry.name);
    }
    if (count !== expectedWithTemporary.size) throw new TypeError();
    await assertDirectory();
    return {
      ...summary,
      state: 'restored-blocked' as const,
      mutation: 'new-directory' as const,
      restore_id: restoreId,
      saved_files: savedFiles,
      journal_dispatch: 'blocked-restored' as const,
      verification: 'complete-readback' as const,
      cleanup_pending: temporaryPaths.size > 0,
      temporary_paths: [...temporaryPaths],
    };
  } catch (error) {
    throw new ContractError(
      prefix + 'FAILED',
      'Restoration was not confirmed; keep the original backup and every file in the new directory, then choose another new directory',
      {
        trace_id: 'trace_generation_journal_restore_' + restoreId,
        ...summary,
        restore_id: restoreId,
        phase,
        target_created: created,
        guard_status: guardConfirmed ? 'confirmed-before-requests' : 'not-confirmed',
        saved_files: savedFiles,
        active_file: activeFile,
        temporary_paths: [...temporaryPaths],
        restoration: 'not-confirmed',
        ...(error instanceof ContractError ? { cause_code: error.envelope.code } : {}),
        ...(error instanceof ContractError && error.envelope.code === prefix + 'FILE_SAVE_FAILED'
          ? { output: error.envelope.details }
          : {}),
      },
    );
  }
}
