import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  parseArtifactReceiptEnvelope,
  parseArtifactReceiptQuery,
  syncJsonSnapshot,
  type ArtifactReceiptEnvelope,
  type ArtifactReceiptQuery,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';

const RECEIPT_BYTES = 4 * 1024 * 1024;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function failure(
  code: string,
  message: string,
  trace: string,
  details: Record<string, unknown> = {},
) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { ...details, upload_dispatch_state: 'not-sent' },
  });
}
function validPath(path: string) {
  return !!path.trim() && path !== '-' && !/[\u0000-\u001f]/.test(path);
}
function parseSaved(bytes: Uint8Array) {
  const row = JSON.parse(
    syncJsonSnapshot(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      RECEIPT_BYTES,
    ),
  ) as Record<string, unknown>;
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.trace_id !== 'string')
    throw new TypeError();
  const data = row.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError();
  const view = data as Record<string, unknown>;
  const original = parseArtifactReceiptQuery(
    JSON.parse(
      syncJsonSnapshot(
        { identity: view.identity, command: view.command },
        ARTIFACT_UPLOAD_REQUEST_BYTES,
      ),
    ),
  );
  const receipt = parseArtifactReceiptEnvelope(row, original, row.trace_id);
  return { original, receipt };
}

async function readReceipt(path: string, trace: string) {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedArtifactFile(path, RECEIPT_BYTES, trace);
  } catch {
    throw failure(
      'ARTIFACT_RECEIPT_FILE_UNAVAILABLE',
      'Read a stable regular receipt file within 4 MiB',
      trace,
    );
  }
  try {
    return { ...parseSaved(bytes), file_bytes: bytes.byteLength, file_sha256: hash(bytes) };
  } catch {
    throw failure(
      'ARTIFACT_RECEIPT_FILE_INVALID',
      'Expected a complete UTF-8 original artifact receipt envelope matching its identity, command and recorded result',
      trace,
    );
  }
}

export async function prepareArtifactReceiptOutput(path: string, trace: string) {
  try {
    return await prepareArtifactOutput(path, trace);
  } catch {
    throw failure(
      'ARTIFACT_RECEIPT_OUTPUT_UNAVAILABLE',
      'Choose a new receipt file in an existing directory; existing files and links are never replaced',
      trace,
      {
        receipt_query_state: 'not-started',
      },
    );
  }
}

/** Save errors are local state, so they cannot erase a receipt already returned by the gateway. */
export async function captureArtifactReceipt(
  receipt: ArtifactReceiptEnvelope,
  original: ArtifactReceiptQuery,
  output: ArtifactOutput,
  trace: string,
) {
  const destination = { ...output };
  let file_sha256: string | undefined;
  let file_bytes: number | undefined;
  try {
    let bytes: Uint8Array;
    try {
      const query = parseArtifactReceiptQuery(
        JSON.parse(syncJsonSnapshot(original, ARTIFACT_UPLOAD_REQUEST_BYTES)),
      );
      const verified = parseArtifactReceiptEnvelope(
        JSON.parse(syncJsonSnapshot(receipt, RECEIPT_BYTES)),
        query,
        trace,
      );
      bytes = new TextEncoder().encode(syncJsonSnapshot(verified, RECEIPT_BYTES));
    } catch {
      throw failure(
        'ARTIFACT_RECEIPT_CAPTURE_INVALID',
        'The complete receipt could not be prepared for local saving; preserve the original command output',
        trace,
        {
          local_state: 'not-saved',
          output_path: destination.path,
        },
      );
    }
    file_sha256 = hash(bytes);
    file_bytes = bytes.byteLength;
    let local;
    try {
      // No timeout races from this point: publication, cleanup and readback must settle.
      local = await saveArtifactOutput(destination, bytes, file_sha256, trace);
    } catch (error) {
      const known =
        error instanceof ContractError &&
        error.envelope.trace_id === trace &&
        error.envelope.code === 'ARTIFACT_SAVE_FAILED'
          ? error.envelope.details
          : { local_state: 'unconfirmed', output_path: destination.path };
      throw failure(
        'ARTIFACT_RECEIPT_SAVE_FAILED',
        'The receipt was returned but its local file could not be saved; preserve the complete receipt in command output',
        trace,
        known,
      );
    }
    try {
      const stored = await readReceipt(local.path, trace);
      if (stored.file_bytes !== file_bytes || stored.file_sha256 !== file_sha256)
        throw new TypeError();
    } catch {
      throw failure(
        'ARTIFACT_RECEIPT_READBACK_FAILED',
        'The receipt file was created but final contents could not be confirmed; retain the file for inspection',
        trace,
        {
          local_state: 'published-unconfirmed',
          output_path: local.path,
          cleanup_pending: local.cleanup_pending,
          ...(local.temporary_path === undefined ? {} : { temporary_path: local.temporary_path }),
        },
      );
    }
    return {
      state: 'saved-and-read-back' as const,
      path: local.path,
      file_bytes,
      file_sha256,
      file_content_state: 'verified' as const,
      cleanup_pending: local.cleanup_pending,
      ...(local.temporary_path === undefined ? {} : { temporary_path: local.temporary_path }),
    };
  } catch (error) {
    const envelope =
      error instanceof ContractError && error.envelope.trace_id === trace
        ? error.envelope
        : undefined;
    return {
      state: 'save-failed' as const,
      path: destination.path,
      ...(file_sha256 === undefined
        ? {}
        : { candidate_file_sha256: file_sha256, candidate_file_bytes: file_bytes }),
      error: {
        code: envelope?.code ?? 'ARTIFACT_RECEIPT_SAVE_FAILED',
        message:
          envelope?.message ??
          'Could not save the receipt file; preserve the complete receipt in command output',
        details: envelope?.details ?? { local_state: 'unconfirmed', output_path: destination.path },
      },
    };
  }
}

/** Offline inspection is structural validation, never authentication or a fresh server observation. */
export async function inspectArtifactReceiptArguments(argv: string[], trace: string) {
  let file: string;
  let originalFile: string | undefined;
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
    const query = args.values['json-file'];
    if (
      args.positionals.length !== 2 ||
      args.positionals.join(' ') !== 'artifacts inspect-receipt' ||
      path === undefined ||
      !validPath(path) ||
      (query !== undefined && !validPath(query))
    )
      throw new TypeError();
    file = resolve(path);
    originalFile = query === undefined ? undefined : resolve(query);
  } catch {
    throw failure(
      'USAGE_ERROR',
      'Use artifacts inspect-receipt --receipt-file RECEIPT.json and optional --json-file ORIGINAL.json; no network options, output, stdin or repeated flags',
      trace,
    );
  }
  const saved = await readReceipt(file, trace);
  let binding: { original_file: string; original_file_sha256: string } | undefined;
  if (originalFile !== undefined) {
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedArtifactFile(originalFile, ARTIFACT_UPLOAD_REQUEST_BYTES, trace);
    } catch {
      throw failure(
        'ARTIFACT_REQUEST_FILE_UNAVAILABLE',
        'Read a stable regular original request file within 1 MiB',
        trace,
      );
    }
    try {
      const original = parseArtifactReceiptQuery(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      parseArtifactReceiptEnvelope(saved.receipt, original, saved.receipt.trace_id);
      binding = { original_file: originalFile, original_file_sha256: hash(bytes) };
    } catch {
      throw failure(
        'ARTIFACT_RECEIPT_ORIGINAL_MISMATCH',
        'The receipt does not match the complete supplied original request; retain both files and the original identity, key and version',
        trace,
      );
    }
  }
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    data: {
      status: 'locally-valid' as const,
      receipt_file: file,
      receipt_file_bytes: saved.file_bytes,
      receipt_file_sha256: saved.file_sha256,
      receipt: saved.receipt,
      original: saved.original,
      original_binding:
        binding === undefined ? ('embedded-only' as const) : ('matches-original-file' as const),
      ...binding,
      identity_state: 'not-authenticated' as const,
      server_outcome: 'not-checked' as const,
      content_state: 'not-checked' as const,
      upload_dispatch_state: 'not-sent' as const,
      recovery:
        'This is an unsigned local receipt snapshot. Preserve the original request and content; not-observed does not prove upload failure. Query artifacts receipt with the unchanged original for a fresh server observation.',
    },
  };
}
