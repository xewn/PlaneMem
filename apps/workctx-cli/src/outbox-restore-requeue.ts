import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';

export function isOutboxRestoreRequeueCommand(command: string) {
  return (
    command === 'outbox restore-requeue' ||
    command === 'outbox restore-requeue-preview' ||
    command === 'outbox restore-requeue-receipt'
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
    if (
      !isOutboxRestoreRequeueCommand(command) ||
      args.positionals.length !== 2 ||
      path === undefined ||
      path === ':memory:' ||
      [path, file].some((value) => value !== undefined && (!value.trim() || value === '-')) ||
      (json === undefined) === (file === undefined) ||
      json === '-'
    )
      throw new TypeError();
    return { command, path: resolve(path), json, file };
  } catch {
    throw fail(
      'USAGE_ERROR',
      'Use outbox restore-requeue, restore-requeue-preview or restore-requeue-receipt --outbox EXISTING_FILE --json/--json-file QUERY. Receipt lookup requires the complete original query with requeue_id. No extra/repeated options, positionals or stdin',
      trace,
    );
  }
}
async function inputFor(args: ReturnType<typeof argumentsFor>, trace: string) {
  try {
    let raw = args.json;
    if (args.file !== undefined)
      raw = new TextDecoder('utf-8', { fatal: true })
        .decode(await readBoundedArtifactFile(args.file, 16384, trace))
        .replace(/^\uFEFF/, '');
    if (raw === undefined || Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    return value as Record<string, unknown>;
  } catch (error) {
    throw fail(
      'OUTBOX_RESTORE_REQUEUE_QUERY_INVALID',
      'Read a stable regular UTF-8 requeue query within 16 KiB',
      trace,
      {
        ...(error instanceof ContractError
          ? { ...error.envelope.details, cause_code: error.envelope.code }
          : {}),
        query_file: args.file === undefined ? null : resolve(args.file),
      },
    );
  }
}
/** Explicit selected local scheduling only; no gateway or automatic resume/flush. */
export async function runOutboxRestoreRequeueArguments(
  argv: string[],
  configuredScope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
) {
  const args = argumentsFor(argv, trace);
  const preview = args.command === 'outbox restore-requeue-preview';
  const receipt = args.command === 'outbox restore-requeue-receipt';
  const reading = preview || receipt;
  const unopenedCommit = reading ? 'not-attempted' : 'not-committed';
  const scopeSnapshot = { ...configuredScope };
  const input = await inputFor(args, trace);
  let bridge: typeof import('@planemem/context-bridge');
  try {
    bridge = await import('@planemem/context-bridge');
  } catch {
    throw fail(
      'OUTBOX_STORAGE_UNAVAILABLE',
      'The local restore requeue implementation is unavailable',
      trace,
      { outbox: args.path, stage: 'open', local_commit: unopenedCommit },
    );
  }
  const scope = bridge.parseOutboxReadScope(scopeSnapshot, trace);
  const parseQuery = receipt
    ? bridge.parseOutboxRestoreRequeueReceiptQuery
    : bridge.parseOutboxRestoreRequeueQuery;
  const query = parseQuery(
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
      'The requeue query belongs to another configured project',
      trace,
      { query, local_commit: unopenedCommit },
    );
  let queue: InstanceType<typeof bridge.SqliteOutbox>;
  try {
    queue = new bridge.SqliteOutbox(args.path, reading ? { readonly: true } : { existing: true });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      'The existing queue could not be opened for restore requeue',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: args.path,
        stage: 'open',
        local_commit: unopenedCommit,
      },
    );
  }
  let data;
  try {
    data = receipt
      ? queue.readRestoreRequeueReceipt(query, trace)
      : preview
        ? queue.previewRestoreRequeue(query, trace)
        : queue.requeueRestoredRecords(query, trace);
  } catch (error) {
    let close_pending = false;
    try {
      queue.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_RESTORE_REQUEUE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete requeue outcome could not be confirmed; retain the original query',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
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
  const result = {
    schema_version: 1 as const,
    trace_id: trace,
    scope,
    source_refs: [{ type: 'outbox', id: scope.project_id }],
    data: { ...data, outbox: args.path, close_pending },
  };
  try {
    syncJsonSnapshot(result, 128 * 1024);
  } catch {
    throw fail(
      'OUTBOX_RESTORE_REQUEUE_RESULT_TOO_LARGE',
      'The complete requeue output exceeds 128 KiB; retain the known local outcome',
      trace,
      {
        query,
        outbox: args.path,
        close_pending,
        local_commit: data.local_commit,
        result: data,
      },
    );
  }
  return result;
}
