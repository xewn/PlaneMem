import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError, isSyncIdentifier } from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';

export function isOutboxReadCommand(command: string) {
  return command === 'outbox list' || command === 'outbox get';
}
function usage(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use outbox list with optional --json/--json-file (scope/status/limit/after_event_id), or outbox get EVENT_ID; both accept --outbox EXISTING_FILE. No other or repeated options, keys or stdin',
    { trace_id: trace, retryable: false },
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
        json: { type: 'string' },
        'json-file': { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const command = args.positionals.slice(0, 2).join(' ');
    const id = args.positionals[2];
    const path =
      args.values.outbox ??
      process.env.WORKCTX_OUTBOX ??
      join(homedir(), '.workctx', 'outbox.sqlite');
    const json = args.values.json;
    const file = args.values['json-file'];
    if (
      !isOutboxReadCommand(command) ||
      !path.trim() ||
      path === '-' ||
      path === ':memory:' ||
      (json !== undefined && file !== undefined) ||
      json === '-' ||
      (file !== undefined && (!file.trim() || file === '-')) ||
      (command === 'outbox list'
        ? args.positionals.length !== 2
        : args.positionals.length !== 3 ||
          !isSyncIdentifier(id) ||
          json !== undefined ||
          file !== undefined)
    )
      throw new TypeError();
    return { command, event_id: id, path: resolve(path), json, file };
  } catch {
    throw usage(trace);
  }
}
async function readQuery(args: ReturnType<typeof argumentsFor>, trace: string) {
  let raw = args.json;
  if (args.file !== undefined) {
    try {
      const bytes = await readBoundedArtifactFile(args.file, 16384, trace);
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      throw new ContractError(
        'OUTBOX_LIST_FILE_UNAVAILABLE',
        'Read a stable regular UTF-8 list query file within 16 KiB',
        { trace_id: trace, retryable: false },
      );
    }
  }
  try {
    if (raw === undefined) return {} as Record<string, unknown>;
    if (Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    return input as Record<string, unknown>;
  } catch {
    throw usage(trace);
  }
}

/** Local read only; current scope is supplied by environment or the embedded caller. */
export async function runOutboxReadArguments(
  argv: string[],
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
) {
  const args = argumentsFor(argv, trace);
  const scopeSnapshot = { ...scope };
  const input = await readQuery(args, trace);
  const bridge = await import('@planemem/context-bridge');
  const originalScope = bridge.parseOutboxReadScope(scopeSnapshot, trace);
  const query = bridge.parseOutboxListQuery(
    { ...input, scope: Object.hasOwn(input, 'scope') ? input.scope : originalScope },
    trace,
  );
  if (
    query.scope.tenant_id !== originalScope.tenant_id ||
    query.scope.workspace_id !== originalScope.workspace_id ||
    query.scope.project_id !== originalScope.project_id
  )
    throw new ContractError(
      'OUTBOX_READ_SCOPE_MISMATCH',
      'The saved list query belongs to a different configured project',
      { trace_id: trace, retryable: false },
    );
  let queue: InstanceType<typeof bridge.SqliteOutbox>;
  try {
    queue = new bridge.SqliteOutbox(args.path, { readonly: true });
  } catch (error) {
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The existing queue could not be opened for reading',
      { trace_id: trace, retryable: false },
    );
  }
  let data;
  try {
    data =
      args.command === 'outbox list'
        ? queue.listRecords(query, trace)
        : queue.readRecord(originalScope, args.event_id!, trace);
  } catch (error) {
    let close_pending = false;
    try {
      queue.close();
    } catch {
      close_pending = true;
    }
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The selected queue records could not be read completely',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          ...(close_pending ? { close_pending: true } : {}),
        },
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
    scope: originalScope,
    source_refs: [{ type: 'outbox', id: originalScope.project_id }],
    data: { ...data, outbox: args.path, ...(close_pending ? { close_pending: true } : {}) },
  };
}
