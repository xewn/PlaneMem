import {
  ContractError,
  PACK_RECEIPT_BACKUP_FILE_BYTES,
  PACK_RECEIPT_MAX_VOLUMES,
  PACK_RECEIPT_VOLUMES_FILE_BYTES,
  PACK_RECEIPT_VOLUMES_SET_BYTES,
  assertPackSaveBinding,
  contextPackSaveReceiptDocumentJson,
  packReceiptBackupDocumentJson,
  packReceiptBackupFileJson,
  packReceiptVolumesDocumentJson,
  packReceiptVolumesFileJson,
  parsePackReceiptBackupFile,
  parsePackReceiptVolumesFile,
  parsePackSaveBinding,
  type PackReceiptBackupCandidate,
  type PackReceiptVolumesCandidate,
  type PackReceiptVolumesFile,
  type PackSaveBinding,
} from '@planemem/contracts';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpContextPackReceiptBackupInspectionOptions {
  /** Local inspection trace; embedded observations keep their original traces. */
  trace_id: string;
  expected_binding?: PackSaveBinding;
  /** Canonical backup document digest, or manifest document digest for a volume set. */
  expected_document_sha256?: string;
  timeout_ms?: number;
  signal?: AbortSignal;
}

export type WcpContextPackReceiptBackupContents =
  | { kind: 'single'; backup: PackReceiptBackupCandidate }
  | { kind: 'volumes'; collection: PackReceiptVolumesCandidate };

export interface WcpInspectedContextPackReceiptBackup {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: {
    status: 'locally-valid';
    contents: WcpContextPackReceiptBackupContents;
    binding: PackSaveBinding;
    binding_state: 'embedded-only' | 'matches-expected-binding';
    document_sha256: string;
    input_files: number;
    input_bytes: number;
    observations: number;
    completeness: 'single-file-only' | 'relative-to-manifest';
    identity_state: 'not-authenticated';
    server_outcome: 'not-checked';
    content_state: 'not-checked';
    save_dispatch_state: 'not-sent';
    storage_access: 'not-performed';
  };
}

const messages = {
  INVALID_INPUT: 'Supply valid local backup inspection options and a local trace',
  CONTEXT_BACKUP_INVALID:
    'Supply one complete backup or exactly one manifest and all its volumes within the file limits',
  CONTEXT_BACKUP_BINDING_MISMATCH:
    'The backup does not match the complete expected binding; retain the original files',
  CONTEXT_BACKUP_DIGEST_MISMATCH:
    'A backup, manifest or observation does not match its SHA-256; retain the original files',
  CONTEXT_BACKUP_INTEGRITY_UNAVAILABLE: 'SHA-256 inspection is unavailable',
  CONTEXT_BACKUP_INSPECTION_CANCELED:
    'Stopped waiting for local backup inspection; no storage was accessed or save sent',
  CONTEXT_BACKUP_INSPECTION_TIMEOUT:
    'Local backup inspection exceeded its deadline; no storage was accessed or save sent',
  CONTEXT_BACKUP_INSPECTION_FAILED:
    'Could not inspect the complete backup; retain the original files',
} as const;
type FailureCode = keyof typeof messages;

function fail(code: FailureCode, trace: string) {
  return new ContractError(code, messages[code], {
    trace_id: trace,
    retryable: false,
    details: {
      identity_state: 'not-authenticated',
      server_outcome: 'not-checked',
      content_state: 'not-checked',
      save_dispatch_state: 'not-sent',
      storage_access: 'not-performed',
    },
  });
}
function validTrace(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
function settingsFor(input: WcpContextPackReceiptBackupInspectionOptions) {
  let trace = 'trace_sdk_context_backup_inspection';
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    const traceField = Object.getOwnPropertyDescriptor(input, 'trace_id');
    if (traceField && Object.hasOwn(traceField, 'value') && validTrace(traceField.value))
      trace = traceField.value;
    const prototype: unknown = Object.getPrototypeOf(input);
    const keys = Object.keys(input);
    const allowed = [
      'trace_id',
      'expected_binding',
      'expected_document_sha256',
      'timeout_ms',
      'signal',
    ];
    if (
      (prototype !== null && prototype !== Object.prototype) ||
      Reflect.ownKeys(input).length !== keys.length ||
      keys.some(
        (key) =>
          !allowed.includes(key) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key)!, 'value'),
      )
    )
      throw new TypeError();
    const row = Object.fromEntries(
      keys.map((key) => [key, Object.getOwnPropertyDescriptor(input, key)!.value]),
    ) as WcpContextPackReceiptBackupInspectionOptions;
    if (!validTrace(row.trace_id)) throw new TypeError();
    if (
      row.expected_document_sha256 !== undefined &&
      (typeof row.expected_document_sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(row.expected_document_sha256))
    )
      throw new TypeError();
    return {
      trace: row.trace_id,
      binding: row.expected_binding,
      digest: row.expected_document_sha256,
      timeout: row.timeout_ms === undefined ? 30_000 : row.timeout_ms,
      signal: row.signal,
    };
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
}

function captureBytes(input: string | Uint8Array): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  if (typeof input === 'string') {
    if (!input || input.length > PACK_RECEIPT_BACKUP_FILE_BYTES || /[\p{Cs}]/u.test(input))
      throw new TypeError();
    bytes = new TextEncoder().encode(input);
  } else {
    if (!(input instanceof Uint8Array)) throw new TypeError();
    const prototype: object = Object.getPrototypeOf(Uint8Array.prototype);
    const buffer: unknown = Object.getOwnPropertyDescriptor(prototype, 'buffer')!.get!.call(input);
    const size: number = Object.getOwnPropertyDescriptor(prototype, 'byteLength')!.get!.call(input);
    const offset: number = Object.getOwnPropertyDescriptor(prototype, 'byteOffset')!.get!.call(
      input,
    );
    if (!(buffer instanceof ArrayBuffer) || !size || size > PACK_RECEIPT_BACKUP_FILE_BYTES)
      throw new TypeError();
    // Copy native slots, including Buffer slices, without invoking a custom iterator.
    bytes = new Uint8Array(size);
    bytes.set(new Uint8Array(buffer, offset, size));
  }
  if (!bytes.byteLength || bytes.byteLength > PACK_RECEIPT_BACKUP_FILE_BYTES) throw new TypeError();
  return bytes;
}

function captureFiles(inputs: readonly (string | Uint8Array)[], check: () => void) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > PACK_RECEIPT_MAX_VOLUMES + 1)
    throw new TypeError();
  // Only a dense array of own data properties; never invoke caller-supplied getters/iterators.
  const length = inputs.length;
  if (Reflect.ownKeys(inputs).length !== length + 1) throw new TypeError();
  let totalBytes = 0;
  let manifest: PackReceiptVolumesFile | undefined;
  const backups: PackReceiptBackupCandidate[] = [];
  for (let index = 0; index < length; index++) {
    check();
    const field = Object.getOwnPropertyDescriptor(inputs, String(index));
    if (!field || !Object.hasOwn(field, 'value')) throw new TypeError();
    const bytes = captureBytes(field.value);
    totalBytes += bytes.byteLength;
    if (totalBytes > PACK_RECEIPT_VOLUMES_SET_BYTES) throw new TypeError();
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('document' in parsed))
      throw new TypeError();
    const document = parsed.document;
    if (
      document &&
      typeof document === 'object' &&
      'kind' in document &&
      document.kind === 'context-pack-save-history-volumes'
    ) {
      if (manifest || bytes.byteLength > PACK_RECEIPT_VOLUMES_FILE_BYTES) throw new TypeError();
      manifest = parsePackReceiptVolumesFile(parsed);
    } else {
      const file = parsePackReceiptBackupFile(parsed);
      backups.push({ file, raw: packReceiptBackupFileJson(file) });
    }
  }
  check();
  let contents: WcpContextPackReceiptBackupContents;
  if (length === 1 && !manifest && backups.length === 1) {
    contents = { kind: 'single', backup: backups[0]! };
  } else {
    if (!manifest || backups.length !== manifest.document.volumes.length) throw new TypeError();
    const manifestFile = manifest;
    const byDigest = new Map(backups.map((backup) => [backup.file.document_sha256, backup]));
    if (byDigest.size !== backups.length) throw new TypeError();
    let previous: string | undefined;
    let count = 0;
    const volumes = manifestFile.document.volumes.map((descriptor) => {
      check();
      const volume = byDigest.get(descriptor.document_sha256);
      if (!volume || volume.file.document.entries.length !== descriptor.entries)
        throw new TypeError();
      assertPackSaveBinding(volume.file.document.binding, manifestFile.document.binding);
      for (const entry of volume.file.document.entries) {
        if (previous !== undefined && entry.document_sha256 <= previous) throw new TypeError();
        previous = entry.document_sha256;
        count++;
      }
      return volume;
    });
    if (count !== manifestFile.document.total_entries) throw new TypeError();
    contents = {
      kind: 'volumes',
      collection: {
        file: manifestFile,
        raw: packReceiptVolumesFileJson(manifestFile),
        volumes,
      },
    };
  }
  check();
  return { contents, totalBytes, files: length };
}

async function verifyHash(raw: string, expected: string, budget: RequestBudget, trace: string) {
  budget.check();
  let digest: ArrayBuffer;
  try {
    if (typeof globalThis.crypto?.subtle?.digest !== 'function') throw new TypeError();
    const bytes = new TextEncoder().encode(raw);
    digest = await budget.wait(() => globalThis.crypto.subtle.digest('SHA-256', bytes));
    if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
  } catch {
    budget.check();
    throw fail('CONTEXT_BACKUP_INTEGRITY_UNAVAILABLE', trace);
  }
  budget.check();
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (actual !== expected) throw fail('CONTEXT_BACKUP_DIGEST_MISMATCH', trace);
}

/** Local integrity only; neither embedded identities nor historical server claims are authenticated. */
export async function inspectContextPackReceiptBackup(
  inputs: readonly (string | Uint8Array)[],
  options: WcpContextPackReceiptBackupInspectionOptions,
): Promise<WcpInspectedContextPackReceiptBackup> {
  const settings = settingsFor(options);
  const { trace } = settings;
  let budget: RequestBudget | undefined;
  try {
    try {
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw fail('INVALID_INPUT', trace);
    }
    budget.check();
    let expected: PackSaveBinding | undefined;
    try {
      expected =
        settings.binding === undefined ? undefined : parsePackSaveBinding(settings.binding);
    } catch {
      throw fail('INVALID_INPUT', trace);
    }
    let captured: ReturnType<typeof captureFiles>;
    try {
      captured = captureFiles(inputs, budget.check);
    } catch {
      budget.check();
      throw fail('CONTEXT_BACKUP_INVALID', trace);
    }
    const { contents } = captured;
    const root = contents.kind === 'single' ? contents.backup.file : contents.collection.file;
    const binding = parsePackSaveBinding(root.document.binding);
    if (expected !== undefined) {
      try {
        assertPackSaveBinding(binding, expected);
      } catch {
        throw fail('CONTEXT_BACKUP_BINDING_MISMATCH', trace);
      }
    }
    if (settings.digest !== undefined && settings.digest !== root.document_sha256)
      throw fail('CONTEXT_BACKUP_DIGEST_MISMATCH', trace);
    // Every input and expected constraint is now captured before the first await.
    const volumes = contents.kind === 'single' ? [contents.backup] : contents.collection.volumes;
    if (contents.kind === 'volumes')
      await verifyHash(
        packReceiptVolumesDocumentJson(contents.collection.file.document),
        contents.collection.file.document_sha256,
        budget,
        trace,
      );
    let observations = 0;
    for (const volume of volumes) {
      budget.check();
      await verifyHash(
        packReceiptBackupDocumentJson(volume.file.document),
        volume.file.document_sha256,
        budget,
        trace,
      );
      for (const entry of volume.file.document.entries) {
        budget.check();
        await verifyHash(
          contextPackSaveReceiptDocumentJson(entry.document),
          entry.document_sha256,
          budget,
          trace,
        );
        observations++;
      }
    }
    budget.check();
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: {
        status: 'locally-valid',
        contents,
        binding,
        binding_state: expected === undefined ? 'embedded-only' : 'matches-expected-binding',
        document_sha256: root.document_sha256,
        input_files: captured.files,
        input_bytes: captured.totalBytes,
        observations,
        completeness: contents.kind === 'single' ? 'single-file-only' : 'relative-to-manifest',
        identity_state: 'not-authenticated',
        server_outcome: 'not-checked',
        content_state: 'not-checked',
        save_dispatch_state: 'not-sent',
        storage_access: 'not-performed',
      },
    };
  } catch (error) {
    let finalError = error;
    try {
      budget?.check();
    } catch (stopped) {
      finalError = stopped;
    }
    const envelope =
      finalError instanceof ContractError && finalError.envelope.trace_id === trace
        ? finalError.envelope
        : undefined;
    const code: FailureCode =
      envelope?.code === 'GATEWAY_REQUEST_CANCELED'
        ? 'CONTEXT_BACKUP_INSPECTION_CANCELED'
        : envelope?.code === 'GATEWAY_REQUEST_TIMEOUT'
          ? 'CONTEXT_BACKUP_INSPECTION_TIMEOUT'
          : envelope && Object.hasOwn(messages, envelope.code)
            ? (envelope.code as FailureCode)
            : 'CONTEXT_BACKUP_INSPECTION_FAILED';
    throw fail(code, trace);
  } finally {
    try {
      budget?.close();
    } catch {
      /* Cleanup must not replace the inspection result. */
    }
  }
}
