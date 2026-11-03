import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import {
  parseOutboxRestoreRequeueImportQuery,
  verifyOutboxRestoreRequeueFile,
  outboxRestoreRequeueFileSummary,
  type OutboxRestoreRequeueFile,
} from '@planemem/context-bridge/outbox-restore-requeue-file';
import { readBoundedArtifactFile } from './artifact-files.js';
import { readOutboxRestoreRequeueInputFile } from './outbox-restore-requeue-file.js';

export function isOutboxRestoreRequeueImportCommand(command: string) {
  return (
    command === 'outbox restore-requeue-import' ||
    command === 'outbox restore-requeue-import-preview'
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
        'receipt-file': { type: 'string' },
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
    const { outbox, json } = args.values;
    const file = args.values['receipt-file'];
    const queryFile = args.values['json-file'];
    if (
      !isOutboxRestoreRequeueImportCommand(command) ||
      args.positionals.length !== 2 ||
      outbox === undefined ||
      file === undefined ||
      outbox === ':memory:' ||
      [outbox, file, queryFile].some(
        (value) => value !== undefined && (!value.trim() || value === '-'),
      ) ||
      json === '-' ||
      (json === undefined) === (queryFile === undefined)
    )
      throw new TypeError();
    return { command, outbox: resolve(outbox), file: resolve(file), json, queryFile };
  } catch {
    throw fail(
      'USAGE_ERROR',
      'Use outbox restore-requeue-import/restore-requeue-import-preview --outbox EXISTING_FILE --receipt-file FILE --json/--json-file scope/document_sha256/requeue_id QUERY. No output, extra/repeated options or stdin',
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
    if (raw === undefined || Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    return input as Record<string, unknown>;
  } catch (error) {
    throw fail(
      'OUTBOX_REQUEUE_IMPORT_QUERY_INVALID',
      'Read a stable regular UTF-8 import query within 16 KiB',
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
/** Explicit original history import only; native read-only preview, no network or event scheduling. */
export async function runOutboxRestoreRequeueImportArguments(
  argv: string[],
  trace: string,
  configuredScope: { tenant_id: string; workspace_id: string; project_id: string },
) {
  const args = argumentsFor(argv, trace);
  const preview = args.command === 'outbox restore-requeue-import-preview';
  const scope = { ...configuredScope };
  const input = await readQuery(args, trace);
  const query = parseOutboxRestoreRequeueImportQuery(
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
      'The import query belongs to another configured project',
      trace,
      { query },
    );
  let file: OutboxRestoreRequeueFile;
  let receipt_file: {
    state: 'read-and-verified';
    path: string;
    file_bytes: number;
    file_sha256: string;
  };
  try {
    const { input: raw, ...metadata } = await readOutboxRestoreRequeueInputFile(args.file, trace);
    file = verifyOutboxRestoreRequeueFile(raw, trace);
    if (
      file.document_sha256 !== query.document_sha256 ||
      file.document.receipt.query.requeue_id !== query.requeue_id ||
      file.document.scope.tenant_id !== scope.tenant_id ||
      file.document.scope.workspace_id !== scope.workspace_id ||
      file.document.scope.project_id !== scope.project_id
    )
      throw fail(
        'OUTBOX_REQUEUE_IMPORT_SOURCE_MISMATCH',
        'The complete receipt file differs from the original import query',
        trace,
      );
    receipt_file = { state: 'read-and-verified', path: args.file, ...metadata };
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_IMPORT_FILE_INVALID',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete source history could not be verified',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        receipt_file: args.file,
        outbox: args.outbox,
        local_commit: preview ? 'not-attempted' : 'not-committed',
        stage: 'source',
      },
    );
  }
  const source_history = outboxRestoreRequeueFileSummary(file);
  let queue: InstanceType<typeof import('@planemem/context-bridge').SqliteOutbox>;
  try {
    const bridge = await import('@planemem/context-bridge');
    queue = new bridge.SqliteOutbox(args.outbox, preview ? { readonly: true } : { existing: true });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      'The existing queue could not be opened for the selected history import',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        receipt_file,
        source_history,
        outbox: args.outbox,
        local_commit: preview ? 'not-attempted' : 'not-committed',
        stage: 'open',
      },
    );
  }
  let data;
  try {
    data = preview
      ? queue.previewRestoreRequeueFileImport(file, query, trace)
      : queue.importRestoreRequeueFile(file, query, trace);
  } catch (error) {
    let close_pending = false;
    try {
      queue.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_IMPORT_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete local history import outcome is unavailable',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        receipt_file,
        source_history,
        outbox: args.outbox,
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
    scope: query.scope,
    source_refs: [{ type: 'outbox', id: query.scope.project_id }],
    data: { ...data, receipt_file, outbox: args.outbox, close_pending },
  };
  try {
    syncJsonSnapshot(result, 128 * 1024);
  } catch {
    throw fail(
      'OUTBOX_REQUEUE_IMPORT_RESULT_TOO_LARGE',
      'The response exceeds 128 KiB; retain the known import result',
      trace,
      {
        query,
        receipt_file,
        outbox: args.outbox,
        local_commit: data.local_commit,
        result: data,
        close_pending,
      },
    );
  }
  return result;
}
