import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError } from '@planemem/contracts';
import type { OutboxArchiveFile } from '@planemem/context-bridge/outbox-archive';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput } from './artifact-output.js';
import { saveOutboxArchiveFile } from './outbox-archive.js';

export function isOutboxRestoreHistoryCommand(command: string) {
  return ['outbox restore-history', 'outbox restore-get', 'outbox restore-export'].includes(
    command,
  );
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
        outbox: { type: 'string' },
        output: { type: 'string' },
        json: { type: 'string' },
        'json-file': { type: 'string' },
      },
    });
    const command = args.positionals.slice(0, 2).join(' ');
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const { outbox, output, json } = args.values;
    const file = args.values['json-file'];
    const list = command === 'outbox restore-history';
    if (
      !isOutboxRestoreHistoryCommand(command) ||
      args.positionals.length !== (list ? 2 : 3) ||
      outbox === undefined ||
      outbox === ':memory:' ||
      [outbox, output, file].some((path) => path !== undefined && (!path.trim() || path === '-')) ||
      json === '-' ||
      (json !== undefined && file !== undefined) ||
      (!list && (json !== undefined || file !== undefined)) ||
      (command === 'outbox restore-export' ? output === undefined : output !== undefined)
    )
      throw new TypeError();
    return { command, path: resolve(outbox), output, json, file, restore_id: args.positionals[2] };
  } catch {
    throw fail(
      'USAGE_ERROR',
      'Use outbox restore-history --outbox EXISTING_FILE [--json/--json-file QUERY], outbox restore-get RESTORE_ID --outbox EXISTING_FILE, or outbox restore-export RESTORE_ID --outbox EXISTING_FILE --output NEW_FILE. No other/repeated options, stdin or extra positionals',
      trace,
    );
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
        'OUTBOX_RESTORE_HISTORY_QUERY_UNAVAILABLE',
        'Read a stable regular UTF-8 history query within 16 KiB',
        trace,
        {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query_file: resolve(args.file),
        },
      );
    }
  }
  try {
    if (raw === undefined) return {};
    if (Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    return value as Record<string, unknown>;
  } catch {
    throw fail(
      'OUTBOX_RESTORE_HISTORY_QUERY_INVALID',
      'Supply a history query object within 16 KiB',
      trace,
    );
  }
}
/** Reads only an existing queue; an explicit export writes a new archive after the read ends. */
export async function runOutboxRestoreHistoryArguments(
  argv: string[],
  configuredScope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
) {
  const args = argumentsFor(argv, trace);
  const snapshot = { ...configuredScope };
  const input = await readInput(args, trace);
  let bridge: typeof import('@planemem/context-bridge');
  try {
    bridge = await import('@planemem/context-bridge');
  } catch {
    throw fail(
      'OUTBOX_STORAGE_UNAVAILABLE',
      'The local restore history reader is unavailable',
      trace,
      { outbox: args.path, stage: 'open' },
    );
  }
  const scope = bridge.parseOutboxReadScope(snapshot, trace);
  const query =
    args.command === 'outbox restore-history'
      ? bridge.parseOutboxRestoreHistoryQuery(
          { ...input, scope: Object.hasOwn(input, 'scope') ? input.scope : scope },
          trace,
        )
      : bridge.parseOutboxRestoreSelection({ scope, restore_id: args.restore_id }, trace);
  if (
    query.scope.tenant_id !== scope.tenant_id ||
    query.scope.workspace_id !== scope.workspace_id ||
    query.scope.project_id !== scope.project_id
  )
    throw fail(
      'OUTBOX_READ_SCOPE_MISMATCH',
      'The history query belongs to another configured project',
      trace,
      { query },
    );
  let output: Awaited<ReturnType<typeof prepareArtifactOutput>> | undefined;
  try {
    if (args.output !== undefined) output = await prepareArtifactOutput(args.output, trace);
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_ARCHIVE_OUTPUT_UNAVAILABLE',
      'Choose a new archive file in an existing directory',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: args.path,
        output_path: resolve(args.output!),
      },
    );
  }
  let queue: InstanceType<typeof bridge.SqliteOutbox>;
  try {
    queue = new bridge.SqliteOutbox(args.path, { readonly: true });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      'The existing outbox could not be opened for history reading',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: args.path,
        output_path: output?.path ?? null,
        stage: 'open',
      },
    );
  }
  let data:
    | ReturnType<typeof queue.listRestoreReceipts>
    | ReturnType<typeof queue.readRestoreRecord>
    | Omit<ReturnType<typeof queue.readRestoreArchive>, 'source'>;
  let source: OutboxArchiveFile | undefined;
  try {
    if (args.command === 'outbox restore-history') data = queue.listRestoreReceipts(query, trace);
    else if (args.command === 'outbox restore-get') data = queue.readRestoreRecord(query, trace);
    else {
      const archived = queue.readRestoreArchive(query, trace);
      source = archived.source;
      const { source: _source, ...metadata } = archived;
      data = metadata;
    }
  } catch (error) {
    let close_pending = false;
    try {
      queue.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_HISTORY_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The selected restore history could not be read',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: args.path,
        output_path: output?.path ?? null,
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
  let local: Awaited<ReturnType<typeof saveOutboxArchiveFile>> | null = null;
  if (source && output) {
    try {
      local = await saveOutboxArchiveFile(source, output, trace);
    } catch (error) {
      throw fail(
        error instanceof ContractError ? error.envelope.code : 'OUTBOX_ARCHIVE_SAVE_FAILED',
        error instanceof ContractError
          ? error.envelope.message
          : 'The original archived history could not be saved',
        trace,
        {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          history: data,
          query,
          outbox: args.path,
          output_path: output.path,
          close_pending,
          document_sha256: source.document_sha256,
          records: source.document.records.length,
        },
      );
    }
  }
  return {
    schema_version: 1 as const,
    trace_id: trace,
    scope,
    source_refs: [{ type: 'outbox', id: scope.project_id }],
    data: { ...data, outbox: args.path, local, close_pending },
  };
}
