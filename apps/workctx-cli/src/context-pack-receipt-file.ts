import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  PACK_ORIGINAL_BYTES,
  CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES,
  contextPackSaveReceiptDocumentJson,
  contextPackSaveReceiptFileJson,
  parseContextPackSaveReceiptDocument,
  parseContextPackSaveReceiptFile,
  decodePackSaveOriginal,
  encodePackSaveOriginal,
  type ContextPackSaveReceiptEnvelope,
  type ContextPackSaveReceiptFile,
  type PackSaveOriginal,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';

const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function failure(code: string, message: string, trace: string) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { compile_dispatch_state: 'not-sent', server_outcome: 'not-checked' },
  });
}
async function readReceipt(path: string, trace: string) {
  try {
    const bytes = await readBoundedArtifactFile(path, CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES, trace);
    const file = parseContextPackSaveReceiptFile(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (hash(contextPackSaveReceiptDocumentJson(file.document)) !== file.document_sha256)
      throw new TypeError();
    return { file, bytes, file_sha256: hash(bytes) };
  } catch {
    throw failure(
      'CONTEXT_PACK_RECEIPT_FILE_INVALID',
      'Read a stable complete receipt file within 32 KiB with a matching original and document digest',
      trace,
    );
  }
}
export async function prepareContextPackReceiptOutput(path: string, trace: string) {
  try {
    return await prepareArtifactOutput(path, trace);
  } catch {
    throw failure(
      'CONTEXT_PACK_RECEIPT_OUTPUT_UNAVAILABLE',
      'Choose a new receipt file in an existing directory. No query or pack save was sent.',
      trace,
    );
  }
}

/** Local failure preserves the complete observation; publication is not raced by a query timer. */
export async function captureContextPackReceipt(
  original: PackSaveOriginal,
  receipt: ContextPackSaveReceiptEnvelope,
  output: ArtifactOutput,
  trace: string,
) {
  const destination = { ...output };
  let file: ContextPackSaveReceiptFile | undefined;
  let published: Awaited<ReturnType<typeof saveArtifactOutput>> | undefined;
  let phase: 'capture' | 'publish' | 'readback' = 'capture';
  let fileHash: string | undefined;
  try {
    const document = parseContextPackSaveReceiptDocument({
      schema_version: 1,
      kind: 'context-pack-save-observation',
      observed_at: new Date().toISOString(),
      original,
      receipt,
    });
    if (document.receipt.trace_id !== trace) throw new TypeError();
    file = {
      document,
      document_sha256: hash(contextPackSaveReceiptDocumentJson(document)),
    };
    const raw = contextPackSaveReceiptFileJson(file);
    const bytes = new TextEncoder().encode(raw);
    fileHash = hash(bytes);
    phase = 'publish';
    published = await saveArtifactOutput(destination, bytes, fileHash, trace);
    phase = 'readback';
    const stored = await readReceipt(published.path, trace);
    if (
      stored.file_sha256 !== fileHash ||
      !Buffer.from(stored.bytes).equals(bytes) ||
      contextPackSaveReceiptFileJson(stored.file) !== raw
    )
      throw new TypeError();
    return {
      receipt_file: file,
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
    };
  } catch (error) {
    const known =
      error instanceof ContractError &&
      error.envelope.trace_id === trace &&
      error.envelope.code === 'ARTIFACT_SAVE_FAILED'
        ? error.envelope.details
        : undefined;
    return {
      ...(file === undefined ? {} : { receipt_file: file }),
      local: {
        state: 'save-failed' as const,
        path: destination.path,
        phase,
        ...(fileHash === undefined ? {} : { candidate_file_sha256: fileHash }),
        message:
          'Keep the complete observation in this output. Local saving failed; no pack save was sent.',
        details: known ?? {
          local_state: published ? 'published-unconfirmed' : 'unconfirmed',
          output_path: destination.path,
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
    };
  }
}

/** Offline self-consistency and optional original-file binding, never a fresh server observation. */
export async function inspectContextPackReceipt(argv: string[], trace: string) {
  let filePath: string;
  let originalPath: string | undefined;
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: { 'receipt-file': { type: 'string' }, 'json-file': { type: 'string' } },
    });
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const path = args.values['receipt-file'];
    const original = args.values['json-file'];
    if (
      args.positionals.length !== 2 ||
      args.positionals.join(' ') !== 'context inspect-receipt' ||
      path === undefined
    )
      throw new TypeError();
    for (const value of [path, original])
      if (
        value !== undefined &&
        (!value.trim() || value === '-' || /[\u0000-\u001f\u007f]/.test(value))
      )
        throw new TypeError();
    filePath = resolve(path);
    originalPath = original === undefined ? undefined : resolve(original);
  } catch {
    throw failure(
      'USAGE_ERROR',
      'Use context inspect-receipt --receipt-file RECEIPT.json [--json-file ORIGINAL.json]; no output, network settings, stdin or repeated options',
      trace,
    );
  }
  const saved = await readReceipt(filePath, trace);
  let matched: { original_file: string; original_file_sha256: string } | undefined;
  if (originalPath !== undefined) {
    try {
      const bytes = await readBoundedArtifactFile(originalPath, PACK_ORIGINAL_BYTES, trace);
      const original = decodePackSaveOriginal(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
      if (encodePackSaveOriginal(original) !== encodePackSaveOriginal(saved.file.document.original))
        throw new TypeError();
      matched = { original_file: originalPath, original_file_sha256: hash(bytes) };
    } catch {
      throw failure(
        'CONTEXT_PACK_RECEIPT_ORIGINAL_MISMATCH',
        'The complete original file could not be read or differs from the historical receipt binding',
        trace,
      );
    }
  }
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: {
      status: 'inspected' as const,
      receipt_file: saved.file,
      file_path: filePath,
      file_sha256: saved.file_sha256,
      file_bytes: saved.bytes.byteLength,
      ...(matched === undefined ? {} : { matched_original: matched }),
      file_state: 'structure-and-digest-checked',
      observation_state: 'historical',
      server_authenticity: 'not-checked',
      current_server_outcome: 'not-checked',
      content_state: 'not-checked',
      source_state: 'not-checked',
      compile_dispatch_state: 'not-sent',
    },
  };
}
