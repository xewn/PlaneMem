import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES,
  PACK_ORIGINAL_BYTES,
  PACK_RECEIPT_BACKUP_FILE_BYTES,
  PACK_RECEIPT_BACKUP_MAX_ENTRIES,
  PACK_RECEIPT_VOLUMES_MAX_ENTRIES,
  parsePackSaveBinding,
} from '@planemem/contracts';
import { prepareContextPackReceiptBackup } from '@planemem/sdk';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput, saveArtifactOutput } from './artifact-output.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pathKey = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
const states = {
  identity_state: 'not-authenticated',
  server_outcome: 'not-checked',
  content_state: 'not-checked',
  save_dispatch_state: 'not-sent',
  browser_history_access: 'not-performed',
  restore_state: 'not-started',
} as const;
function failure(code: string, message: string, trace: string, storage = 'file-read-only') {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { ...states, storage_access: storage },
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

async function assertDirectory(path: string, identity: BigIntStats) {
  const current = await lstat(path, { bigint: true });
  if (
    !identity.isDirectory() ||
    !current.isDirectory() ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino ||
    pathKey(await realpath(path)) !== pathKey(path)
  )
    throw new TypeError();
}

/** No timer races publication; every destination is new, and failures retain earlier files. */
export async function prepareContextPackBackupArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const { output, parentIdentity, prepared, sources, bindingInput } = await prepareInputs(
    args,
    trace,
  );
  const contents = prepared.data.contents;
  const files =
    contents.kind === 'single'
      ? [
          {
            name: `backup-${contents.backup.file.document_sha256}.json`,
            candidate: contents.backup,
          },
        ]
      : [
          ...contents.collection.volumes.map((candidate, index) => ({
            name: `volume-${String(index + 1).padStart(3, '0')}-${candidate.file.document_sha256}.json`,
            candidate,
          })),
          {
            name: `manifest-${contents.collection.file.document_sha256}.json`,
            candidate: contents.collection,
          },
        ];
  const plan = files.map(({ name, candidate }) => {
    const bytes = new TextEncoder().encode(candidate.raw);
    return {
      name,
      path: join(output.path, name),
      bytes,
      file_sha256: hash(bytes),
      file_bytes: bytes.byteLength,
      document_sha256: candidate.file.document_sha256,
    };
  });
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
    ...states,
    storage_access: 'file-read-write' as const,
  };
  const written: {
    path: string;
    state: 'published-unconfirmed' | 'saved-and-read-back';
    file_sha256: string;
    file_bytes: number;
    cleanup_pending: boolean;
    temporary_path?: string;
  }[] = [];
  let directoryCreated = false;
  let identity: BigIntStats | undefined;
  let phase = 'create-directory';
  let currentPath: string | undefined;
  try {
    await assertDirectory(output.directory, parentIdentity);
    await mkdir(output.path, { recursive: false, mode: 0o700 });
    directoryCreated = true;
    identity = await lstat(output.path, { bigint: true });
    await assertDirectory(output.directory, parentIdentity);
    await assertDirectory(output.path, identity);
    for (const file of plan) {
      currentPath = file.path;
      phase = 'publish-file';
      await assertDirectory(output.path, identity);
      const destination = await prepareArtifactOutput(file.path, trace);
      if (
        pathKey(destination.path) !== pathKey(file.path) ||
        pathKey(destination.directory) !== pathKey(output.path)
      )
        throw new TypeError();
      await assertDirectory(output.path, identity);
      const saved = await saveArtifactOutput(destination, file.bytes, file.file_sha256, trace);
      const record = {
        path: saved.path,
        state: 'published-unconfirmed' as 'published-unconfirmed' | 'saved-and-read-back',
        file_sha256: file.file_sha256,
        file_bytes: file.file_bytes,
        cleanup_pending: saved.cleanup_pending,
        ...(saved.temporary_path === undefined ? {} : { temporary_path: saved.temporary_path }),
      };
      written.push(record);
      phase = 'readback-file';
      await assertDirectory(output.path, identity);
      const bytes = await readBoundedArtifactFile(
        file.path,
        PACK_RECEIPT_BACKUP_FILE_BYTES,
        trace,
        file.file_bytes,
      );
      if (!Buffer.from(bytes).equals(file.bytes) || hash(bytes) !== file.file_sha256)
        throw new TypeError();
      await assertDirectory(output.path, identity);
      record.state = 'saved-and-read-back';
    }
    phase = 'readback-set';
    // The manifest is already last in the publication plan; now recheck every destination.
    for (const file of plan) {
      currentPath = file.path;
      await assertDirectory(output.path, identity);
      const bytes = await readBoundedArtifactFile(
        file.path,
        PACK_RECEIPT_BACKUP_FILE_BYTES,
        trace,
        file.file_bytes,
      );
      if (!Buffer.from(bytes).equals(file.bytes) || hash(bytes) !== file.file_sha256)
        throw new TypeError();
    }
    await assertDirectory(output.path, identity);
    await assertDirectory(output.directory, parentIdentity);
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: {
        ...data,
        local: {
          state: 'saved-and-read-back' as const,
          directory: output.path,
          files: written,
          cleanup_pending: written.some((file) => file.cleanup_pending),
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
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: {
        ...data,
        local: {
          state: 'save-failed' as const,
          directory: output.path,
          directory_created: directoryCreated,
          phase,
          ...(currentPath === undefined ? {} : { current_path: currentPath }),
          files: written,
          ...(details === undefined ? {} : { details }),
          message:
            'Keep this complete backup candidate and any files already saved. The set was not confirmed. Existing paths were not replaced; retry from the original observations into a new directory, or inspect the saved files explicitly.',
        },
      },
    };
  }
}
