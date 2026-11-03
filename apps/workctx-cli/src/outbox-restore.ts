import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError } from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import { readOutboxArchiveFile } from './outbox-archive.js';
import { readOutboxRestoreBackupFile } from './outbox-restore-backup.js';

export function isOutboxRestoreCommand(command: string) {
  return (
    command === 'outbox restore' ||
    command === 'outbox restore-receipt' ||
    command === 'outbox restore-preview' ||
    command === 'outbox restore-history-import' ||
    command === 'outbox restore-history-import-preview'
  );
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function usage(trace: string) {
  return fail(
    'USAGE_ERROR',
    'Use outbox restore, restore-preview, restore-history-import or restore-history-import-preview --outbox EXISTING_FILE --archive-file FILE --json/--json-file ORIGINAL_QUERY, or outbox restore-receipt --outbox EXISTING_FILE --json/--json-file ORIGINAL_QUERY. No other/repeated options, extra positionals or stdin',
    trace,
  );
}
function argumentsFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        outbox: { type: 'string' },
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
    const path = args.values.outbox;
    const json = args.values.json;
    const file = args.values['json-file'];
    const archiveFile = args.values['archive-file'];
    if (
      !isOutboxRestoreCommand(command) ||
      args.positionals.length !== 2 ||
      path === undefined ||
      path === ':memory:' ||
      [path, file, archiveFile].some(
        (value) => value !== undefined && (!value.trim() || value === '-'),
      ) ||
      (json === undefined) === (file === undefined) ||
      json === '-' ||
      (command === 'outbox restore-receipt' ? archiveFile !== undefined : archiveFile === undefined)
    )
      throw new TypeError();
    return { command, path: resolve(path), json, file, archiveFile };
  } catch {
    throw usage(trace);
  }
}
async function readInput(
  args: ReturnType<typeof argumentsFor>,
  trace: string,
): Promise<Record<string, unknown>> {
  let raw = args.json;
  if (args.file !== undefined) {
    try {
      raw = new TextDecoder('utf-8', { fatal: true })
        .decode(await readBoundedArtifactFile(args.file, 16384, trace))
        .replace(/^\uFEFF/, '');
    } catch (error) {
      throw fail(
        'OUTBOX_RESTORE_QUERY_UNAVAILABLE',
        'Read a stable regular UTF-8 original restore query within 16 KiB',
        trace,
        {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query_file: resolve(args.file),
        },
      );
    }
  }
  try {
    if (raw === undefined || Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    return value as Record<string, unknown>;
  } catch {
    throw usage(trace);
  }
}

/** Explicit restore/import writes; all previews and receipt lookups open existing storage read-only. */
export async function runOutboxRestoreArguments(
  argv: string[],
  configuredScope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
) {
  const args = argumentsFor(argv, trace);
  const historyImport =
    args.command === 'outbox restore-history-import' ||
    args.command === 'outbox restore-history-import-preview';
  const writes =
    args.command === 'outbox restore' || args.command === 'outbox restore-history-import';
  const unopenedCommit = writes ? 'not-committed' : 'not-attempted';
  const snapshot = { ...configuredScope };
  const input = await readInput(args, trace);
  let bridge: typeof import('@planemem/context-bridge');
  try {
    bridge = await import('@planemem/context-bridge');
  } catch {
    throw fail(
      'OUTBOX_STORAGE_UNAVAILABLE',
      'The local restore implementation is unavailable',
      trace,
      { outbox: args.path, stage: 'open', local_commit: unopenedCommit },
    );
  }
  const scope = bridge.parseOutboxReadScope(snapshot, trace);
  const scopedInput = { ...input, scope: Object.hasOwn(input, 'scope') ? input.scope : scope };
  const query = historyImport
    ? bridge.parseOutboxRestoreBackupImportQuery(scopedInput, trace)
    : bridge.parseOutboxRestoreQuery(scopedInput, trace);
  if (
    query.scope.tenant_id !== scope.tenant_id ||
    query.scope.workspace_id !== scope.workspace_id ||
    query.scope.project_id !== scope.project_id
  )
    throw fail(
      'OUTBOX_READ_SCOPE_MISMATCH',
      'The original restore query belongs to another configured project',
      trace,
      { query, local_commit: unopenedCommit },
    );
  let source:
    | Awaited<ReturnType<typeof readOutboxArchiveFile>>
    | Awaited<ReturnType<typeof readOutboxRestoreBackupFile>>
    | undefined;
  if (args.archiveFile !== undefined) {
    try {
      source = historyImport
        ? await readOutboxRestoreBackupFile(args.archiveFile, trace)
        : await readOutboxArchiveFile(args.archiveFile, trace);
      if (
        source.saved.document_sha256 !==
          ('backup_sha256' in query ? query.backup_sha256 : query.archive_sha256) ||
        source.saved.document.scope.tenant_id !== scope.tenant_id ||
        source.saved.document.scope.workspace_id !== scope.workspace_id ||
        source.saved.document.scope.project_id !== scope.project_id
      )
        throw fail(
          'OUTBOX_RESTORE_ARCHIVE_MISMATCH',
          'The archive does not match the original restore query',
          trace,
        );
    } catch (error) {
      throw fail(
        error instanceof ContractError ? error.envelope.code : 'OUTBOX_ARCHIVE_INVALID',
        error instanceof ContractError
          ? error.envelope.message
          : 'The complete original archive could not be read',
        trace,
        {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          archive_file: resolve(args.archiveFile),
          outbox: args.path,
          local_commit: unopenedCommit,
        },
      );
    }
  }
  const file =
    source && args.archiveFile !== undefined
      ? {
          path: resolve(args.archiveFile),
          file_bytes: source.file_bytes,
          file_sha256: source.file_sha256,
        }
      : null;
  let queue: InstanceType<typeof bridge.SqliteOutbox>;
  try {
    queue = new bridge.SqliteOutbox(args.path, writes ? { existing: true } : { readonly: true });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      'The existing destination queue could not be opened',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: args.path,
        archive_file: file,
        stage: 'open',
        local_commit: unopenedCommit,
      },
    );
  }
  let data;
  try {
    data =
      args.command === 'outbox restore-history-import'
        ? queue.importRestoreBackup(source!.saved, query, trace)
        : args.command === 'outbox restore-history-import-preview'
          ? queue.previewRestoreBackupImport(source!.saved, query, trace)
          : args.command === 'outbox restore'
            ? queue.restoreArchive(source!.saved, query, trace)
            : args.command === 'outbox restore-preview'
              ? queue.previewArchiveRestore(source!.saved, query, trace)
              : queue.readRestoreReceipt(query, trace);
  } catch (error) {
    let close_pending = false;
    try {
      queue.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : writes
          ? 'The local write outcome could not be confirmed; preserve the original query and archive'
          : 'The local history or preview could not be read; no write was attempted',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: args.path,
        archive_file: file,
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
  return {
    schema_version: 1 as const,
    trace_id: trace,
    scope,
    source_refs: [{ type: 'outbox', id: scope.project_id }],
    data: { ...data, query, outbox: args.path, archive_file: file, close_pending },
  };
}
