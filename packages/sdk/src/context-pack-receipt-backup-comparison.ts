import {
  ContractError,
  PACK_RECEIPT_BACKUP_FILE_BYTES,
  PACK_RECEIPT_MAX_VOLUMES,
  PACK_RECEIPT_VOLUMES_SET_BYTES,
  contextPackSaveReceiptFileJson,
  encodePackSaveOriginal,
  parsePackSaveBinding,
  syncJsonSnapshot,
  type ContextPackSaveReceiptFile,
  type PackSaveBinding,
} from '@planemem/contracts';
import { captureContextBackupBytes, contextBackupSha256 } from './context-pack-backup-local.js';
import {
  inspectContextPackReceiptBackup,
  type WcpInspectedContextPackReceiptBackup,
} from './context-pack-receipt-backup-inspection.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export const CONTEXT_PACK_BACKUP_COMPARISON_BYTES = 4 * 1024 * 1024;

export interface WcpContextPackReceiptBackupComparisonOptions {
  trace_id: string;
  expected_binding?: PackSaveBinding;
  expected_from_document_sha256?: string;
  expected_to_document_sha256?: string;
  timeout_ms?: number;
  signal?: AbortSignal;
}

export interface WcpContextPackReceiptBackupComparisonSide {
  kind: 'single' | 'volumes';
  document_sha256: string;
  input_files: number;
  input_bytes: number;
  observations: number;
  completeness: 'single-file-only' | 'relative-to-manifest';
}

export interface WcpContextPackReceiptBackupComparisonEntry {
  document_sha256: string;
  request_key: string;
  observed_at: string;
  status: 'recorded' | 'not-observed';
  presence: 'both' | 'from-only' | 'to-only';
}

export interface WcpContextPackReceiptBackupRequestConflict {
  request_key: string;
  variants: { original_sha256: string; observation_digests: string[] }[];
}

export interface WcpComparedContextPackReceiptBackups {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: {
    status: 'backups-compared';
    binding: PackSaveBinding;
    binding_state: 'matching-embedded-bindings' | 'matches-expected-binding';
    from: WcpContextPackReceiptBackupComparisonSide;
    to: WcpContextPackReceiptBackupComparisonSide;
    comparison: {
      same_observations: boolean;
      shared_observations: number;
      from_only_observations: number;
      to_only_observations: number;
      entries: WcpContextPackReceiptBackupComparisonEntry[];
      conflicting_request_keys: WcpContextPackReceiptBackupRequestConflict[];
    };
    comparison_origin: 'local';
    comparison_scope: 'supplied-backups-only';
    mutation_eligibility: 'not-established';
    observation_state: 'historical';
    identity_state: 'not-authenticated';
    server_outcome: 'not-checked';
    content_state: 'not-checked';
    source_state: 'not-checked';
    save_dispatch_state: 'not-sent';
    storage_access: 'not-performed';
  };
}

const messages = {
  INVALID_INPUT: 'Supply valid local backup comparison options and a local trace',
  CONTEXT_BACKUP_INVALID: 'Supply two complete backup sets within the file and collection limits',
  CONTEXT_BACKUP_BINDING_MISMATCH:
    'Both backups must match the same complete original binding and any expected binding',
  CONTEXT_BACKUP_DIGEST_MISMATCH:
    'A backup, manifest or observation does not match its SHA-256 or expected root digest',
  CONTEXT_BACKUP_INTEGRITY_UNAVAILABLE: 'SHA-256 comparison is unavailable',
  CONTEXT_BACKUP_COMPARISON_CONFLICT:
    'The same digest refers to different canonical contents; retain both original backup sets',
  CONTEXT_BACKUP_COMPARISON_CANCELED:
    'Stopped waiting for local backup comparison; no storage was accessed or save sent',
  CONTEXT_BACKUP_COMPARISON_TIMEOUT:
    'Local backup comparison exceeded its deadline; no storage was accessed or save sent',
  CONTEXT_BACKUP_COMPARISON_FAILED:
    'Could not compare the complete backups within the result limit; retain both original backup sets',
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
function settingsFor(input: WcpContextPackReceiptBackupComparisonOptions) {
  let trace = 'trace_sdk_context_backup_comparison';
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
      'expected_from_document_sha256',
      'expected_to_document_sha256',
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
    ) as WcpContextPackReceiptBackupComparisonOptions;
    if (!validTrace(row.trace_id)) throw new TypeError();
    for (const digest of [row.expected_from_document_sha256, row.expected_to_document_sha256])
      if (digest !== undefined && (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)))
        throw new TypeError();
    return {
      trace: row.trace_id,
      binding: row.expected_binding,
      fromDigest: row.expected_from_document_sha256,
      toDigest: row.expected_to_document_sha256,
      timeout: row.timeout_ms === undefined ? 30_000 : row.timeout_ms,
      signal: row.signal,
    };
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
}

function captureFiles(inputs: readonly (string | Uint8Array)[], check: () => void) {
  if (!Array.isArray(inputs)) throw new TypeError();
  const length = inputs.length;
  if (
    length < 1 ||
    length > PACK_RECEIPT_MAX_VOLUMES + 1 ||
    Reflect.ownKeys(inputs).length !== length + 1
  )
    throw new TypeError();
  const files: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  for (let index = 0; index < length; index++) {
    check();
    const field = Object.getOwnPropertyDescriptor(inputs, String(index));
    if (!field || !Object.hasOwn(field, 'value')) throw new TypeError();
    const captured = captureContextBackupBytes(field.value, PACK_RECEIPT_BACKUP_FILE_BYTES);
    bytes += captured.byteLength;
    if (bytes > PACK_RECEIPT_VOLUMES_SET_BYTES) throw new TypeError();
    files.push(captured);
  }
  check();
  return files;
}

function observations(inspection: WcpInspectedContextPackReceiptBackup, check: () => void) {
  const { contents } = inspection.data;
  const volumes = contents.kind === 'single' ? [contents.backup] : contents.collection.volumes;
  const result = new Map<string, ContextPackSaveReceiptFile>();
  for (const volume of volumes)
    for (const entry of volume.file.document.entries) {
      check();
      result.set(entry.document_sha256, entry);
    }
  return result;
}
function side(
  inspection: WcpInspectedContextPackReceiptBackup,
): WcpContextPackReceiptBackupComparisonSide {
  const data = inspection.data;
  return {
    kind: data.contents.kind,
    document_sha256: data.document_sha256,
    input_files: data.input_files,
    input_bytes: data.input_bytes,
    observations: data.observations,
    completeness: data.completeness,
  };
}

/** Compare supplied historical observations only; never choose a winner or authorize a mutation. */
export async function compareContextPackReceiptBackups(
  fromFiles: readonly (string | Uint8Array)[],
  toFiles: readonly (string | Uint8Array)[],
  options: WcpContextPackReceiptBackupComparisonOptions,
): Promise<WcpComparedContextPackReceiptBackups> {
  const settings = settingsFor(options);
  const { trace } = settings;
  let budget: RequestBudget | undefined;
  try {
    try {
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw fail('INVALID_INPUT', trace);
    }
    const active = budget;
    active.check();
    let expected: PackSaveBinding | undefined;
    try {
      expected =
        settings.binding === undefined ? undefined : parsePackSaveBinding(settings.binding);
    } catch {
      throw fail('INVALID_INPUT', trace);
    }
    let fromInputs: ReturnType<typeof captureFiles>;
    let toInputs: ReturnType<typeof captureFiles>;
    try {
      fromInputs = captureFiles(fromFiles, active.check);
      toInputs = captureFiles(toFiles, active.check);
    } catch {
      active.check();
      throw fail('CONTEXT_BACKUP_INVALID', trace);
    }
    // Both entire input sets and all constraints are detached before either inspection awaits.
    const from = await active.wait(() =>
      inspectContextPackReceiptBackup(fromInputs, {
        trace_id: trace,
        expected_binding: expected,
        expected_document_sha256: settings.fromDigest,
        timeout_ms: settings.timeout,
        signal: active.signal,
      }),
    );
    const to = await active.wait(() =>
      inspectContextPackReceiptBackup(toInputs, {
        trace_id: trace,
        expected_binding: from.data.binding,
        expected_document_sha256: settings.toDigest,
        timeout_ms: settings.timeout,
        signal: active.signal,
      }),
    );
    active.check();
    const left = observations(from, active.check);
    const right = observations(to, active.check);
    const digests = [...new Set([...left.keys(), ...right.keys()])].sort();
    const entries: WcpContextPackReceiptBackupComparisonEntry[] = [];
    const requests = new Map<string, Map<string, string[]>>();
    let shared = 0;
    let fromOnly = 0;
    let toOnly = 0;
    for (const digest of digests) {
      active.check();
      const before = left.get(digest);
      const after = right.get(digest);
      if (before && after) {
        if (contextPackSaveReceiptFileJson(before) !== contextPackSaveReceiptFileJson(after))
          throw fail('CONTEXT_BACKUP_COMPARISON_CONFLICT', trace);
        shared++;
      } else if (before) fromOnly++;
      else toOnly++;
      const file = (before ?? after)!;
      const { original, observed_at, receipt } = file.document;
      entries.push({
        document_sha256: digest,
        request_key: original.request_key,
        observed_at,
        status: receipt.data.status,
        presence: before && after ? 'both' : before ? 'from-only' : 'to-only',
      });
      const raw = encodePackSaveOriginal(original);
      let originals = requests.get(original.request_key);
      if (!originals) {
        originals = new Map();
        requests.set(original.request_key, originals);
      }
      const references = originals.get(raw);
      if (references) references.push(digest);
      else originals.set(raw, [digest]);
    }
    const conflicts: WcpContextPackReceiptBackupRequestConflict[] = [];
    for (const key of [...requests.keys()].sort()) {
      active.check();
      const originals = requests.get(key)!;
      if (originals.size < 2) continue;
      const variants: WcpContextPackReceiptBackupRequestConflict['variants'] = [];
      const hashes = new Set<string>();
      for (const [raw, references] of originals) {
        let digest: string;
        try {
          digest = await contextBackupSha256(raw, active);
        } catch {
          active.check();
          throw fail('CONTEXT_BACKUP_INTEGRITY_UNAVAILABLE', trace);
        }
        if (hashes.has(digest)) throw fail('CONTEXT_BACKUP_COMPARISON_CONFLICT', trace);
        hashes.add(digest);
        variants.push({ original_sha256: digest, observation_digests: references });
      }
      variants.sort((a, b) =>
        a.original_sha256 < b.original_sha256 ? -1 : a.original_sha256 > b.original_sha256 ? 1 : 0,
      );
      conflicts.push({ request_key: key, variants });
    }
    const result: WcpComparedContextPackReceiptBackups = {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: {
        status: 'backups-compared',
        binding: from.data.binding,
        binding_state:
          expected === undefined ? 'matching-embedded-bindings' : 'matches-expected-binding',
        from: side(from),
        to: side(to),
        comparison: {
          same_observations: fromOnly === 0 && toOnly === 0,
          shared_observations: shared,
          from_only_observations: fromOnly,
          to_only_observations: toOnly,
          entries,
          conflicting_request_keys: conflicts,
        },
        comparison_origin: 'local',
        comparison_scope: 'supplied-backups-only',
        mutation_eligibility: 'not-established',
        observation_state: 'historical',
        identity_state: 'not-authenticated',
        server_outcome: 'not-checked',
        content_state: 'not-checked',
        source_state: 'not-checked',
        save_dispatch_state: 'not-sent',
        storage_access: 'not-performed',
      },
    };
    active.check();
    const detached = JSON.parse(
      syncJsonSnapshot(result, CONTEXT_PACK_BACKUP_COMPARISON_BYTES),
    ) as WcpComparedContextPackReceiptBackups;
    active.check();
    return detached;
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
      envelope?.code === 'GATEWAY_REQUEST_CANCELED' ||
      envelope?.code === 'CONTEXT_BACKUP_INSPECTION_CANCELED'
        ? 'CONTEXT_BACKUP_COMPARISON_CANCELED'
        : envelope?.code === 'GATEWAY_REQUEST_TIMEOUT' ||
            envelope?.code === 'CONTEXT_BACKUP_INSPECTION_TIMEOUT'
          ? 'CONTEXT_BACKUP_COMPARISON_TIMEOUT'
          : envelope && Object.hasOwn(messages, envelope.code)
            ? (envelope.code as FailureCode)
            : 'CONTEXT_BACKUP_COMPARISON_FAILED';
    throw fail(code, trace);
  } finally {
    try {
      budget?.close();
    } catch {
      /* Cleanup must not replace the complete comparison result. */
    }
  }
}
