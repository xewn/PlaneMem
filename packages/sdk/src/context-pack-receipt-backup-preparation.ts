import {
  ContractError,
  CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES,
  PACK_RECEIPT_BACKUP_MAX_ENTRIES,
  PACK_RECEIPT_VOLUMES_MAX_ENTRIES,
  assertPackSaveBinding,
  contextPackSaveReceiptDocumentJson,
  packReceiptBackupDocumentJson,
  packReceiptBackupFileJson,
  packReceiptVolumesDocumentJson,
  packReceiptVolumesFileJson,
  parseContextPackSaveReceiptFile,
  parsePackReceiptBackupDocument,
  parsePackReceiptBackupFile,
  parsePackReceiptVolumesDocument,
  parsePackReceiptVolumesFile,
  parsePackSaveBinding,
  type ContextPackSaveReceiptFile,
  type PackReceiptBackupCandidate,
  type PackSaveBinding,
} from '@planemem/contracts';
import { captureContextBackupBytes, contextBackupSha256 } from './context-pack-backup-local.js';
import type { WcpContextPackReceiptBackupContents } from './context-pack-receipt-backup-inspection.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpContextPackReceiptBackupPreparationOptions {
  trace_id: string;
  /** Required even for empty input; this is an equality constraint, not authentication. */
  binding: PackSaveBinding;
  /** Single: at most 100 observations. Volumes: at most 1000, in groups of 100. */
  format: 'single' | 'volumes';
  timeout_ms?: number;
  signal?: AbortSignal;
}

export interface WcpPreparedContextPackReceiptBackup {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: {
    status: 'prepared-not-saved';
    contents: WcpContextPackReceiptBackupContents;
    binding: PackSaveBinding;
    document_sha256: string;
    input_files: number;
    input_bytes: number;
    observations: number;
    output_files: number;
    output_bytes: number;
    completeness: 'supplied-observations-only';
    identity_state: 'not-authenticated';
    server_outcome: 'not-checked';
    content_state: 'not-checked';
    save_dispatch_state: 'not-sent';
    storage_access: 'not-performed';
  };
}

const messages = {
  INVALID_INPUT:
    'Supply a local trace, complete original binding and explicit single or volumes format',
  CONTEXT_BACKUP_OBSERVATION_INVALID:
    'Supply only complete historical observation files within the selected count and size limits',
  CONTEXT_BACKUP_OBSERVATION_DUPLICATE:
    'The same observation was supplied more than once; retain the inputs and choose each observation once',
  CONTEXT_BACKUP_BINDING_MISMATCH:
    'An observation differs from the supplied complete original binding',
  CONTEXT_BACKUP_DIGEST_MISMATCH: 'An observation does not match its saved document SHA-256',
  CONTEXT_BACKUP_INTEGRITY_UNAVAILABLE: 'SHA-256 preparation is unavailable',
  CONTEXT_BACKUP_PREPARATION_CANCELED:
    'Stopped waiting for local backup preparation; no files were saved or requests sent',
  CONTEXT_BACKUP_PREPARATION_TIMEOUT:
    'Local backup preparation exceeded its deadline; no files were saved or requests sent',
  CONTEXT_BACKUP_PREPARATION_FAILED:
    'Could not prepare the complete backup within its format limits; retain the observation files',
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
function settingsFor(input: WcpContextPackReceiptBackupPreparationOptions) {
  let trace = 'trace_sdk_context_backup_preparation';
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    const traceField = Object.getOwnPropertyDescriptor(input, 'trace_id');
    if (traceField && Object.hasOwn(traceField, 'value') && validTrace(traceField.value))
      trace = traceField.value;
    const prototype: unknown = Object.getPrototypeOf(input);
    const keys = Object.keys(input);
    const allowed = ['trace_id', 'binding', 'format', 'timeout_ms', 'signal'];
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
    ) as WcpContextPackReceiptBackupPreparationOptions;
    if (!validTrace(row.trace_id) || !['single', 'volumes'].includes(row.format))
      throw new TypeError();
    return {
      trace: row.trace_id,
      binding: row.binding,
      format: row.format,
      timeout: row.timeout_ms === undefined ? 30_000 : row.timeout_ms,
      signal: row.signal,
    };
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
}

function captureObservations(
  inputs: readonly (string | Uint8Array)[],
  maximum: number,
  binding: PackSaveBinding,
  budget: RequestBudget,
  trace: string,
) {
  if (!Array.isArray(inputs)) throw fail('CONTEXT_BACKUP_OBSERVATION_INVALID', trace);
  const length = inputs.length;
  if (length > maximum || Reflect.ownKeys(inputs).length !== length + 1)
    throw fail('CONTEXT_BACKUP_OBSERVATION_INVALID', trace);
  const entries: ContextPackSaveReceiptFile[] = [];
  const seen = new Set<string>();
  let inputBytes = 0;
  for (let index = 0; index < length; index++) {
    budget.check();
    let file: ContextPackSaveReceiptFile;
    try {
      const field = Object.getOwnPropertyDescriptor(inputs, String(index));
      if (!field || !Object.hasOwn(field, 'value')) throw new TypeError();
      const bytes = captureContextBackupBytes(field.value, CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES);
      inputBytes += bytes.byteLength;
      file = parseContextPackSaveReceiptFile(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
    } catch {
      budget.check();
      throw fail('CONTEXT_BACKUP_OBSERVATION_INVALID', trace);
    }
    try {
      assertPackSaveBinding(file.document.original.binding, binding);
    } catch {
      throw fail('CONTEXT_BACKUP_BINDING_MISMATCH', trace);
    }
    if (seen.has(file.document_sha256)) throw fail('CONTEXT_BACKUP_OBSERVATION_DUPLICATE', trace);
    seen.add(file.document_sha256);
    entries.push(file);
  }
  entries.sort((left, right) =>
    left.document_sha256 < right.document_sha256
      ? -1
      : left.document_sha256 > right.document_sha256
        ? 1
        : 0,
  );
  budget.check();
  return { entries, inputBytes };
}

async function digest(raw: string, budget: RequestBudget, trace: string) {
  try {
    return await contextBackupSha256(raw, budget);
  } catch {
    budget.check();
    throw fail('CONTEXT_BACKUP_INTEGRITY_UNAVAILABLE', trace);
  }
}
async function makeVolume(
  entries: ContextPackSaveReceiptFile[],
  binding: PackSaveBinding,
  budget: RequestBudget,
  trace: string,
): Promise<PackReceiptBackupCandidate> {
  budget.check();
  const document = parsePackReceiptBackupDocument({
    schema_version: 1,
    kind: 'context-pack-save-history-backup',
    binding,
    entries,
  });
  const document_sha256 = await digest(packReceiptBackupDocumentJson(document), budget, trace);
  budget.check();
  const file = parsePackReceiptBackupFile({ document, document_sha256 });
  return { file, raw: packReceiptBackupFileJson(file) };
}

/** Repackage existing observations only. Never infer a complete browser/server history or save files. */
export async function prepareContextPackReceiptBackup(
  inputs: readonly (string | Uint8Array)[],
  options: WcpContextPackReceiptBackupPreparationOptions,
): Promise<WcpPreparedContextPackReceiptBackup> {
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
    let binding: PackSaveBinding;
    try {
      binding = parsePackSaveBinding(settings.binding);
    } catch {
      throw fail('INVALID_INPUT', trace);
    }
    const { entries, inputBytes } = captureObservations(
      inputs,
      settings.format === 'single'
        ? PACK_RECEIPT_BACKUP_MAX_ENTRIES
        : PACK_RECEIPT_VOLUMES_MAX_ENTRIES,
      binding,
      budget,
      trace,
    );
    // No caller-owned array, bytes or binding survives the first await.
    for (const entry of entries) {
      if (
        (await digest(contextPackSaveReceiptDocumentJson(entry.document), budget, trace)) !==
        entry.document_sha256
      )
        throw fail('CONTEXT_BACKUP_DIGEST_MISMATCH', trace);
    }
    const volumes: PackReceiptBackupCandidate[] = [];
    for (
      let offset = 0;
      offset < Math.max(1, entries.length);
      offset += PACK_RECEIPT_BACKUP_MAX_ENTRIES
    )
      volumes.push(
        await makeVolume(
          entries.slice(offset, offset + PACK_RECEIPT_BACKUP_MAX_ENTRIES),
          binding,
          budget,
          trace,
        ),
      );
    let contents: WcpContextPackReceiptBackupContents;
    if (settings.format === 'single') {
      contents = { kind: 'single', backup: volumes[0]! };
    } else {
      const document = parsePackReceiptVolumesDocument({
        schema_version: 1,
        kind: 'context-pack-save-history-volumes',
        binding,
        total_entries: entries.length,
        volumes: volumes.map((volume, index) => ({
          index: index + 1,
          entries: volume.file.document.entries.length,
          document_sha256: volume.file.document_sha256,
        })),
      });
      const document_sha256 = await digest(packReceiptVolumesDocumentJson(document), budget, trace);
      budget.check();
      const file = parsePackReceiptVolumesFile({ document, document_sha256 });
      contents = {
        kind: 'volumes',
        collection: { file, raw: packReceiptVolumesFileJson(file), volumes },
      };
    }
    const root = contents.kind === 'single' ? contents.backup : contents.collection;
    const raws =
      contents.kind === 'single' ? [root.raw] : [root.raw, ...volumes.map((volume) => volume.raw)];
    const outputBytes = raws.reduce(
      (sum, raw) => sum + new TextEncoder().encode(raw).byteLength,
      0,
    );
    budget.check();
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: {
        status: 'prepared-not-saved',
        contents,
        binding,
        document_sha256: root.file.document_sha256,
        input_files: entries.length,
        input_bytes: inputBytes,
        observations: entries.length,
        output_files: raws.length,
        output_bytes: outputBytes,
        completeness: 'supplied-observations-only',
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
        ? 'CONTEXT_BACKUP_PREPARATION_CANCELED'
        : envelope?.code === 'GATEWAY_REQUEST_TIMEOUT'
          ? 'CONTEXT_BACKUP_PREPARATION_TIMEOUT'
          : envelope && Object.hasOwn(messages, envelope.code)
            ? (envelope.code as FailureCode)
            : 'CONTEXT_BACKUP_PREPARATION_FAILED';
    throw fail(code, trace);
  } finally {
    try {
      budget?.close();
    } catch {
      /* Cleanup must not replace the complete result. */
    }
  }
}
