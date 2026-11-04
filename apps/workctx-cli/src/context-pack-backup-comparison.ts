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
  syncJsonSnapshot,
  type PackSaveBinding,
} from '@planemem/contracts';
import {
  compareContextPackReceiptBackups,
  CONTEXT_PACK_BACKUP_COMPARISON_BYTES,
} from '@planemem/sdk';
import { readBoundedArtifactFile } from './artifact-files.js';

const INPUT_METADATA_BYTES = 512 * 1024;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
interface InputFile {
  path: string;
  file_bytes: number;
  file_sha256: string;
}
const states = {
  identity_state: 'not-authenticated',
  server_outcome: 'not-checked',
  content_state: 'not-checked',
  source_state: 'not-checked',
  save_dispatch_state: 'not-sent',
  browser_history_access: 'not-performed',
  mutation_eligibility: 'not-established',
  restore_state: 'not-started',
} as const;
function failure(code: string, message: string, trace: string, reading: boolean) {
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
        'from-backup-file': { type: 'string', multiple: true },
        'to-backup-file': { type: 'string', multiple: true },
        'binding-file': { type: 'string' },
        'expected-from-document-sha256': { type: 'string' },
        'expected-to-document-sha256': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    if (args.positionals.length !== 2 || args.positionals.join(' ') !== 'context compare-backups')
      throw new TypeError();
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (
        token.kind !== 'option' ||
        token.name === 'from-backup-file' ||
        token.name === 'to-backup-file'
      )
        continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
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
    const fileList = (paths: string[] | undefined) => {
      if (!paths || paths.length < 1 || paths.length > PACK_RECEIPT_MAX_VOLUMES + 1)
        throw new TypeError();
      const files = paths.map(filePath);
      const keys = files.map((path) => (process.platform === 'win32' ? path.toLowerCase() : path));
      if (new Set(keys).size !== keys.length) throw new TypeError();
      return files;
    };
    const fromFiles = fileList(args.values['from-backup-file']);
    const toFiles = fileList(args.values['to-backup-file']);
    const fromDigest = args.values['expected-from-document-sha256'];
    const toDigest = args.values['expected-to-document-sha256'];
    for (const digest of [fromDigest, toDigest])
      if (digest !== undefined && !/^[a-f0-9]{64}$/.test(digest)) throw new TypeError();
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    const timeout = Number(rawTimeout);
    if (
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout) ||
      !Number.isSafeInteger(timeout) ||
      timeout > 2147483647
    )
      throw new TypeError();
    const bindingFile = args.values['binding-file'];
    return {
      fromFiles,
      toFiles,
      bindingFile: bindingFile === undefined ? undefined : filePath(bindingFile),
      fromDigest,
      toDigest,
      timeout,
    };
  } catch {
    throw failure(
      'USAGE_ERROR',
      'Use context compare-backups with 1-11 --from-backup-file FILE and 1-11 --to-backup-file FILE paths. Optional --binding-file BINDING.json, --expected-from-document-sha256 SHA256, --expected-to-document-sha256 SHA256 and --timeout-ms 30000. No stdin, output, network settings, duplicate paths within a side or repeated non-file options.',
      trace,
      false,
    );
  }
}

/** Compare explicit local file reads; differing observations never trigger a write or save. */
export async function compareContextPackBackupArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const controller = new AbortController();
  const deadline = performance.now() + args.timeout;
  let reading = false;
  const timeout = () =>
    failure(
      'CONTEXT_BACKUP_COMPARISON_TIMEOUT',
      'Stopped waiting for local backup comparison. Retain both input sets; no save, merge or restore was sent.',
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
      if (!bytes.byteLength) throw new TypeError();
      return bytes;
    } catch {
      check();
      throw failure(
        'CONTEXT_BACKUP_FILE_UNAVAILABLE',
        'Read stable, nonempty regular backup and binding files within their limits; retain both input sets.',
        trace,
        reading,
      );
    }
  };
  const readSet = async (paths: string[]) => {
    const inputs: Uint8Array[] = [];
    const sources: InputFile[] = [];
    let total = 0;
    for (const path of paths) {
      check();
      const bytes = await read(
        path,
        Math.min(PACK_RECEIPT_BACKUP_FILE_BYTES, PACK_RECEIPT_VOLUMES_SET_BYTES - total),
      );
      total += bytes.byteLength;
      inputs.push(bytes);
      sources.push({ path, file_bytes: bytes.byteLength, file_sha256: hash(bytes) });
      check();
    }
    return { inputs, sources };
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
      let bindingInput: InputFile | undefined;
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
            reading,
          );
        }
      }
      // Both sides are separate stable file reads, never a cross-file atomic snapshot.
      const from = await readSet(args.fromFiles);
      const to = await readSet(args.toFiles);
      check();
      const compared = await compareContextPackReceiptBackups(from.inputs, to.inputs, {
        trace_id: trace,
        ...(expected === undefined ? {} : { expected_binding: expected }),
        ...(args.fromDigest === undefined
          ? {}
          : { expected_from_document_sha256: args.fromDigest }),
        ...(args.toDigest === undefined ? {} : { expected_to_document_sha256: args.toDigest }),
        timeout_ms: Math.max(1, Math.ceil(deadline - performance.now())),
        signal: controller.signal,
      });
      check();
      const metadata = {
        local_inputs: { from: from.sources, to: to.sources },
        ...(bindingInput === undefined ? {} : { matched_binding_file: bindingInput }),
        input_consistency: 'separate-file-reads' as const,
        storage_access: 'file-read-only' as const,
        browser_history_access: 'not-performed' as const,
        restore_state: 'not-started' as const,
      };
      syncJsonSnapshot(metadata, INPUT_METADATA_BYTES);
      const result = {
        ...compared,
        data: { ...compared.data, ...metadata },
      };
      const detached = JSON.parse(
        syncJsonSnapshot(result, CONTEXT_PACK_BACKUP_COMPARISON_BYTES + INPUT_METADATA_BYTES),
      ) as typeof result;
      check();
      return detached;
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
      if (code === 'CONTEXT_BACKUP_COMPARISON_TIMEOUT') throw timeout();
      if (code === 'CONTEXT_BACKUP_COMPARISON_CANCELED')
        throw failure(
          code,
          'Stopped waiting for local backup comparison. Input files may have been read; no save, merge or restore was sent.',
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
          'CONTEXT_BACKUP_COMPARISON_CONFLICT',
          'CONTEXT_BACKUP_COMPARISON_FAILED',
        ].includes(code)
      )
        throw failure(code, error.envelope.message, trace, reading);
    }
    throw failure(
      'CONTEXT_BACKUP_COMPARISON_FAILED',
      'Could not compare the complete backup files within the result limit. Retain both input sets; no save, merge or restore was sent.',
      trace,
      reading,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
