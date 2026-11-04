import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES,
  PACK_ORIGINAL_BYTES,
  PACK_RECEIPT_BACKUP_MAX_ENTRIES,
  PACK_RECEIPT_VOLUMES_MAX_ENTRIES,
  parsePackSaveBinding,
} from '@planemem/contracts';
import { prepareContextPackReceiptBackup } from '@planemem/sdk';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput } from './artifact-output.js';
import {
  assertDirectory,
  contextBackupFileStates,
  createContextBackupPlan,
  saveContextBackupOutput,
} from './context-pack-backup-output.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pathKey = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
function failure(code: string, message: string, trace: string, storage = 'file-read-only') {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { ...contextBackupFileStates, storage_access: storage },
  });
}
function argumentsFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        'observation-file': { type: 'string', multiple: true },
        'binding-file': { type: 'string' },
        format: { type: 'string' },
        output: { type: 'string' },
        empty: { type: 'boolean' },
        'timeout-ms': { type: 'string' },
      },
    });
    if (args.positionals.length !== 2 || args.positionals.join(' ') !== 'context prepare-backup')
      throw new TypeError();
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option' || token.name === 'observation-file') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const format = args.values.format;
    if (format !== 'single' && format !== 'volumes') throw new TypeError();
    const filePath = (value: string | undefined) => {
      if (
        value === undefined ||
        !value.trim() ||
        value === '-' ||
        value.length > 4096 ||
        /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
      )
        throw new TypeError();
      const path = resolve(value);
      if (path.length > 4096) throw new TypeError();
      return path;
    };
    const inputs = args.values['observation-file'] ?? [];
    if (
      (inputs.length === 0) !== (args.values.empty === true) ||
      inputs.length >
        (format === 'single' ? PACK_RECEIPT_BACKUP_MAX_ENTRIES : PACK_RECEIPT_VOLUMES_MAX_ENTRIES)
    )
      throw new TypeError();
    const files = inputs.map(filePath);
    if (new Set(files.map(pathKey)).size !== files.length) throw new TypeError();
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    const timeout = Number(rawTimeout);
    if (
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout) ||
      !Number.isSafeInteger(timeout) ||
      timeout > 2147483647
    )
      throw new TypeError();
    const bindingFile = filePath(args.values['binding-file']);
    const output = filePath(args.values.output);
    if ([...files, bindingFile].some((file) => pathKey(file) === pathKey(output)))
      throw new TypeError();
    return { files, bindingFile, output, format, timeout };
  } catch {
    throw failure(
      'USAGE_ERROR',
      'Use context prepare-backup --binding-file BINDING.json --format single|volumes --output NEW_DIRECTORY with repeated --observation-file FILE, or --empty. Optional --timeout-ms 30000. No stdin, network settings, duplicate paths or repeated non-file options.',
      trace,
      'not-performed',
    );
  }
}

/** The timeout covers only read-only preparation. A late read must never begin publication. */
async function prepareInputs(args: ReturnType<typeof argumentsFor>, trace: string) {
  const controller = new AbortController();
  const deadline = performance.now() + args.timeout;
  const stopped = () =>
    failure(
      'CONTEXT_BACKUP_PREPARATION_TIMEOUT',
      'Stopped waiting for backup input preparation. No output directory was created or save request sent.',
      trace,
    );
  const check = () => {
    if (controller.signal.aborted || performance.now() >= deadline) {
      controller.abort();
      throw stopped();
    }
  };
  const read = async (path: string, maximum: number) => {
    check();
    try {
      const bytes = await readBoundedArtifactFile(path, maximum, trace);
      check();
      if (!bytes.byteLength) throw new TypeError();
      return bytes;
    } catch {
      check();
      throw failure(
        'CONTEXT_BACKUP_INPUT_UNAVAILABLE',
        'Read stable, nonempty regular binding and observation files within their limits.',
        trace,
      );
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(stopped());
      }, args.timeout);
    });
    const work = async () => {
      check();
      let output: Awaited<ReturnType<typeof prepareArtifactOutput>>;
      try {
        output = await prepareArtifactOutput(args.output, trace);
      } catch {
        check();
        throw failure(
          'CONTEXT_BACKUP_OUTPUT_UNAVAILABLE',
          'Choose a new output directory name inside an existing directory. Existing paths are never reused.',
          trace,
        );
      }
      check();
      const parentIdentity = await lstat(output.directory, { bigint: true });
      await assertDirectory(output.directory, parentIdentity);
      check();
      const bindingBytes = await read(args.bindingFile, PACK_ORIGINAL_BYTES);
      let binding: ReturnType<typeof parsePackSaveBinding>;
      try {
        binding = parsePackSaveBinding(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bindingBytes)),
        );
      } catch {
        check();
        throw failure(
          'CONTEXT_BACKUP_BINDING_FILE_INVALID',
          'Supply one complete UTF-8 PackSaveBinding document within 8 KiB.',
          trace,
        );
      }
      const inputs: Uint8Array[] = [];
      const sources: { path: string; file_bytes: number; file_sha256: string }[] = [];
      for (const path of args.files) {
        const bytes = await read(path, CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES);
        inputs.push(bytes);
        sources.push({ path, file_bytes: bytes.byteLength, file_sha256: hash(bytes) });
      }
      check();
      const prepared = await prepareContextPackReceiptBackup(inputs, {
        trace_id: trace,
        binding,
        format: args.format,
        timeout_ms: Math.max(1, Math.ceil(deadline - performance.now())),
        signal: controller.signal,
      });
      check();
      return {
        output,
        parentIdentity,
        prepared,
        sources,
        bindingInput: {
          path: args.bindingFile,
          file_bytes: bindingBytes.byteLength,
          file_sha256: hash(bindingBytes),
        },
      };
    };
    const result = await Promise.race([work(), expired]);
    check();
    return result;
  } catch (error) {
    check();
    if (error instanceof ContractError && error.envelope.trace_id === trace) {
      const code = error.envelope.code;
      if (code === 'CONTEXT_BACKUP_PREPARATION_TIMEOUT') throw stopped();
      if (
        [
          'CONTEXT_BACKUP_OUTPUT_UNAVAILABLE',
          'CONTEXT_BACKUP_INPUT_UNAVAILABLE',
          'CONTEXT_BACKUP_BINDING_FILE_INVALID',
          'CONTEXT_BACKUP_OBSERVATION_INVALID',
          'CONTEXT_BACKUP_OBSERVATION_DUPLICATE',
          'CONTEXT_BACKUP_BINDING_MISMATCH',
          'CONTEXT_BACKUP_DIGEST_MISMATCH',
          'CONTEXT_BACKUP_INTEGRITY_UNAVAILABLE',
          'CONTEXT_BACKUP_PREPARATION_FAILED',
          'INVALID_INPUT',
        ].includes(code)
      )
        throw failure(code, error.envelope.message, trace);
    }
    throw failure(
      'CONTEXT_BACKUP_PREPARATION_FAILED',
      'Could not prepare the complete backup. Retain the input files; no output directory was created.',
      trace,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

/** No timer races publication; every destination is new, and failures retain earlier files. */
export async function prepareContextPackBackupArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const { output, parentIdentity, prepared, sources, bindingInput } = await prepareInputs(
    args,
    trace,
  );
  const contents = prepared.data.contents;
  const plan = createContextBackupPlan(contents, output.path);
  const data = {
    status: 'backup-prepared' as const,
    binding: prepared.data.binding,
    document_sha256: prepared.data.document_sha256,
    observations: prepared.data.observations,
    input_files: prepared.data.input_files,
    input_bytes: prepared.data.input_bytes,
    output_files: prepared.data.output_files,
    output_bytes: prepared.data.output_bytes,
    completeness: prepared.data.completeness,
    contents:
      contents.kind === 'single'
        ? { kind: 'single' as const, backup_file: contents.backup.file }
        : {
            kind: 'volumes' as const,
            manifest_file: contents.collection.file,
            volume_files: contents.collection.volumes.map((volume) => volume.file),
          },
    local_inputs: sources,
    binding_file: bindingInput,
    output_plan: plan.map(({ name, path, file_sha256, file_bytes, document_sha256 }) => ({
      name,
      path,
      file_sha256,
      file_bytes,
      document_sha256,
    })),
    ...contextBackupFileStates,
    storage_access: 'file-read-write' as const,
  };
  const local = await saveContextBackupOutput(output, parentIdentity, plan, trace);
  return { schema_version: 1, trace_id: trace, source_refs: [], data: { ...data, local } };
}
