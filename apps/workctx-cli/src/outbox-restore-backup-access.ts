import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError } from '@planemem/contracts';
import type { OutboxArchiveFile } from '@planemem/context-bridge/outbox-archive';
import {
  parseOutboxRestoreBackupHistoryQuery,
  parseOutboxRestoreBackupSelection,
  listOutboxRestoreBackupHistory,
  readOutboxRestoreBackupEntry,
} from '@planemem/context-bridge/outbox-restore-backup';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput, type ArtifactOutput } from './artifact-output.js';
import { saveOutboxArchiveFile } from './outbox-archive.js';
import { readOutboxRestoreBackupInputFile } from './outbox-restore-backup.js';

export function isOutboxRestoreBackupAccessCommand(command: string) {
  return [
    'outbox restore-backup-history',
    'outbox restore-backup-get',
    'outbox restore-backup-export',
  ].includes(command);
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function argumentsFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        'archive-file': { type: 'string' },
        output: { type: 'string' },
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
    const file = args.values['archive-file'];
    const queryFile = args.values['json-file'];
    const { json, output } = args.values;
    if (
      !isOutboxRestoreBackupAccessCommand(command) ||
      args.positionals.length !== 2 ||
      file === undefined ||
      [file, queryFile, output].some(
        (value) => value !== undefined && (!value.trim() || value === '-'),
      ) ||
      json === '-' ||
      (json !== undefined && queryFile !== undefined) ||
      (command !== 'outbox restore-backup-history' &&
        json === undefined &&
        queryFile === undefined) ||
      (command === 'outbox restore-backup-export' ? output === undefined : output !== undefined)
    )
      throw new TypeError();
    return { command, file: resolve(file), queryFile, json, output };
  } catch {
    throw fail(
      'USAGE_ERROR',
      'Use outbox restore-backup-history --archive-file BACKUP [--json/--json-file PAGE_QUERY], or outbox restore-backup-get/restore-backup-export --archive-file BACKUP --json/--json-file SELECTION. Export also requires --output NEW_FILE. No outbox, extra/repeated options or stdin',
      trace,
    );
  }
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
      'OUTBOX_RESTORE_BACKUP_ACCESS_QUERY_INVALID',
      'Supply a stable UTF-8 JSON page or selection query within 16 KiB',
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
/** Entirely file-based: these commands never import the Bridge root or consult configured scope. */
export async function runOutboxRestoreBackupAccessArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const input = await readQuery(args, trace);
  const query =
    args.command === 'outbox restore-backup-history'
      ? parseOutboxRestoreBackupHistoryQuery(input, trace)
      : parseOutboxRestoreBackupSelection(input, trace);
  let output: ArtifactOutput | undefined;
  try {
    if (args.output !== undefined) output = await prepareArtifactOutput(args.output, trace);
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_ARCHIVE_OUTPUT_UNAVAILABLE',
      'Choose a new output archive in an existing directory',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        archive_file: args.file,
        output_path: resolve(args.output!),
      },
    );
  }
  let stored: Awaited<ReturnType<typeof readOutboxRestoreBackupInputFile>>;
  let data:
    | ReturnType<typeof listOutboxRestoreBackupHistory>
    | Omit<ReturnType<typeof readOutboxRestoreBackupEntry>, 'source'>;
  let source: OutboxArchiveFile | null = null;
  try {
    stored = await readOutboxRestoreBackupInputFile(args.file, trace);
    if (args.command === 'outbox restore-backup-history')
      data = listOutboxRestoreBackupHistory(stored.input, query, trace);
    else {
      const { source: original, ...metadata } = readOutboxRestoreBackupEntry(
        stored.input,
        query,
        trace,
      );
      source = original;
      data = metadata;
    }
  } catch (error) {
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'OUTBOX_RESTORE_BACKUP_ACCESS_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The selected backup history could not be read',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        archive_file: args.file,
        output_path: output?.path ?? null,
      },
    );
  }
  const backup_file = {
    state: 'read-and-verified' as const,
    path: args.file,
    file_bytes: stored.file_bytes,
    file_sha256: stored.file_sha256,
  };
  let local: Awaited<ReturnType<typeof saveOutboxArchiveFile>> | null = null;
  if (output) {
    if (source === null)
      throw fail(
        'OUTBOX_RESTORE_BACKUP_ENTRY_NOT_FOUND',
        'This verified backup does not contain the selected restore ID; no archive was created',
        trace,
        { query, backup_file, history: data, output_path: output.path },
      );
    try {
      local = await saveOutboxArchiveFile(source, output, trace);
    } catch (error) {
      throw fail(
        error instanceof ContractError
          ? error.envelope.code
          : 'OUTBOX_RESTORE_BACKUP_EXPORT_FAILED',
        error instanceof ContractError
          ? error.envelope.message
          : 'The selected original archive could not be saved',
        trace,
        {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          backup_file,
          history: data,
          output_path: output.path,
        },
      );
    }
  }
  return {
    schema_version: 1 as const,
    trace_id: trace,
    scope: data.scope,
    source_refs: [],
    data: { ...data, backup_file, local },
  };
}
