import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import {
  OUTBOX_REQUEUE_FILE_BYTES,
  verifyOutboxRestoreRequeueFile,
  outboxRestoreRequeueFileSummary,
  parseOutboxRestoreRequeueSelection,
  parseOutboxRestoreRequeueFileSelection,
  readOutboxRestoreRequeueFileEntry,
  type OutboxRestoreRequeueFile,
} from '@planemem/context-bridge/outbox-restore-requeue-file';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';
import { saveOutboxRestoreRequeueRequest } from './outbox-restore-request.js';

type Scope = { tenant_id: string; workspace_id: string; project_id: string };
export function isOutboxRestoreRequeueFileCommand(command: string) {
  return [
    'outbox restore-requeue-export',
    'outbox inspect-restore-requeue-receipt',
    'outbox restore-requeue-file-get',
  ].includes(command);
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
    const { outbox, output, json } = args.values;
    const file = args.values['receipt-file'];
    const queryFile = args.values['json-file'];
    if (
      !isOutboxRestoreRequeueFileCommand(command) ||
      args.positionals.length !== 2 ||
      [outbox, output, file, queryFile].some(
        (path) => path !== undefined && (!path.trim() || path === '-'),
      ) ||
      outbox === ':memory:' ||
      json === '-' ||
      (json !== undefined && queryFile !== undefined)
    )
      throw new TypeError();
    if (command === 'outbox restore-requeue-export') {
      if (
        outbox === undefined ||
        output === undefined ||
        file !== undefined ||
        (json === undefined && queryFile === undefined)
      )
        throw new TypeError();
    } else {
      if (file === undefined || outbox !== undefined) throw new TypeError();
      if (command === 'outbox inspect-restore-requeue-receipt') {
        if (output !== undefined || json !== undefined || queryFile !== undefined)
          throw new TypeError();
      } else if (json === undefined && queryFile === undefined) throw new TypeError();
    }
    return { command, outbox, output, file, json, queryFile };
  } catch {
    throw fail(
      'USAGE_ERROR',
      'Use outbox restore-requeue-export --outbox EXISTING_FILE --json/--json-file SELECTION --output NEW_FILE; inspect-restore-requeue-receipt --receipt-file FILE; or restore-requeue-file-get --receipt-file FILE --json/--json-file DIGEST_ID_SELECTION [--output NEW_QUERY_FILE]. No extra/repeated options or stdin',
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
      'OUTBOX_REQUEUE_FILE_QUERY_INVALID',
      'Supply a stable UTF-8 selection query within 16 KiB',
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
/** File decoding only; callers must verify the complete logical history before using it. */
export async function readOutboxRestoreRequeueInputFile(path: string, trace: string) {
  try {
    const bytes = await readBoundedArtifactFile(path, OUTBOX_REQUEUE_FILE_BYTES, trace);
    const input: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''),
    );
    return { input, file_bytes: bytes.byteLength, file_sha256: hash(bytes) };
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_FILE_INVALID',
      error instanceof ContractError
        ? error.envelope.message
        : 'Read a stable regular UTF-8 requeue receipt file within its complete size limit',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        receipt_file: resolve(path),
      },
    );
  }
}
export async function saveOutboxRestoreRequeueFile(
  input: OutboxRestoreRequeueFile,
  output: ArtifactOutput,
  trace: string,
) {
  const destination = { ...output };
  const file = verifyOutboxRestoreRequeueFile(input, trace);
  const bytes = new TextEncoder().encode(syncJsonSnapshot(file, OUTBOX_REQUEUE_FILE_BYTES));
  const file_sha256 = hash(bytes);
  const local = await saveArtifactOutput(destination, bytes, file_sha256, trace);
  try {
    const stored = await readBoundedArtifactFile(local.path, OUTBOX_REQUEUE_FILE_BYTES, trace);
    if (
      stored.byteLength !== bytes.byteLength ||
      hash(stored) !== file_sha256 ||
      stored.some((value, index) => value !== bytes[index])
    )
      throw new TypeError();
    const readback = verifyOutboxRestoreRequeueFile(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored)),
      trace,
    );
    if (readback.document_sha256 !== file.document_sha256) throw new TypeError();
  } catch (error) {
    throw fail(
      'OUTBOX_REQUEUE_FILE_READBACK_FAILED',
      'The receipt file was published but its final contents could not be confirmed; preserve the output',
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
    format: 'outbox-restore-requeue-receipt-json' as const,
    verification: 'exact-final-file-bytes-and-complete-history' as const,
  };
}
function envelope(scope: Scope, data: Record<string, unknown>, trace: string) {
  const result = { schema_version: 1 as const, trace_id: trace, scope, source_refs: [], data };
  try {
    syncJsonSnapshot(result, 128 * 1024);
  } catch {
    throw fail(
      'OUTBOX_REQUEUE_FILE_RESULT_TOO_LARGE',
      'The complete response exceeds 128 KiB; retain the known file state',
      trace,
      { result: data },
    );
  }
  return result;
}

/** Offline branches do not consult configuration or import the Bridge root/native SQLite. */
export async function runOutboxRestoreRequeueFileArguments(
  argv: string[],
  trace: string,
  configuredScope?: Scope,
) {
  const args = argumentsFor(argv, trace);
  if (args.command !== 'outbox restore-requeue-export') {
    const path = resolve(args.file!);
    const query =
      args.command === 'outbox restore-requeue-file-get'
        ? parseOutboxRestoreRequeueFileSelection(await readQuery(args, trace), trace)
        : null;
    let output: ArtifactOutput | undefined;
    try {
      if (args.output !== undefined) output = await prepareArtifactOutput(args.output, trace);
    } catch (error) {
      throw fail(
        error instanceof ContractError
          ? error.envelope.code
          : 'OUTBOX_REQUEUE_FILE_OUTPUT_UNAVAILABLE',
        'Choose a new original request file in an existing directory',
        trace,
        {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          receipt_file: path,
          output_path: resolve(args.output!),
          local_state: 'not-saved',
        },
      );
    }
    let data:
      | ReturnType<typeof outboxRestoreRequeueFileSummary>
      | ReturnType<typeof readOutboxRestoreRequeueFileEntry>;
    let original_query:
      | ReturnType<typeof readOutboxRestoreRequeueFileEntry>['original_query']
      | null = null;
    let receipt_file: {
      state: 'read-and-verified';
      path: string;
      file_bytes: number;
      file_sha256: string;
    };
    try {
      const { input, ...metadata } = await readOutboxRestoreRequeueInputFile(path, trace);
      if (query) {
        const selected = readOutboxRestoreRequeueFileEntry(input, query, trace);
        original_query = selected.original_query;
        data = selected;
      } else {
        data = outboxRestoreRequeueFileSummary(verifyOutboxRestoreRequeueFile(input, trace));
      }
      receipt_file = { state: 'read-and-verified', path, ...metadata };
    } catch (error) {
      throw fail(
        error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_FILE_ACCESS_FAILED',
        error instanceof ContractError
          ? error.envelope.message
          : 'The complete archived history could not be read',
        trace,
        {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          query,
          receipt_file: path,
          output_path: output?.path ?? null,
          local_state: 'not-saved',
        },
      );
    }
    let local: Awaited<ReturnType<typeof saveOutboxRestoreRequeueRequest>> | null = null;
    if (output) {
      try {
        if (original_query === null) throw new TypeError();
        local = await saveOutboxRestoreRequeueRequest(original_query, output, trace);
      } catch (error) {
        throw fail(
          error instanceof ContractError
            ? error.envelope.code
            : 'OUTBOX_REQUEUE_REQUEST_SAVE_FAILED',
          error instanceof ContractError
            ? error.envelope.message
            : 'The recovered original request could not be saved',
          trace,
          {
            local_state: 'not-saved',
            ...(error instanceof ContractError ? error.envelope.details : {}),
            query,
            receipt_file,
            history: data,
            output_path: output.path,
          },
        );
      }
    }
    return envelope(data.scope, { ...data, receipt_file, local }, trace);
  }
  const scope = configuredScope === undefined ? undefined : { ...configuredScope };
  const input = await readQuery(args, trace);
  const query = parseOutboxRestoreRequeueSelection(
    { ...input, scope: Object.hasOwn(input, 'scope') ? input.scope : scope },
    trace,
  );
  if (
    !scope ||
    query.scope.tenant_id !== scope.tenant_id ||
    query.scope.workspace_id !== scope.workspace_id ||
    query.scope.project_id !== scope.project_id
  )
    throw fail(
      'OUTBOX_READ_SCOPE_MISMATCH',
      'The selected receipt belongs to another configured project',
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
        : 'OUTBOX_REQUEUE_FILE_OUTPUT_UNAVAILABLE',
      'Choose a new receipt file in an existing directory',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: path,
        output_path: resolve(args.output!),
        local_state: 'not-saved',
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
      'The existing queue could not be opened for receipt export',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: path,
        output_path: output.path,
        stage: 'open',
        local_state: 'not-saved',
        local_commit: 'not-attempted',
      },
    );
  }
  let file: OutboxRestoreRequeueFile;
  try {
    file = queue.readRestoreRequeueFile(query, trace);
  } catch (error) {
    let close_pending = false;
    try {
      queue.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_FILE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete receipt file could not be prepared',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: path,
        output_path: output.path,
        local_state: 'not-saved',
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
  const summary = outboxRestoreRequeueFileSummary(file);
  let local: Awaited<ReturnType<typeof saveOutboxRestoreRequeueFile>>;
  try {
    local = await saveOutboxRestoreRequeueFile(file, output, trace);
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_REQUEUE_FILE_SAVE_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete receipt file could not be saved',
      trace,
      {
        local_state: 'not-saved',
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: path,
        output_path: output.path,
        historical_receipt: file.document.receipt,
        archive: summary,
        close_pending,
      },
    );
  }
  return envelope(query.scope, { ...summary, query, outbox: path, local, close_pending }, trace);
}
