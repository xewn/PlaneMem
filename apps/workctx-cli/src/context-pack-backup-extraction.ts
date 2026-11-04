import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError, contextPackSaveReceiptFileJson } from '@planemem/contracts';
import { inspectContextPackBackupArguments } from './context-pack-backup-inspection.js';
import { readContextPackReceiptFile } from './context-pack-receipt-file.js';
import { readBoundedArtifactFile } from './artifact-files.js';
import {
  prepareArtifactOutput,
  saveArtifactOutput,
  type ArtifactOutput,
} from './artifact-output.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function argumentsFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        'backup-file': { type: 'string', multiple: true },
        'binding-file': { type: 'string' },
        'expected-document-sha256': { type: 'string' },
        'observation-sha256': { type: 'string' },
        output: { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    if (
      args.positionals.length !== 2 ||
      args.positionals.join(' ') !== 'context extract-backup-receipt'
    )
      throw new TypeError();
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option' || token.name === 'backup-file') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const observation = args.values['observation-sha256'];
    const output = args.values.output;
    if (
      observation === undefined ||
      !/^[a-f0-9]{64}$/.test(observation) ||
      output === undefined ||
      !output.trim() ||
      output === '-' ||
      output.length > 4096 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(output)
    )
      throw new TypeError();
    const destination = resolve(output);
    if (destination.length > 4096) throw new TypeError();
    const inspectArgs = ['context', 'inspect-backup'];
    for (const path of args.values['backup-file'] ?? []) inspectArgs.push('--backup-file=' + path);
    for (const name of ['binding-file', 'expected-document-sha256', 'timeout-ms'] as const) {
      const value = args.values[name];
      if (value !== undefined) inspectArgs.push('--' + name + '=' + value);
    }
    return { observation, destination, inspectArgs };
  } catch {
    throw new ContractError(
      'USAGE_ERROR',
      'Use context extract-backup-receipt with repeated --backup-file FILE, --observation-sha256 SHA256 and --output NEW_RECEIPT.json. Optional --binding-file, --expected-document-sha256 and --timeout-ms apply to complete backup inspection. No stdin, network settings or repeated non-file options.',
      {
        trace_id: trace,
        retryable: false,
        details: { save_dispatch_state: 'not-sent', storage_access: 'not-performed' },
      },
    );
  }
}

/** Extract an exact verified observation, preserving its original time, request and receipt. */
export async function extractContextPackBackupReceipt(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  let inspected: Awaited<ReturnType<typeof inspectContextPackBackupArguments>>;
  try {
    inspected = await inspectContextPackBackupArguments(args.inspectArgs, trace);
  } catch (error) {
    if (
      error instanceof ContractError &&
      error.envelope.trace_id === trace &&
      error.envelope.code === 'USAGE_ERROR'
    )
      throw new ContractError(
        'USAGE_ERROR',
        'For context extract-backup-receipt, supply 1-11 distinct --backup-file paths, valid optional --binding-file/--expected-document-sha256/--timeout-ms values, and the required observation digest and new output path.',
        {
          trace_id: trace,
          retryable: false,
          details: { save_dispatch_state: 'not-sent', storage_access: 'not-performed' },
        },
      );
    throw error;
  }
  const contents = inspected.data.contents;
  const volumes = contents.kind === 'single' ? [contents.backup_file] : contents.volume_files;
  const index = volumes.findIndex((volume) =>
    volume.document.entries.some((entry) => entry.document_sha256 === args.observation),
  );
  const volume = volumes[index];
  const file = volume?.document.entries.find((entry) => entry.document_sha256 === args.observation);
  if (!file || !volume)
    throw new ContractError(
      'CONTEXT_BACKUP_OBSERVATION_NOT_FOUND',
      'The complete backup was inspected, but it does not contain the selected observation digest. No output was created.',
      {
        trace_id: trace,
        retryable: false,
        details: { save_dispatch_state: 'not-sent', storage_access: 'file-read-only' },
      },
    );
  const raw = contextPackSaveReceiptFileJson(file);
  const bytes = new TextEncoder().encode(raw);
  const fileHash = hash(bytes);
  const envelope = { schema_version: 1, trace_id: trace, source_refs: [] };
  const data = {
    status: 'backup-receipt-extracted' as const,
    receipt_file: file,
    extraction: {
      backup_kind: contents.kind,
      backup_document_sha256: inspected.data.document_sha256,
      backup_completeness: inspected.data.completeness,
      volume_index: index + 1,
      volume_document_sha256: volume.document_sha256,
      source_inputs: inspected.data.local_inputs,
      ...(inspected.data.matched_binding_file === undefined
        ? {}
        : {
            matched_binding_file: inspected.data.matched_binding_file,
          }),
    },
    observation_state: 'historical' as const,
    identity_state: 'not-authenticated' as const,
    server_outcome: 'not-checked' as const,
    content_state: 'not-checked' as const,
    source_state: 'not-checked' as const,
    save_dispatch_state: 'not-sent' as const,
    browser_history_access: 'not-performed' as const,
    storage_access: 'file-read-write' as const,
  };
  let destination: ArtifactOutput | undefined;
  let published: Awaited<ReturnType<typeof saveArtifactOutput>> | undefined;
  let phase: 'preflight' | 'source-readback' | 'publish' | 'readback' = 'preflight';
  try {
    destination = await prepareArtifactOutput(args.destination, trace);
    phase = 'source-readback';
    const sources = [
      ...inspected.data.local_inputs,
      ...(inspected.data.matched_binding_file === undefined
        ? []
        : [inspected.data.matched_binding_file]),
    ];
    for (const source of sources) {
      const again = await readBoundedArtifactFile(
        source.path,
        source.file_bytes,
        trace,
        source.file_bytes,
      );
      if (hash(again) !== source.file_sha256) throw new TypeError();
    }
    // Publication and readback are awaited, not raced against the inspection timer.
    phase = 'publish';
    published = await saveArtifactOutput(destination, bytes, fileHash, trace);
    phase = 'readback';
    const stored = await readContextPackReceiptFile(published.path, trace);
    if (
      !Buffer.from(stored.bytes).equals(bytes) ||
      stored.file_sha256 !== fileHash ||
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
    const details =
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
          path: destination?.path ?? args.destination,
          phase,
          candidate_file_sha256: fileHash,
          candidate_file_bytes: bytes.byteLength,
          details: details ?? {
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
          message:
            'Keep the complete historical receipt in this output and the original backup files. Local saving was not confirmed; no server query, pack save or browser restore was sent.',
        },
      },
    };
  }
}
