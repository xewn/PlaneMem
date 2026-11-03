import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdtemp, open, rmdir, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, proposalReceiptJson } from '@planemem/contracts';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import {
  captureProposalQueueBackup,
  inspectProposalQueueBackup,
  PROPOSAL_QUEUE_BACKUP_BYTES,
} from './proposal-queue-backup.js';
import { compareProposalQueueBackups } from './proposal-queue-backup-comparison.js';
import { prepareGenerationOutput } from './generation-output.js';
import { restoredProposalQueueJob } from './proposal-queue-restore-state.js';
import {
  PROPOSAL_QUEUE_CORE_SCHEMA,
  PROPOSAL_QUEUE_GENERATION_SCHEMA,
  PROPOSAL_QUEUE_JOB_COLUMNS,
  PROPOSAL_QUEUE_GENERATION_COLUMNS,
} from './proposal-queue-schema.js';

export interface ProposalQueueRestoreOptions {
  preview?: boolean;
  confirm_sha256?: string;
}
// SQLite page/index overhead is separate from the bounded logical backup format.
const databaseBytes = 2 * PROPOSAL_QUEUE_BACKUP_BYTES;
type Identity = { dev: bigint; ino: bigint };

function prepare(value: unknown, input: ProposalQueueBinding) {
  const backup = inspectProposalQueueBackup(value);
  const binding = normalizeQueueBinding(input);
  if (!isDeepStrictEqual(binding, backup.binding))
    throw new ContractError(
      'PROPOSAL_QUEUE_BINDING_MISMATCH',
      'Keep the original backup gateway, project and identity when restoring',
    );
  const jobs = backup.jobs.map(restoredProposalQueueJob);
  const { sha256: _sourceDigest, ...original } = backup;
  // This synthetic snapshot validates the planned content; its capture time is not a new observation.
  const body = { ...original, jobs };
  const expected = inspectProposalQueueBackup({
    ...body,
    sha256: createHash('sha256')
      .update(proposalReceiptJson(body, PROPOSAL_QUEUE_BACKUP_BYTES), 'utf8')
      .digest('hex'),
  });
  const unconfirmed = backup.jobs.filter((row) => row.status !== 'submitted');
  const summary = {
    schema_version: 1 as const,
    kind: 'proposal-queue-restore' as const,
    backup_sha256: backup.sha256,
    backup_captured_at: backup.captured_at,
    binding,
    policy: 'quarantine-unconfirmed' as const,
    jobs: jobs.length,
    submitted_preserved: jobs.length - unconfirmed.length,
    quarantined: unconfirmed.length,
    newly_uncertain: unconfirmed.filter((row) => row.uncertain === 0).length,
    old_leases_cleared: unconfirmed.filter((row) => row.lease_token !== null).length,
    generation_history_present: backup.generation_history_present,
    generation_records: backup.generation_records.length,
    quarantined_jobs: unconfirmed.map((row) => ({
      job_id: row.job_id,
      previous_status: row.status,
      previous_uncertain: row.uncertain === 1,
      status: 'blocked' as const,
      uncertain: true,
    })),
    source_queue: 'not-opened' as const,
    current_remote: 'not-checked' as const,
    automatic_dispatch: false,
  };
  return { backup, binding, expected, summary };
}

async function absent(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new TypeError('The new queue path or a journal sidecar already exists');
}
async function noSidecars(path: string) {
  for (const suffix of ['-wal', '-shm', '-journal']) await absent(path + suffix);
}
async function sameFile(path: string, identity: Identity) {
  const current = await lstat(path, { bigint: true });
  if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino)
    throw new TypeError('The newly created queue file identity changed');
  return current;
}
async function fileDigest(path: string, identity: Identity) {
  await sameFile(path, identity);
  const file = await open(path, 'r');
  try {
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.dev !== identity.dev ||
      before.ino !== identity.ino ||
      before.size < 1n ||
      before.size > BigInt(databaseBytes)
    )
      throw new TypeError('The restored database exceeds its file bound');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, databaseBytes - total + 1),
        total,
      );
      if (!bytesRead) break;
      total += bytesRead;
      if (total > databaseBytes) throw new TypeError();
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat({ bigint: true });
    const named = await sameFile(path, identity);
    if (
      BigInt(total) !== before.size ||
      after.size !== before.size ||
      named.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      named.mtimeNs !== before.mtimeNs
    )
      throw new TypeError('The restored database changed during readback');
    return { sha256: hash.digest('hex'), bytes: total };
  } finally {
    await file.close();
  }
}

/** Create a fresh queue only; the current worker gates every unconfirmed restored task on receipt reads. */
export async function restoreProposalQueueBackup(
  value: unknown,
  binding: ProposalQueueBinding,
  target: string,
  options: ProposalQueueRestoreOptions = {},
) {
  const prepared = prepare(value, binding);
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !['preview', 'confirm_sha256'].includes(key))
  )
    throw new TypeError('Use preview or an explicit backup SHA-256 confirmation');
  // Freeze the chosen operation before the first asynchronous path check.
  const requestedPreview = options.preview;
  const preview = requestedPreview === undefined ? false : requestedPreview;
  const confirmation = options.confirm_sha256;
  if (
    typeof preview !== 'boolean' ||
    (preview && confirmation !== undefined) ||
    (!preview && confirmation !== prepared.backup.sha256)
  )
    throw new ContractError(
      'PROPOSAL_QUEUE_RESTORE_CONFIRMATION_REQUIRED',
      'Preview the complete backup, then explicitly confirm its SHA-256 to restore a new queue',
    );
  let outputPath = target;
  let temporaryDirectory: string | undefined;
  let temporaryPath: string | undefined;
  let db: DatabaseSync | undefined;
  let transactionOpen = false;
  let importState = 'not-started';
  let closeState = 'not-opened';
  let phase = 'prepare';
  let published = false;
  try {
    const output = await prepareGenerationOutput(target);
    outputPath = output.path;
    if (/(?:-wal|-shm|-journal)$/i.test(basename(output.path)))
      throw new TypeError('Choose a queue filename, not a SQLite journal sidecar name');
    await noSidecars(output.path);
    if (preview)
      return { ...prepared.summary, output: { state: 'preview' as const, path: output.path } };

    phase = 'create';
    temporaryDirectory = await mkdtemp(join(output.directory, '.proposal-restore-'));
    await chmod(temporaryDirectory, 0o700);
    temporaryPath = join(temporaryDirectory, 'queue.sqlite');
    const holder = await open(temporaryPath, 'wx+', 0o600);
    const identity = await (async () => {
      try {
        const stat = await holder.stat({ bigint: true });
        if (!stat.isFile() || stat.size !== 0n) throw new TypeError();
        return { dev: stat.dev, ino: stat.ino };
      } finally {
        await holder.close();
      }
    })();
    if ((await sameFile(temporaryPath, identity)).size !== 0n) throw new TypeError();
    await noSidecars(temporaryPath);
    phase = 'import';
    db = new DatabaseSync(temporaryPath);
    closeState = 'open';
    db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON');
    db.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
    importState = 'active';
    db.exec(PROPOSAL_QUEUE_CORE_SCHEMA);
    db.prepare('INSERT INTO proposal_queue_binding VALUES (1, 1, ?)').run(
      JSON.stringify(prepared.binding),
    );
    const insertJob = db.prepare(
      'INSERT INTO proposal_jobs (' +
        PROPOSAL_QUEUE_JOB_COLUMNS.join(',') +
        ') VALUES (' +
        PROPOSAL_QUEUE_JOB_COLUMNS.map(() => '?').join(',') +
        ')',
    );
    for (const row of prepared.expected.jobs)
      insertJob.run(...PROPOSAL_QUEUE_JOB_COLUMNS.map((column) => row[column]));
    if (prepared.expected.generation_history_present) {
      db.exec(PROPOSAL_QUEUE_GENERATION_SCHEMA);
      const insertGeneration = db.prepare(
        'INSERT INTO proposal_generation_records (' +
          PROPOSAL_QUEUE_GENERATION_COLUMNS.join(',') +
          ') VALUES (' +
          PROPOSAL_QUEUE_GENERATION_COLUMNS.map(() => '?').join(',') +
          ')',
      );
      for (const row of prepared.expected.generation_records)
        insertGeneration.run(...PROPOSAL_QUEUE_GENERATION_COLUMNS.map((column) => row[column]));
    }
    phase = 'commit';
    db.exec('COMMIT');
    transactionOpen = false;
    importState = 'committed';
    phase = 'close-import';
    db.close();
    db = undefined;
    closeState = 'closed';
    await sameFile(temporaryPath, identity);
    await noSidecars(temporaryPath);

    phase = 'readback';
    db = new DatabaseSync(temporaryPath, { readOnly: true });
    closeState = 'open';
    db.exec('PRAGMA query_only = ON; BEGIN');
    transactionOpen = true;
    const observed = captureProposalQueueBackup(db, prepared.binding);
    if (!compareProposalQueueBackups(prepared.expected, observed).identical)
      throw new TypeError('Restored queue does not match every planned field');
    db.exec('COMMIT');
    transactionOpen = false;
    phase = 'close-readback';
    db.close();
    db = undefined;
    closeState = 'closed';

    phase = 'sync';
    const file = await open(temporaryPath, 'r+');
    try {
      const stat = await file.stat({ bigint: true });
      if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino)
        throw new TypeError();
      await file.sync();
    } finally {
      await file.close();
    }
    await noSidecars(temporaryPath);
    const originalFile = await fileDigest(temporaryPath, identity);
    await absent(output.path);
    await noSidecars(output.path);
    phase = 'publish';
    await link(temporaryPath, output.path);
    published = true;
    phase = 'verify-published';
    await noSidecars(output.path);
    const saved = await fileDigest(output.path, identity);
    if (saved.sha256 !== originalFile.sha256 || saved.bytes !== originalFile.bytes)
      throw new TypeError('Published queue readback differs from the restored database');
    await noSidecars(output.path);

    let cleanupPending = true;
    try {
      await sameFile(temporaryPath, identity);
      await noSidecars(temporaryPath);
      await unlink(temporaryPath);
      await rmdir(temporaryDirectory);
      cleanupPending = false;
    } catch {
      /* Never remove the published queue; report remaining staging artifacts. */
    }
    return {
      ...prepared.summary,
      close_state: 'closed' as const,
      output: {
        state: 'restored' as const,
        path: output.path,
        database_sha256: saved.sha256,
        database_bytes: saved.bytes,
        cleanup_pending: cleanupPending,
        ...(cleanupPending
          ? { temporary_directory: temporaryDirectory, temporary_path: temporaryPath }
          : {}),
      },
    };
  } catch (error) {
    if (db) {
      if (transactionOpen) {
        try {
          db.exec('ROLLBACK');
          if (importState === 'active') importState = 'rolled-back';
        } catch {
          if (importState === 'active') importState = 'not-confirmed';
        }
      }
      try {
        db.close();
        closeState = 'closed';
      } catch {
        closeState = 'not-confirmed';
      }
    }
    throw new ContractError(
      'PROPOSAL_QUEUE_RESTORE_FAILED',
      'Keep the original backup and reported paths; new-queue publication was not confirmed',
      {
        summary: prepared.summary,
        output_path: outputPath,
        phase,
        import_state: importState,
        close_state: closeState,
        publication: published ? 'linked-but-not-verified' : 'not-confirmed',
        ...(temporaryDirectory ? { temporary_directory: temporaryDirectory } : {}),
        ...(temporaryPath ? { temporary_path: temporaryPath } : {}),
        ...(error instanceof ContractError ? { cause_code: error.envelope.code } : {}),
      },
    );
  }
}
