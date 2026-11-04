import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  PACK_ORIGINAL_BYTES,
  PACK_RECEIPT_BACKUP_FILE_BYTES,
  PACK_RECEIPT_MAX_VOLUMES,
  PACK_RECEIPT_VOLUMES_SET_BYTES,
  parsePackSaveBinding,
  type PackSaveBinding,
} from '@planemem/contracts';
import { inspectContextPackReceiptBackup } from '@planemem/sdk';
import { readBoundedArtifactFile } from './artifact-files.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const states = {
  identity_state: 'not-authenticated',
  server_outcome: 'not-checked',
  content_state: 'not-checked',
  save_dispatch_state: 'not-sent',
} as const;
function failure(code: string, message: string, trace: string, reading = true) {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { ...states, storage_access: reading ? 'file-read-only' : 'not-performed' },
  });
}

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
        'timeout-ms': { type: 'string' },
      },
    });
    if (args.positionals.length !== 2 || args.positionals.join(' ') !== 'context inspect-backup')
      throw new TypeError();
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option' || token.name === 'backup-file') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const paths = args.values['backup-file'];
    if (!paths || paths.length < 1 || paths.length > PACK_RECEIPT_MAX_VOLUMES + 1)
      throw new TypeError();
    const filePath = (path: string) => {
      if (
        !path.trim() ||
        path === '-' ||
        path.length > 4096 ||
        /[\u0000-\u001f\u007f\p{Cs}]/u.test(path)
      )
        throw new TypeError();
      const absolute = resolve(path);
      if (absolute.length > 4096) throw new TypeError();
      return absolute;
    };
    const files = paths.map(filePath);
    const keys = files.map((path) => (process.platform === 'win32' ? path.toLowerCase() : path));
    if (new Set(keys).size !== keys.length) throw new TypeError();
    const bindingFile = args.values['binding-file'];
    const digest = args.values['expected-document-sha256'];
    if (digest !== undefined && !/^[a-f0-9]{64}$/.test(digest)) throw new TypeError();
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    const timeout = Number(rawTimeout);
    if (
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout) ||
      !Number.isSafeInteger(timeout) ||
      timeout > 2147483647
    )
      throw new TypeError();
    return {
      files,
      bindingFile: bindingFile === undefined ? undefined : filePath(bindingFile),
      digest,
      timeout,
    };
  } catch {
    throw failure(
      'USAGE_ERROR',
      'Use context inspect-backup --backup-file FILE (repeat for the manifest and every volume), optionally --binding-file BINDING.json, --expected-document-sha256 SHA256 and --timeout-ms 30000. No stdin, output, network settings, duplicate paths or repeated non-file options.',
      trace,
      false,
    );
  }
}

/** Read supplied files only; a valid backup never authorizes a save or browser restore. */
export async function inspectContextPackBackupArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const controller = new AbortController();
  const deadline = performance.now() + args.timeout;
  let reading = false;
  const timeout = () =>
    failure(
      'CONTEXT_BACKUP_INSPECTION_TIMEOUT',
      'Stopped waiting for local backup file inspection. Retain the inputs; no save or restore was sent.',
      trace,
      reading,
    );
  const check = () => {
    if (controller.signal.aborted || performance.now() >= deadline) {
      controller.abort();
      throw timeout();
    }
  };
  const read = async (path: string, maximum: number) => {
    check();
    reading = true;
    try {
      const bytes = await readBoundedArtifactFile(path, maximum, trace);
      check();
      if (bytes.byteLength === 0) throw new TypeError();
      return bytes;
    } catch {
      check();
      throw failure(
        'CONTEXT_BACKUP_FILE_UNAVAILABLE',
        'Read stable, nonempty regular backup and binding files within their limits; retain the inputs.',
        trace,
      );
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timeout());
      }, args.timeout);
    });
    const work = async () => {
      let expected: PackSaveBinding | undefined;
      let bindingInput: { path: string; file_bytes: number; file_sha256: string } | undefined;
      if (args.bindingFile !== undefined) {
        const bytes = await read(args.bindingFile, PACK_ORIGINAL_BYTES);
        try {
          expected = parsePackSaveBinding(
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
          );
          bindingInput = {
            path: args.bindingFile,
            file_bytes: bytes.byteLength,
            file_sha256: hash(bytes),
          };
        } catch {
          check();
          throw failure(
            'CONTEXT_BACKUP_BINDING_FILE_INVALID',
            'Supply one complete UTF-8 PackSaveBinding document within 8 KiB, not a request or receipt envelope.',
            trace,
          );
        }
      }
      const inputs: Uint8Array[] = [];
      const sources: { path: string; file_bytes: number; file_sha256: string }[] = [];
      let total = 0;
      for (const path of args.files) {
        check();
        const bytes = await read(
          path,
          Math.min(PACK_RECEIPT_BACKUP_FILE_BYTES, PACK_RECEIPT_VOLUMES_SET_BYTES - total),
        );
        total += bytes.byteLength;
        inputs.push(bytes);
        sources.push({ path, file_bytes: bytes.byteLength, file_sha256: hash(bytes) });
      }
      check();
      const inspected = await inspectContextPackReceiptBackup(inputs, {
        trace_id: trace,
        ...(expected === undefined ? {} : { expected_binding: expected }),
        ...(args.digest === undefined ? {} : { expected_document_sha256: args.digest }),
        timeout_ms: Math.max(1, Math.ceil(deadline - performance.now())),
        signal: controller.signal,
      });
      check();
      const contents = inspected.data.contents;
      const result = {
        schema_version: 1,
        trace_id: trace,
        source_refs: [],
        data: {
          status: 'locally-valid',
          binding: inspected.data.binding,
          binding_state: inspected.data.binding_state,
          document_sha256: inspected.data.document_sha256,
          input_files: inspected.data.input_files,
          input_bytes: inspected.data.input_bytes,
          observations: inspected.data.observations,
          completeness: inspected.data.completeness,
          contents:
            contents.kind === 'single'
              ? { kind: 'single' as const, backup_file: contents.backup.file }
              : {
                  kind: 'volumes' as const,
                  manifest_file: contents.collection.file,
                  volume_files: contents.collection.volumes.map((volume) => volume.file),
                },
          local_inputs: sources,
          ...(bindingInput === undefined ? {} : { matched_binding_file: bindingInput }),
          ...states,
          storage_access: 'file-read-only',
          browser_history_access: 'not-performed',
          restore_state: 'not-started',
        },
      };
      check();
      return result;
    };
    return await Promise.race([work(), expired]);
  } catch (error) {
    check();
    if (error instanceof ContractError && error.envelope.trace_id === trace) {
      const code = error.envelope.code;
      if (
        code === 'CONTEXT_BACKUP_FILE_UNAVAILABLE' ||
        code === 'CONTEXT_BACKUP_BINDING_FILE_INVALID'
      )
        throw error;
      if (code === 'CONTEXT_BACKUP_INSPECTION_TIMEOUT') throw timeout();
      if (code === 'CONTEXT_BACKUP_INSPECTION_CANCELED')
        throw failure(
          code,
          'Stopped waiting for local backup inspection. Input files may have been read; no save or restore was sent.',
          trace,
          reading,
        );
      if (
        [
          'INVALID_INPUT',
          'CONTEXT_BACKUP_INVALID',
          'CONTEXT_BACKUP_BINDING_MISMATCH',
          'CONTEXT_BACKUP_DIGEST_MISMATCH',
          'CONTEXT_BACKUP_INTEGRITY_UNAVAILABLE',
          'CONTEXT_BACKUP_INSPECTION_FAILED',
        ].includes(code)
      )
        throw failure(code, error.envelope.message, trace, reading);
    }
    throw failure(
      'CONTEXT_BACKUP_INSPECTION_FAILED',
      'Could not inspect the complete backup files. Retain the inputs; no save or restore was sent.',
      trace,
      reading,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
