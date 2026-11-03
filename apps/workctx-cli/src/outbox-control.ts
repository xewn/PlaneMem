import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError } from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';

export function isOutboxControlCommand(command: string) {
  return (
    command === 'outbox send-control' || command === 'outbox pause' || command === 'outbox resume'
  );
}
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function usage(trace: string) {
  return fail(
    'USAGE_ERROR',
    'Use outbox send-control, or outbox pause/resume with --json/--json-file containing expected_generation, reason and optional scope. Optional --outbox EXISTING_FILE; no other/repeated options, extra positionals or stdin',
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
    const path =
      args.values.outbox ??
      process.env.WORKCTX_OUTBOX ??
      join(homedir(), '.workctx', 'outbox.sqlite');
    const json = args.values.json;
    const file = args.values['json-file'];
    if (
      !isOutboxControlCommand(command) ||
      args.positionals.length !== 2 ||
      !path.trim() ||
      path === '-' ||
      path === ':memory:' ||
      (json !== undefined && file !== undefined) ||
      json === '-' ||
      (file !== undefined && (!file.trim() || file === '-')) ||
      (command === 'outbox send-control'
        ? json !== undefined || file !== undefined
        : json === undefined && file === undefined)
    )
      throw new TypeError();
    return { command, path: resolve(path), json, file };
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
    } catch {
      throw fail(
        'OUTBOX_SEND_CONTROL_FILE_UNAVAILABLE',
        'Read a stable regular UTF-8 send-control request within 16 KiB',
        trace,
      );
    }
  }
  try {
    if (raw === undefined) return {};
    if (Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((name) => !['scope', 'expected_generation', 'reason'].includes(name))
    )
      throw new TypeError();
    return value as Record<string, unknown>;
  } catch {
    throw usage(trace);
  }
}

/** Project-local control only. No gateway request, sender cancellation or lease rewriting. */
export async function runOutboxControlArguments(
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
      'The local send-control implementation is unavailable',
      trace,
      { outbox: args.path, stage: 'open', local_commit: 'not-committed' },
    );
  }
  const scope = bridge.parseOutboxReadScope(snapshot, trace);
  const reading = args.command === 'outbox send-control';
  const query = reading
    ? null
    : bridge.parseOutboxSendControlChange(
        {
          ...input,
          scope: Object.hasOwn(input, 'scope') ? input.scope : scope,
          state: args.command === 'outbox pause' ? 'paused' : 'running',
        },
        trace,
      );
  if (
    query &&
    (query.scope.tenant_id !== scope.tenant_id ||
      query.scope.workspace_id !== scope.workspace_id ||
      query.scope.project_id !== scope.project_id)
  )
    throw fail(
      'OUTBOX_READ_SCOPE_MISMATCH',
      'The send-control request belongs to another configured project',
      trace,
      { query, local_commit: 'not-committed' },
    );
  let queue: InstanceType<typeof bridge.SqliteOutbox>;
  try {
    queue = new bridge.SqliteOutbox(args.path, reading ? { readonly: true } : { existing: true });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      'The existing queue could not be opened for send control',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        scope,
        query,
        outbox: args.path,
        stage: 'open',
        local_commit: 'not-committed',
      },
    );
  }
  let data;
  try {
    data = reading ? queue.readSendControl(scope, trace) : queue.changeSendControl(query, trace);
  } catch (error) {
    let close_pending = false;
    try {
      queue.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_SEND_CONTROL_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The send-control operation could not be confirmed; reread the current state',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        scope,
        query,
        outbox: args.path,
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
    data: { ...data, outbox: args.path, close_pending },
  };
}
