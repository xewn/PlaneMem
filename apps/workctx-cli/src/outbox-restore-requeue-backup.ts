import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import {
  OUTBOX_REQUEUE_BACKUP_FILE_BYTES,
  parseOutboxRestoreRequeueBackupQuery,
  verifyOutboxRestoreRequeueBackup,
  outboxRestoreRequeueBackupSummary,
  type OutboxRestoreRequeueBackupFile,
} from '@planemem/context-bridge/outbox-restore-requeue-backup';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';

export function isOutboxRestoreRequeueBackupCommand(command: string) {
  return (
    command === 'outbox restore-requeue-backup' ||
    command === 'outbox inspect-restore-requeue-backup'
  );
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function argumentsFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        outbox: { type: 'string' },
        output: { type: 'string' },
        'archive-file': { type: 'string' },
        json: { type: 'string' },
        'json-file': { type: 'string' },
      },
    });
    const command = args.positionals.join(' ');
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const { outbox, output, json } = args.values;
    const file = args.values['archive-file'];
    const queryFile = args.values['json-file'];
    if (
      !isOutboxRestoreRequeueBackupCommand(command) ||
      args.positionals.length !== 2 ||
      [outbox, output, file, queryFile].some(
        (path) => path !== undefined && (!path.trim() || path === '-'),
      ) ||
      outbox === ':memory:' ||
      json === '-' ||
      (json !== undefined && queryFile !== undefined)
    )
      throw new TypeError();
    if (command === 'outbox restore-requeue-backup') {
      if (outbox === undefined || output === undefined || file !== undefined) throw new TypeError();
    } else if (
      file === undefined ||
      outbox !== undefined ||
      output !== undefined ||
      json !== undefined ||
      queryFile !== undefined
    )
      throw new TypeError();
    return { command, outbox, output, file, json, queryFile };
  } catch {
    throw fail(
      'USAGE_ERROR',
      'Use outbox restore-requeue-backup --outbox EXISTING_FILE --output NEW_FILE [--json/--json-file QUERY], or outbox inspect-restore-requeue-backup --archive-file FILE. No extra/repeated options, stdin or memory queue',
      trace,
    );
  }
}
/** Parsing alone does not validate history; the caller must verify the complete input before use. */
export async function readOutboxRestoreRequeueBackupInputFile(path: string, trace: string) {
  try {
    const bytes = await readBoundedArtifactFile(path, OUTBOX_REQUEUE_BACKUP_FILE_BYTES, trace);
    const input: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''),
    );
    return { input, file_bytes: bytes.byteLength, file_sha256: hash(bytes) };
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_BACKUP_FILE_INVALID',
      error instanceof ContractError
        ? error.envelope.message
        : 'Read a stable regular UTF-8 requeue history backup within its complete file limit',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        archive_file: resolve(path),
      },
    );
  }
}
export async function readOutboxRestoreRequeueBackupFile(path: string, trace: string) {
  const { input, ...file } = await readOutboxRestoreRequeueBackupInputFile(path, trace);
  try {
    return { saved: verifyOutboxRestoreRequeueBackup(input, trace), ...file };
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_BACKUP_FILE_INVALID',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete requeue history backup is invalid',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        archive_file: resolve(path),
      },
    );
  }
}
async function saveBackup(
  file: OutboxRestoreRequeueBackupFile,
  output: ArtifactOutput,
  trace: string,
) {
  const destination = { ...output };
  const saved = verifyOutboxRestoreRequeueBackup(file, trace);
  const bytes = new TextEncoder().encode(syncJsonSnapshot(saved, OUTBOX_REQUEUE_BACKUP_FILE_BYTES));
  const file_sha256 = hash(bytes);
  const local = await saveArtifactOutput(destination, bytes, file_sha256, trace);
  try {
    const readback = await readBoundedArtifactFile(
      local.path,
      OUTBOX_REQUEUE_BACKUP_FILE_BYTES,
      trace,
    );
    if (
      readback.byteLength !== bytes.byteLength ||
      hash(readback) !== file_sha256 ||
      readback.some((value, index) => value !== bytes[index])
    )
      throw new TypeError();
    const verified = verifyOutboxRestoreRequeueBackup(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readback)),
      trace,
    );
    if (verified.document_sha256 !== saved.document_sha256) throw new TypeError();
  } catch (error) {
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_READBACK_FAILED',
      'The backup was created but its final content could not be confirmed; preserve the reported paths',
      trace,
      {
        ...(error instanceof ContractError
          ? { ...error.envelope.details, cause_code: error.envelope.code }
          : {}),
        ...local,
        state: 'published-unconfirmed',
        local_state: 'published-unconfirmed',
        content_state: 'unconfirmed',
        output_path: local.path,
        file_bytes: bytes.byteLength,
        file_sha256,
      },
    );
  }
  return {
    ...local,
    file_bytes: bytes.byteLength,
    file_sha256,
    format: 'outbox-restore-requeue-backup-json' as const,
    verification: 'exact-final-file-bytes-and-complete-history' as const,
  };
}
async function readQuery(args: ReturnType<typeof argumentsFor>, trace: string) {
  try {
    let raw = args.json;
    if (args.queryFile !== undefined)
      raw = new TextDecoder('utf-8', { fatal: true })
        .decode(await readBoundedArtifactFile(args.queryFile, 16384, trace))
        .replace(/^\uFEFF/, '');
    if (raw === undefined) return {} as Record<string, unknown>;
    if (Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    return input as Record<string, unknown>;
  } catch (error) {
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_QUERY_INVALID',
      'Supply a stable UTF-8 JSON history backup query within 16 KiB',
      trace,
      {
        ...(error instanceof ContractError
          ? { ...error.envelope.details, cause_code: error.envelope.code }
          : {}),
        query_file: args.queryFile === undefined ? null : resolve(args.queryFile),
      },
    );
  }
}
function envelope(
  file: OutboxRestoreRequeueBackupFile,
  trace: string,
  extra: Record<string, unknown>,
) {
  const result = {
    schema_version: 1 as const,
    trace_id: trace,
    scope: file.document.scope,
    source_refs: [],
    data: { ...outboxRestoreRequeueBackupSummary(file), ...extra },
  };
  try {
    syncJsonSnapshot(result, 128 * 1024);
  } catch {
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_RESULT_TOO_LARGE',
      'The complete backup response exceeds 128 KiB; retain the known file state',
      trace,
      { result: result.data },
    );
  }
  return result;
}
/** Offline inspection never imports the Bridge root; only explicit export opens an existing queue. */
export async function runOutboxRestoreRequeueBackupArguments(
  argv: string[],
  trace: string,
  configuredScope?: { tenant_id: string; workspace_id: string; project_id: string },
) {
  const args = argumentsFor(argv, trace);
  if (args.command === 'outbox inspect-restore-requeue-backup') {
    const stored = await readOutboxRestoreRequeueBackupFile(args.file!, trace);
    return envelope(stored.saved, trace, {
      local: {
        state: 'read-and-verified',
        path: resolve(args.file!),
        file_bytes: stored.file_bytes,
        file_sha256: stored.file_sha256,
      },
    });
  }
  const scope = parseOutboxRestoreRequeueBackupQuery({ scope: configuredScope }, trace).scope;
  const input = await readQuery(args, trace);
  const query = parseOutboxRestoreRequeueBackupQuery(
    { ...input, scope: Object.hasOwn(input, 'scope') ? input.scope : scope },
    trace,
  );
  if (
    query.scope.tenant_id !== scope.tenant_id ||
    query.scope.workspace_id !== scope.workspace_id ||
    query.scope.project_id !== scope.project_id
  )
    throw fail(
      'OUTBOX_READ_SCOPE_MISMATCH',
      'The backup query belongs to another configured project',
      trace,
      { query },
    );
  const path = resolve(args.outbox!);
  let output: ArtifactOutput;
  try {
    output = await prepareArtifactOutput(args.output!, trace);
  } catch (error) {
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'OUTBOX_REQUEUE_BACKUP_OUTPUT_UNAVAILABLE',
      'Choose a new backup file in an existing directory',
      trace,
      {
        local_state: 'not-saved',
        local_commit: 'not-attempted',
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: path,
        output_path: resolve(args.output!),
      },
    );
  }
  let queue: InstanceType<typeof import('@planemem/context-bridge').SqliteOutbox>;
  try {
    const bridge = await import('@planemem/context-bridge');
    queue = new bridge.SqliteOutbox(path, { readonly: true });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      'The existing outbox could not be opened for history backup',
      trace,
      {
        local_state: 'not-saved',
        local_commit: 'not-attempted',
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: path,
        output_path: output.path,
        stage: 'open',
      },
    );
  }
  let file: OutboxRestoreRequeueBackupFile;
  try {
    file = queue.readRestoreRequeueBackup(query, trace);
  } catch (error) {
    let close_pending = false;
    try {
      queue.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_BACKUP_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete requeue history could not be backed up',
      trace,
      {
        local_state: 'not-saved',
        local_commit: 'not-attempted',
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: path,
        output_path: output.path,
        close_pending,
      },
    );
  }
  let close_pending = false;
  try {
    queue.close();
  } catch {
    close_pending = true;
  }
  // Finish the read transaction and attempt database close before creating any output file.
  let local: Awaited<ReturnType<typeof saveBackup>>;
  try {
    local = await saveBackup(file, output, trace);
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_BACKUP_SAVE_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete history backup could not be saved',
      trace,
      {
        local_state: 'not-saved',
        local_commit: 'not-attempted',
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: path,
        output_path: output.path,
        close_pending,
        backup: outboxRestoreRequeueBackupSummary(file),
      },
    );
  }
  return envelope(file, trace, { query, outbox: path, local, close_pending });
}
