import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  contextPackSaveReceiptFileJson,
  contextPackSaveReceiptQuery,
  encodePackSaveOriginal,
  isSyncIdentifier,
  parseContextPackSaveReceiptEnvelope,
  syncJsonSnapshot,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';
import {
  matchContextPackReceiptOriginal,
  readContextPackReceiptFile,
  verifyContextPackReceiptFile,
} from './context-pack-receipt-file.js';

const RESULT_BYTES = 96 * 1024;
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const historical = {
  observation_state: 'historical',
  server_authenticity: 'not-checked',
  current_server_outcome: 'not-checked',
  content_state: 'not-checked',
  source_state: 'not-checked',
  compile_dispatch_state: 'not-sent',
} as const;

function failure(code: string, message: string, trace: string) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { compile_dispatch_state: 'not-sent', server_outcome: 'not-checked' },
  });
}
function object(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError();
  return row;
}
function text(value: unknown) {
  if (typeof value !== 'string' || !value.length) throw new TypeError();
  return value;
}
function digest(value: unknown) {
  if (!/^[a-f0-9]{64}$/.test(text(value))) throw new TypeError();
}
function size(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError();
}

/** Validate historical local hints as data only; never visit any path contained in an input. */
function localRecord(input: unknown, raw: string) {
  const expectedHash = hash(raw);
  const expectedBytes = new TextEncoder().encode(raw).byteLength;
  const state = input && typeof input === 'object' && 'state' in input ? input.state : undefined;
  const row =
    state === 'saved-and-read-back'
      ? object(
          input,
          ['state', 'path', 'file_sha256', 'file_bytes', 'cleanup_pending'],
          ['temporary_path'],
        )
      : object(
          input,
          ['state', 'path', 'phase', 'message', 'details'],
          ['candidate_file_sha256', 'candidate_file_bytes'],
        );
  text(row.path);
  if (state === 'saved-and-read-back') {
    digest(row.file_sha256);
    size(row.file_bytes);
    if (row.file_sha256 !== expectedHash || row.file_bytes !== expectedBytes) throw new TypeError();
    if (typeof row.cleanup_pending !== 'boolean') throw new TypeError();
    if (row.temporary_path !== undefined) text(row.temporary_path);
  } else {
    if (state !== 'save-failed') throw new TypeError();
    if (
      !['capture', 'preflight', 'source-readback', 'publish', 'readback'].includes(text(row.phase))
    )
      throw new TypeError();
    text(row.message);
    if (!row.details || typeof row.details !== 'object' || Array.isArray(row.details))
      throw new TypeError();
    if (row.candidate_file_sha256 !== undefined) {
      digest(row.candidate_file_sha256);
      if (row.candidate_file_sha256 !== expectedHash) throw new TypeError();
    }
    if (row.candidate_file_bytes !== undefined) {
      size(row.candidate_file_bytes);
      if (row.candidate_file_bytes !== expectedBytes) throw new TypeError();
    }
  }
}

function recoveryRecord(input: unknown) {
  const row = object(
    input,
    ['input_file', 'input_file_sha256', 'input_file_bytes', ...Object.keys(historical)],
    ['matched_original'],
  );
  text(row.input_file);
  digest(row.input_file_sha256);
  size(row.input_file_bytes);
  for (const [key, value] of Object.entries(historical))
    if (row[key] !== value) throw new TypeError();
  if (row.matched_original !== undefined) {
    const matched = object(row.matched_original, ['original_file', 'original_file_sha256']);
    text(matched.original_file);
    digest(matched.original_file_sha256);
  }
}

async function readResult(path: string, trace: string) {
  try {
    const bytes = await readBoundedArtifactFile(path, RESULT_BYTES, trace);
    const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    // Bound all JSON, including local diagnostics; reject nonfinite numbers and excessive nesting.
    const row = object(JSON.parse(syncJsonSnapshot(input, RESULT_BYTES)), [
      'schema_version',
      'trace_id',
      'source_refs',
      'data',
    ]);
    if (row.schema_version !== 1 || !isSyncIdentifier(row.trace_id) || /\u007f/.test(row.trace_id))
      throw new TypeError();
    const status =
      row.data && typeof row.data === 'object' && 'status' in row.data
        ? row.data.status
        : undefined;
    const data =
      status === 'receipt-observed'
        ? object(row.data, ['status', 'original', 'receipt', 'receipt_file', 'local'])
        : object(row.data, ['status', 'receipt_file', 'recovery', 'local']);
    const file = verifyContextPackReceiptFile(data.receipt_file);
    localRecord(data.local, contextPackSaveReceiptFileJson(file));
    if (status === 'receipt-observed') {
      if (encodePackSaveOriginal(data.original) !== encodePackSaveOriginal(file.document.original))
        throw new TypeError();
      const query = contextPackSaveReceiptQuery(file.document.original);
      const receipt = parseContextPackSaveReceiptEnvelope(data.receipt, query, row.trace_id);
      const outer = parseContextPackSaveReceiptEnvelope(
        { ...receipt, source_refs: row.source_refs },
        query,
        row.trace_id,
      );
      if (
        JSON.stringify(receipt) !== JSON.stringify(file.document.receipt) ||
        JSON.stringify(outer) !== JSON.stringify(receipt)
      )
        throw new TypeError();
    } else {
      if (
        status !== 'receipt-recovered' ||
        !Array.isArray(row.source_refs) ||
        row.source_refs.length !== 0
      )
        throw new TypeError();
      recoveryRecord(data.recovery);
    }
    return { file, bytes, file_sha256: hash(bytes) };
  } catch {
    throw failure(
      'CONTEXT_PACK_RECEIPT_RESULT_INVALID',
      'Use a complete UTF-8 save-receipt or recover-receipt output within 96 KiB, including a matching receipt_file and digest. Missing observations cannot be reconstructed; keep the original output.',
      trace,
    );
  }
}

function argumentsFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        'result-file': { type: 'string' },
        output: { type: 'string' },
        'json-file': { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const input = args.values['result-file'];
    const output = args.values.output;
    const original = args.values['json-file'];
    if (
      args.positionals.length !== 2 ||
      args.positionals.join(' ') !== 'context recover-receipt' ||
      input === undefined ||
      output === undefined
    )
      throw new TypeError();
    for (const value of [input, output, original])
      if (
        value !== undefined &&
        (!value.trim() || value === '-' || /[\u0000-\u001f\u007f]/.test(value))
      )
        throw new TypeError();
    return {
      input: resolve(input),
      output,
      original: original === undefined ? undefined : resolve(original),
    };
  } catch {
    throw failure(
      'USAGE_ERROR',
      'Use context recover-receipt --result-file RESULT.json --output NEW_RECEIPT.json [--json-file ORIGINAL.json]; no stdin, network settings, repeated or unrelated options',
      trace,
    );
  }
}

/** Preserve the captured observation and timestamp, including after another local save failure. */
export async function recoverContextPackReceipt(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const saved = await readResult(args.input, trace);
  const matched = await matchContextPackReceiptOriginal(
    saved.file.document.original,
    args.original,
    trace,
  );
  const raw = contextPackSaveReceiptFileJson(saved.file);
  const bytes = new TextEncoder().encode(raw);
  const fileHash = hash(bytes);
  const data = {
    status: 'receipt-recovered' as const,
    receipt_file: saved.file,
    recovery: {
      input_file: args.input,
      input_file_sha256: saved.file_sha256,
      input_file_bytes: saved.bytes.byteLength,
      ...historical,
      ...(matched === undefined ? {} : { matched_original: matched }),
    },
  };
  const envelope = { schema_version: 1, trace_id: trace, source_refs: [] };
  let output: ArtifactOutput | undefined;
  let published: Awaited<ReturnType<typeof saveArtifactOutput>> | undefined;
  let phase: 'preflight' | 'source-readback' | 'publish' | 'readback' = 'preflight';
  try {
    output = await prepareArtifactOutput(args.output, trace);
    phase = 'source-readback';
    const again = await readResult(args.input, trace);
    if (!Buffer.from(saved.bytes).equals(again.bytes)) throw new TypeError();
    phase = 'publish';
    // Await actual completion; no timeout may leave an unreported late publication.
    published = await saveArtifactOutput(output, bytes, fileHash, trace);
    phase = 'readback';
    const stored = await readContextPackReceiptFile(published.path, trace);
    if (
      stored.file_sha256 !== fileHash ||
      !Buffer.from(bytes).equals(stored.bytes) ||
      contextPackSaveReceiptFileJson(stored.file) !== raw
    )
      throw new TypeError();
    return {
      ...envelope,
      data: {
        ...data,
        local: {
          state: 'saved-and-read-back' as const,
          path: published.path,
          file_sha256: fileHash,
          file_bytes: bytes.byteLength,
          cleanup_pending: published.cleanup_pending,
          ...(published.temporary_path === undefined
            ? {}
            : { temporary_path: published.temporary_path }),
        },
      },
    };
  } catch (error) {
    const known =
      error instanceof ContractError &&
      error.envelope.trace_id === trace &&
      error.envelope.code === 'ARTIFACT_SAVE_FAILED'
        ? error.envelope.details
        : undefined;
    return {
      ...envelope,
      data: {
        ...data,
        local: {
          state: 'save-failed' as const,
          path: output?.path ?? resolve(args.output),
          phase,
          candidate_file_sha256: fileHash,
          candidate_file_bytes: bytes.byteLength,
          message:
            'Keep this complete output for offline recovery. Local saving was not confirmed; no query or pack save was sent.',
          details: known ?? {
            local_state: published ? 'published-unconfirmed' : 'not-saved',
            ...(published === undefined
              ? {}
              : {
                  cleanup_pending: published.cleanup_pending,
                  ...(published.temporary_path === undefined
                    ? {}
                    : { temporary_path: published.temporary_path }),
                }),
          },
        },
      },
    };
  }
}
