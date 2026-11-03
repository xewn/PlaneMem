import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import {
  parseOutboxRestoreRequeueBackupHistoryQuery,
  parseOutboxRestoreRequeueBackupSelection,
  listOutboxRestoreRequeueBackupHistory,
  readOutboxRestoreRequeueBackupEntry,
} from '@planemem/context-bridge/outbox-restore-requeue-backup';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput, type ArtifactOutput } from './artifact-output.js';
import { readOutboxRestoreRequeueBackupInputFile } from './outbox-restore-requeue-backup.js';
import { saveOutboxRestoreRequeueFile } from './outbox-restore-requeue-file.js';
import { saveOutboxRestoreRequeueRequest } from './outbox-restore-request.js';

export function isOutboxRestoreRequeueBackupAccessCommand(command: string) {
  return [
    'outbox restore-requeue-backup-history',
    'outbox restore-requeue-backup-get',
    'outbox restore-requeue-backup-export',
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
      !isOutboxRestoreRequeueBackupAccessCommand(command) ||
      args.positionals.length !== 2 ||
      file === undefined ||
      [file, queryFile, output].some(
        (value) => value !== undefined && (!value.trim() || value === '-'),
      ) ||
      json === '-' ||
      (json !== undefined && queryFile !== undefined) ||
      (command !== 'outbox restore-requeue-backup-history' &&
        json === undefined &&
        queryFile === undefined) ||
      (command === 'outbox restore-requeue-backup-history' && output !== undefined) ||
      (command === 'outbox restore-requeue-backup-export' && output === undefined)
    )
      throw new TypeError();
    return { command, file: resolve(file), queryFile, json, output };
  } catch {
    throw fail(
      'USAGE_ERROR',
      'Use outbox restore-requeue-backup-history --archive-file BACKUP [--json/--json-file PAGE_QUERY]; restore-requeue-backup-get with backup_sha256/requeue_id JSON and optional --output NEW_QUERY; or restore-requeue-backup-export with the same selection and required --output NEW_RECEIPT. No extra/repeated options or stdin',
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
      'OUTBOX_REQUEUE_BACKUP_ACCESS_QUERY_INVALID',
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
/** File-only route: no project configuration, token, database opening or Bridge root import. */
export async function runOutboxRestoreRequeueBackupAccessArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const input = await readQuery(args, trace);
  const query =
    args.command === 'outbox restore-requeue-backup-history'
      ? parseOutboxRestoreRequeueBackupHistoryQuery(input, trace)
      : parseOutboxRestoreRequeueBackupSelection(input, trace);
  let output: ArtifactOutput | undefined;
  try {
    if (args.output !== undefined) output = await prepareArtifactOutput(args.output, trace);
  } catch (error) {
    throw fail(
      error instanceof ContractError
        ? error.envelope.code
        : 'OUTBOX_REQUEUE_BACKUP_OUTPUT_UNAVAILABLE',
      'Choose a new output file in an existing directory',
      trace,
      {
        local_state: 'not-saved',
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        archive_file: args.file,
        output_path: resolve(args.output!),
      },
    );
  }
  let stored: Awaited<ReturnType<typeof readOutboxRestoreRequeueBackupInputFile>>;
  let data:
    | ReturnType<typeof listOutboxRestoreRequeueBackupHistory>
    | Omit<ReturnType<typeof readOutboxRestoreRequeueBackupEntry>, 'receipt_file'>;
  let receiptFile: ReturnType<typeof readOutboxRestoreRequeueBackupEntry>['receipt_file'] = null;
  try {
    stored = await readOutboxRestoreRequeueBackupInputFile(args.file, trace);
    if (args.command === 'outbox restore-requeue-backup-history') {
      data = listOutboxRestoreRequeueBackupHistory(stored.input, query, trace);
    } else {
      const { receipt_file, ...metadata } = readOutboxRestoreRequeueBackupEntry(
        stored.input,
        query,
        trace,
      );
      receiptFile = receipt_file;
      data = metadata;
    }
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_BACKUP_ACCESS_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete backup selection could not be read',
      trace,
      {
        local_state: 'not-saved',
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
  let local:
    | Awaited<ReturnType<typeof saveOutboxRestoreRequeueFile>>
    | Awaited<ReturnType<typeof saveOutboxRestoreRequeueRequest>>
    | null = null;
  if (output) {
    if (receiptFile === null)
      throw fail(
        'OUTBOX_REQUEUE_BACKUP_ENTRY_NOT_FOUND',
        'The verified backup does not contain the selected batch; no output file was created',
        trace,
        { local_state: 'not-saved', query, backup_file, history: data, output_path: output.path },
      );
    try {
      local =
        args.command === 'outbox restore-requeue-backup-export'
          ? await saveOutboxRestoreRequeueFile(receiptFile, output, trace)
          : await saveOutboxRestoreRequeueRequest(
              receiptFile.document.receipt.query,
              output,
              trace,
            );
    } catch (error) {
      throw fail(
        error instanceof ContractError
          ? error.envelope.code
          : 'OUTBOX_REQUEUE_BACKUP_EXPORT_FAILED',
        error instanceof ContractError
          ? error.envelope.message
          : 'The selected history output could not be saved',
        trace,
        {
          local_state: 'not-saved',
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          backup_file,
          history: data,
          output_path: output.path,
        },
      );
    }
  }
  const result = {
    schema_version: 1 as const,
    trace_id: trace,
    scope: data.scope,
    source_refs: [],
    data: { ...data, backup_file, local },
  };
  try {
    syncJsonSnapshot(result, 128 * 1024);
  } catch {
    throw fail(
      'OUTBOX_REQUEUE_BACKUP_ACCESS_RESULT_TOO_LARGE',
      'The complete response exceeds 128 KiB; retain the known file state',
      trace,
      { result: result.data },
    );
  }
  return result;
}
