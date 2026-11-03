import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import {
  OUTBOX_ARCHIVE_FILE_BYTES,
  parseOutboxArchiveQuery,
  verifyOutboxArchive,
  outboxArchiveSummary,
  type OutboxArchiveFile,
} from '@planemem/context-bridge/outbox-archive';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';

export function isOutboxArchiveCommand(command: string) {
  return command === 'outbox export' || command === 'outbox inspect-archive';
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fail(code: string, message: string, trace: string, details: Record<string, unknown> = {}) {
  return new ContractError(code, message, { trace_id: trace, retryable: false, details });
}
function argumentsFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      tokens: true,
      allowPositionals: true,
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
      !isOutboxArchiveCommand(command) ||
      args.positionals.length !== 2 ||
      [outbox, output, file, queryFile].some(
        (path) => path !== undefined && (!path.trim() || path === '-'),
      ) ||
      outbox === ':memory:' ||
      json === '-' ||
      (json !== undefined && queryFile !== undefined)
    )
      throw new TypeError();
    if (command === 'outbox export') {
      if (!output || file !== undefined) throw new TypeError();
    } else if (
      !file ||
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
      'Use outbox export --output NEW_FILE with optional --outbox EXISTING_FILE and --json/--json-file scope/budgets, or outbox inspect-archive --archive-file FILE. No other/repeated options, stdin or writes to existing files',
      trace,
    );
  }
}
export async function readOutboxArchiveFile(path: string, trace: string) {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedArtifactFile(path, OUTBOX_ARCHIVE_FILE_BYTES, trace);
  } catch {
    throw fail(
      'OUTBOX_ARCHIVE_FILE_UNAVAILABLE',
      'Read a stable regular archive file within the complete file limit',
      trace,
      { archive_file: resolve(path) },
    );
  }
  try {
    const saved = verifyOutboxArchive(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')),
      trace,
    );
    return { saved, file_bytes: bytes.byteLength, file_sha256: hash(bytes) };
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_ARCHIVE_INVALID',
      error instanceof ContractError ? error.envelope.message : 'The archive JSON is invalid',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        archive_file: resolve(path),
      },
    );
  }
}
function envelope(saved: OutboxArchiveFile, trace: string, extra: Record<string, unknown>) {
  return {
    schema_version: 1 as const,
    trace_id: trace,
    scope: saved.document.scope,
    source_refs: [],
    data: { ...outboxArchiveSummary(saved, trace), ...extra },
  };
}
export async function saveOutboxArchiveFile(
  saved: OutboxArchiveFile,
  output: ArtifactOutput,
  trace: string,
) {
  const file = verifyOutboxArchive(saved, trace);
  const bytes = new TextEncoder().encode(syncJsonSnapshot(file, OUTBOX_ARCHIVE_FILE_BYTES));
  const file_sha256 = hash(bytes);
  const local = await saveArtifactOutput(output, bytes, file_sha256, trace);
  try {
    const stored = await readOutboxArchiveFile(local.path, trace);
    if (
      stored.file_bytes !== bytes.byteLength ||
      stored.file_sha256 !== file_sha256 ||
      stored.saved.document_sha256 !== file.document_sha256
    )
      throw new TypeError();
  } catch {
    throw fail(
      'OUTBOX_ARCHIVE_READBACK_FAILED',
      'The archive was created but its final content could not be confirmed; preserve the reported paths',
      trace,
      {
        ...local,
        state: 'published-unconfirmed',
        content_state: 'unconfirmed',
        output_path: local.path,
        local_state: 'published-unconfirmed',
      },
    );
  }
  return { ...local, file_bytes: bytes.byteLength, file_sha256 };
}
async function readQuery(args: ReturnType<typeof argumentsFor>, trace: string) {
  let raw = args.json;
  if (args.queryFile !== undefined) {
    try {
      raw = new TextDecoder('utf-8', { fatal: true })
        .decode(await readBoundedArtifactFile(args.queryFile, 16384, trace))
        .replace(/^\uFEFF/, '');
    } catch {
      throw fail(
        'OUTBOX_ARCHIVE_QUERY_UNAVAILABLE',
        'Read a stable regular UTF-8 archive query within 16 KiB',
        trace,
      );
    }
  }
  try {
    if (raw === undefined) return {} as Record<string, unknown>;
    if (Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    return value as Record<string, unknown>;
  } catch {
    throw fail('OUTBOX_ARCHIVE_QUERY_INVALID', 'Supply a JSON archive query within 16 KiB', trace);
  }
}
/** Offline inspection imports only the archive subpath; SQLite is loaded solely for explicit export. */
export async function runOutboxArchiveArguments(
  argv: string[],
  trace: string,
  configuredScope?: { tenant_id: string; workspace_id: string; project_id: string },
) {
  const args = argumentsFor(argv, trace);
  if (args.command === 'outbox inspect-archive') {
    const stored = await readOutboxArchiveFile(args.file!, trace);
    return envelope(stored.saved, trace, {
      local: {
        state: 'read-and-verified',
        path: resolve(args.file!),
        file_bytes: stored.file_bytes,
        file_sha256: stored.file_sha256,
      },
    });
  }
  // Detach the configured project before awaiting query-file IO.
  const originalScope = parseOutboxArchiveQuery({ scope: configuredScope }, trace).scope;
  const input = await readQuery(args, trace);
  const query = parseOutboxArchiveQuery(
    { ...input, scope: Object.hasOwn(input, 'scope') ? input.scope : originalScope },
    trace,
  );
  if (
    query.scope.tenant_id !== originalScope.tenant_id ||
    query.scope.workspace_id !== originalScope.workspace_id ||
    query.scope.project_id !== originalScope.project_id
  )
    throw fail(
      'OUTBOX_READ_SCOPE_MISMATCH',
      'The archive query belongs to another configured project',
      trace,
      { query },
    );
  const suppliedPath =
    args.outbox ?? process.env.WORKCTX_OUTBOX ?? join(homedir(), '.workctx', 'outbox.sqlite');
  if (!suppliedPath.trim() || suppliedPath === '-' || suppliedPath === ':memory:')
    throw fail('USAGE_ERROR', 'Choose an existing regular queue file', trace);
  const path = resolve(suppliedPath);
  let output: ArtifactOutput;
  try {
    output = await prepareArtifactOutput(args.output!, trace);
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_ARCHIVE_OUTPUT_UNAVAILABLE',
      'Choose a new archive file in an existing directory',
      trace,
      { query, outbox: path, output_path: resolve(args.output!) },
    );
  }
  let bridge: typeof import('@planemem/context-bridge');
  try {
    bridge = await import('@planemem/context-bridge');
  } catch {
    throw fail(
      'OUTBOX_STORAGE_UNAVAILABLE',
      'The local queue archive reader is unavailable',
      trace,
      { query, outbox: path, output_path: output.path, stage: 'open' },
    );
  }
  let queue: InstanceType<typeof bridge.SqliteOutbox>;
  try {
    queue = new bridge.SqliteOutbox(path, { readonly: true });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      'The existing outbox could not be opened for archive reading',
      trace,
      { query, outbox: path, output_path: output.path, stage: 'open' },
    );
  }
  let archive: OutboxArchiveFile;
  try {
    archive = queue.readArchive(query, trace);
  } catch (error) {
    let close_pending = false;
    try {
      queue.close();
    } catch {
      close_pending = true;
    }
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_ARCHIVE_READ_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete original queue could not be archived',
      trace,
      {
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
  // No file is created until the complete read transaction and attempted database close finish.
  try {
    const local = await saveOutboxArchiveFile(archive, output, trace);
    return envelope(archive, trace, { outbox: path, local, close_pending });
  } catch (error) {
    throw fail(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_ARCHIVE_SAVE_FAILED',
      error instanceof ContractError
        ? error.envelope.message
        : 'The complete archive could not be saved',
      trace,
      {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        query,
        outbox: path,
        output_path: output.path,
        close_pending,
        document_sha256: archive.document_sha256,
        records: archive.document.records.length,
      },
    );
  }
}
