import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES,
  PACK_ORIGINAL_BYTES,
  PACK_RECEIPT_MAX_VOLUMES,
  assertPackSaveBinding,
  packReceiptBackupFileJson,
  packReceiptVolumesFileJson,
  parsePackSaveBinding,
  syncJsonSnapshot,
} from '@planemem/contracts';
import { inspectContextPackReceiptBackup } from '@planemem/sdk';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput } from './artifact-output.js';
import {
  assertDirectory,
  contextBackupFileStates,
  createContextBackupPlan,
  saveContextBackupOutput,
} from './context-pack-backup-output.js';

const RESULT_BYTES = 64 * 1024 * 1024;
const METADATA_BYTES = 16 * 1024 * 1024;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const inputStatuses = ['backup-prepared', 'backup-recovered'] as const;

function failure(code: string, message: string, trace: string, storage = 'file-read-only') {
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: { ...contextBackupFileStates, storage_access: storage },
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
function text(value: unknown, maximum = 8192) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError();
  return value;
}
function digest(value: unknown) {
  const result = text(value, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new TypeError();
  return result;
}
function count(value: unknown, maximum: number, minimum = 0) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new TypeError();
  return value;
}
function fileHint(value: unknown, maximum: number) {
  const row = object(value, ['path', 'file_bytes', 'file_sha256']);
  return {
    path: text(row.path),
    file_bytes: count(row.file_bytes, maximum, 1),
    file_sha256: digest(row.file_sha256),
  };
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
        'binding-file': { type: 'string' },
        'expected-document-sha256': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    if (args.positionals.length !== 2 || args.positionals.join(' ') !== 'context recover-backup')
      throw new TypeError();
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const path = (value: unknown) => {
      const raw = text(value, 4096);
      if (raw === '-') throw new TypeError();
      return text(resolve(raw), 4096);
    };
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    if (!/^[1-9][0-9]{0,9}$/.test(rawTimeout)) throw new TypeError();
    return {
      input: path(args.values['result-file']),
      output: path(args.values.output),
      binding:
        args.values['binding-file'] === undefined ? undefined : path(args.values['binding-file']),
      expected:
        args.values['expected-document-sha256'] === undefined
          ? undefined
          : digest(args.values['expected-document-sha256']),
      timeout: count(Number(rawTimeout), 2147483647, 1),
    };
  } catch {
    throw failure(
      'USAGE_ERROR',
      'Use context recover-backup --result-file RESULT.json --output NEW_DIRECTORY, optionally --binding-file BINDING.json, --expected-document-sha256 SHA256 and --timeout-ms 30000. No stdin, network settings or repeated options.',
      trace,
      'not-performed',
    );
  }
}

/** Historical paths are compared as strings across platforms, never resolved or opened. */
function validateLocal(
  input: unknown,
  expected: ReturnType<typeof createContextBackupPlan>,
  rawPlan: unknown,
  recovered: boolean,
) {
  const state = input && typeof input === 'object' && 'state' in input ? input.state : undefined;
  const local =
    state === 'saved-and-read-back'
      ? object(input, ['state', 'directory', 'files', 'cleanup_pending'])
      : object(
          input,
          ['state', 'directory', 'directory_created', 'phase', 'files', 'message'],
          ['current_path', 'details'],
        );
  const directory = text(local.directory);
  if (!Array.isArray(rawPlan) || rawPlan.length !== expected.length) throw new TypeError();
  const plan = rawPlan.map((value, index) => {
    const row = object(value, ['name', 'path', 'file_sha256', 'file_bytes', 'document_sha256']);
    const file = expected[index]!;
    if (
      row.name !== file.name ||
      row.file_sha256 !== file.file_sha256 ||
      row.file_bytes !== file.file_bytes ||
      row.document_sha256 !== file.document_sha256
    )
      throw new TypeError();
    const path = text(row.path);
    const slashPath = directory + (directory.endsWith('/') ? '' : '/') + file.name;
    const backslashPath = directory + (directory.endsWith('\\') ? '' : '\\') + file.name;
    if (path !== slashPath && path !== backslashPath) throw new TypeError();
    return path;
  });
  if (!Array.isArray(local.files) || local.files.length > plan.length) throw new TypeError();
  const files = local.files.map((value, index) => {
    const row = object(
      value,
      ['path', 'state', 'file_sha256', 'file_bytes', 'cleanup_pending'],
      ['temporary_path'],
    );
    const file = expected[index]!;
    if (
      row.path !== plan[index] ||
      row.file_sha256 !== file.file_sha256 ||
      row.file_bytes !== file.file_bytes ||
      (row.state !== 'published-unconfirmed' && row.state !== 'saved-and-read-back') ||
      typeof row.cleanup_pending !== 'boolean'
    )
      throw new TypeError();
    if (row.temporary_path !== undefined) text(row.temporary_path);
    if (row.cleanup_pending !== (row.temporary_path !== undefined)) throw new TypeError();
    return row;
  });
  if (state === 'saved-and-read-back') {
    if (
      files.length !== plan.length ||
      files.some((file) => file.state !== 'saved-and-read-back') ||
      local.cleanup_pending !== files.some((file) => file.cleanup_pending)
    )
      throw new TypeError();
    return;
  }
  if (state !== 'save-failed' || typeof local.directory_created !== 'boolean')
    throw new TypeError();
  text(local.message);
  if (local.details !== undefined) {
    if (!local.details || typeof local.details !== 'object' || Array.isArray(local.details))
      throw new TypeError();
    syncJsonSnapshot(local.details, 64 * 1024);
  }
  const phase = text(local.phase);
  if (phase === 'preflight' || phase === 'source-readback' || phase === 'create-directory') {
    if (
      files.length ||
      local.current_path !== undefined ||
      ((phase === 'preflight' || phase === 'source-readback') &&
        (!recovered || local.directory_created))
    )
      throw new TypeError();
  } else if (phase === 'publish-file') {
    if (
      !local.directory_created ||
      files.length >= plan.length ||
      local.current_path !== plan[files.length] ||
      files.some((file) => file.state !== 'saved-and-read-back')
    )
      throw new TypeError();
  } else if (phase === 'readback-file') {
    if (
      !local.directory_created ||
      !files.length ||
      local.current_path !== plan[files.length - 1] ||
      files[files.length - 1]!.state !== 'published-unconfirmed' ||
      files.slice(0, -1).some((file) => file.state !== 'saved-and-read-back')
    )
      throw new TypeError();
  } else if (phase === 'readback-set') {
    if (
      !local.directory_created ||
      files.length !== plan.length ||
      !plan.includes(text(local.current_path)) ||
      files.some((file) => file.state !== 'saved-and-read-back')
    )
      throw new TypeError();
  } else throw new TypeError();
}

function validateRecovery(input: unknown, root: string) {
  const row = object(
    input,
    [
      'input_file',
      'input_file_bytes',
      'input_file_sha256',
      'input_status',
      'source_inputs_state',
      'candidate_integrity',
      'binding_state',
    ],
    ['matched_binding_file', 'expected_document_sha256'],
  );
  text(row.input_file);
  count(row.input_file_bytes, RESULT_BYTES, 1);
  digest(row.input_file_sha256);
  if (
    !inputStatuses.includes(row.input_status as (typeof inputStatuses)[number]) ||
    row.source_inputs_state !== 'historical-not-reread' ||
    row.candidate_integrity !== 'verified'
  )
    throw new TypeError();
  if (
    row.binding_state !==
    (row.matched_binding_file === undefined ? 'embedded-only' : 'matches-independent-binding')
  )
    throw new TypeError();
  if (row.matched_binding_file !== undefined)
    fileHint(row.matched_binding_file, PACK_ORIGINAL_BYTES);
  if (row.expected_document_sha256 !== undefined && row.expected_document_sha256 !== root)
    throw new TypeError();
}

/** Read-only deadline. A timed-out or late preparation cannot reach the publication caller. */
async function prepareRecovery(args: ReturnType<typeof argumentsFor>, trace: string) {
  const controller = new AbortController();
  const deadline = performance.now() + args.timeout;
  const timeout = () =>
    failure(
      'CONTEXT_BACKUP_RECOVERY_TIMEOUT',
      'Stopped waiting for backup recovery preparation. No output directory was created; retain the result file.',
      trace,
    );
  const check = () => {
    if (controller.signal.aborted || performance.now() >= deadline) {
      controller.abort();
      throw timeout();
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
      check();
      const bytes = await readBoundedArtifactFile(args.input, RESULT_BYTES, trace);
      check();
      const envelope = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), [
        'schema_version',
        'trace_id',
        'source_refs',
        'data',
      ]);
      text(envelope.trace_id, 1024);
      if (
        envelope.schema_version !== 1 ||
        !Array.isArray(envelope.source_refs) ||
        envelope.source_refs.length
      )
        throw new TypeError();
      const data = object(
        envelope.data,
        [
          'status',
          'binding',
          'document_sha256',
          'observations',
          'input_files',
          'input_bytes',
          'output_files',
          'output_bytes',
          'completeness',
          'contents',
          'local_inputs',
          'binding_file',
          'output_plan',
          'local',
          ...Object.keys(contextBackupFileStates),
          'storage_access',
        ],
        ['recovery'],
      );
      const recovered = data.status === 'backup-recovered';
      if (
        (!recovered && data.status !== 'backup-prepared') ||
        recovered !== Object.hasOwn(data, 'recovery')
      )
        throw new TypeError();
      // Keep the existing node/depth budget per volume. Only the bounded metadata is copied together.
      const { contents: rawContents, ...rawMetadata } = data;
      const metadata = JSON.parse(syncJsonSnapshot(rawMetadata, METADATA_BYTES)) as Record<
        string,
        unknown
      >;
      for (const [key, value] of Object.entries(contextBackupFileStates))
        if (metadata[key] !== value) throw new TypeError();
      if (
        metadata.storage_access !== 'file-read-write' ||
        metadata.completeness !== 'supplied-observations-only'
      )
        throw new TypeError();
      const kind =
        rawContents && typeof rawContents === 'object' && 'kind' in rawContents
          ? rawContents.kind
          : undefined;
      const content =
        kind === 'single'
          ? object(rawContents, ['kind', 'backup_file'])
          : object(rawContents, ['kind', 'manifest_file', 'volume_files']);
      const raws: string[] = [];
      if (kind === 'single') raws.push(packReceiptBackupFileJson(content.backup_file));
      else {
        if (
          kind !== 'volumes' ||
          !Array.isArray(content.volume_files) ||
          !content.volume_files.length ||
          content.volume_files.length > PACK_RECEIPT_MAX_VOLUMES
        )
          throw new TypeError();
        for (const volume of content.volume_files) {
          check();
          raws.push(packReceiptBackupFileJson(volume));
        }
        raws.push(packReceiptVolumesFileJson(content.manifest_file));
      }
      check();
      const binding = parsePackSaveBinding(metadata.binding);
      let bindingInput:
        | { path: string; bytes: Uint8Array; file_bytes: number; file_sha256: string }
        | undefined;
      if (args.binding !== undefined) {
        const bytes = await readBoundedArtifactFile(args.binding, PACK_ORIGINAL_BYTES, trace);
        check();
        const expected = parsePackSaveBinding(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        );
        assertPackSaveBinding(binding, expected);
        bindingInput = {
          path: args.binding,
          bytes,
          file_bytes: bytes.byteLength,
          file_sha256: hash(bytes),
        };
      }
      const root = digest(metadata.document_sha256);
      if (args.expected !== undefined && args.expected !== root) throw new TypeError();
      if (recovered) validateRecovery(metadata.recovery, root);
      check();
      const inspected = await inspectContextPackReceiptBackup(raws, {
        trace_id: trace,
        expected_binding: binding,
        expected_document_sha256: root,
        timeout_ms: Math.max(1, Math.ceil(deadline - performance.now())),
        signal: controller.signal,
      });
      check();
      const contents = inspected.data.contents;
      const plan = createContextBackupPlan(contents, args.output);
      // Preserve the declared volume order as well as complete set membership.
      if (
        raws.length !== plan.length ||
        raws.some((raw, index) => hash(new TextEncoder().encode(raw)) !== plan[index]!.file_sha256)
      )
        throw new TypeError();
      if (
        metadata.observations !== inspected.data.observations ||
        metadata.input_files !== inspected.data.observations ||
        metadata.output_files !== plan.length ||
        metadata.output_bytes !== plan.reduce((total, file) => total + file.file_bytes, 0)
      )
        throw new TypeError();
      if (
        !Array.isArray(metadata.local_inputs) ||
        metadata.local_inputs.length !== inspected.data.observations
      )
        throw new TypeError();
      const sources = metadata.local_inputs.map((value) =>
        fileHint(value, CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES),
      );
      if (
        new Set(sources.map((file) => file.path)).size !== sources.length ||
        new Set(sources.map((file) => file.file_sha256)).size !== sources.length ||
        metadata.input_bytes !== sources.reduce((total, file) => total + file.file_bytes, 0)
      )
        throw new TypeError();
      const bindingFile = fileHint(metadata.binding_file, PACK_ORIGINAL_BYTES);
      validateLocal(metadata.local, plan, metadata.output_plan, recovered);
      check();
      return {
        bytes,
        bindingInput,
        plan,
        inputStatus: data.status as (typeof inputStatuses)[number],
        data: {
          binding,
          document_sha256: root,
          observations: inspected.data.observations,
          input_files: sources.length,
          input_bytes: sources.reduce((total, file) => total + file.file_bytes, 0),
          output_files: plan.length,
          output_bytes: plan.reduce((total, file) => total + file.file_bytes, 0),
          completeness: 'supplied-observations-only' as const,
          contents:
            contents.kind === 'single'
              ? { kind: 'single' as const, backup_file: contents.backup.file }
              : {
                  kind: 'volumes' as const,
                  manifest_file: contents.collection.file,
                  volume_files: contents.collection.volumes.map((volume) => volume.file),
                },
          local_inputs: sources,
          binding_file: bindingFile,
        },
      };
    };
    const result = await Promise.race([work(), expired]);
    check();
    return result;
  } catch (error) {
    check();
    if (
      error instanceof ContractError &&
      error.envelope.trace_id === trace &&
      error.envelope.code === 'CONTEXT_BACKUP_INSPECTION_TIMEOUT'
    )
      throw timeout();
    throw failure(
      'CONTEXT_BACKUP_RECOVERY_INVALID',
      'Use a complete UTF-8 prepare-backup or recover-backup output within 64 MiB, containing a consistent full backup, output plan and historical local records. Optional independent binding and expected root digest must match. Keep the original output; no files were created.',
      trace,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

/** Republish a complete verified candidate; original observations and old paths remain historical. */
export async function recoverContextPackBackup(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const prepared = await prepareRecovery(args, trace);
  let plan = prepared.plan;
  let local: Awaited<ReturnType<typeof saveContextBackupOutput>>;
  try {
    const output = await prepareArtifactOutput(args.output, trace);
    const identity = await lstat(output.directory, { bigint: true });
    await assertDirectory(output.directory, identity);
    plan = prepared.plan.map((file) => ({ ...file, path: join(output.path, file.name) }));
    local = await saveContextBackupOutput(output, identity, plan, trace, async () => {
      const again = await readBoundedArtifactFile(
        args.input,
        RESULT_BYTES,
        trace,
        prepared.bytes.byteLength,
      );
      if (!Buffer.from(again.buffer, again.byteOffset, again.byteLength).equals(prepared.bytes))
        throw new TypeError();
      if (prepared.bindingInput !== undefined) {
        const source = prepared.bindingInput;
        const again = await readBoundedArtifactFile(
          source.path,
          PACK_ORIGINAL_BYTES,
          trace,
          source.file_bytes,
        );
        if (!Buffer.from(again).equals(source.bytes)) throw new TypeError();
      }
    });
  } catch {
    local = {
      state: 'save-failed',
      directory: args.output,
      directory_created: false,
      phase: 'preflight',
      files: [],
      message:
        'Choose a new output directory in an existing parent. Keep this complete output for recovery; no output directory was created.',
    };
  }
  const bindingInput = prepared.bindingInput;
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: {
      ...prepared.data,
      status: 'backup-recovered' as const,
      recovery: {
        input_file: args.input,
        input_file_bytes: prepared.bytes.byteLength,
        input_file_sha256: hash(prepared.bytes),
        input_status: prepared.inputStatus,
        source_inputs_state: 'historical-not-reread' as const,
        candidate_integrity: 'verified' as const,
        binding_state:
          bindingInput === undefined
            ? ('embedded-only' as const)
            : ('matches-independent-binding' as const),
        ...(bindingInput === undefined
          ? {}
          : {
              matched_binding_file: {
                path: bindingInput.path,
                file_bytes: bindingInput.file_bytes,
                file_sha256: bindingInput.file_sha256,
              },
            }),
        ...(args.expected === undefined ? {} : { expected_document_sha256: args.expected }),
      },
      output_plan: plan.map(({ name, path, file_sha256, file_bytes, document_sha256 }) => ({
        name,
        path,
        file_sha256,
        file_bytes,
        document_sha256,
      })),
      ...contextBackupFileStates,
      storage_access: 'file-read-write' as const,
      local,
    },
  };
}
