import {
  ContractError,
  parseSyncEventReceiptDocument,
  parseSyncEventReceiptEnvelope,
  parseSyncEventReceiptFile,
  parseSyncEventReceiptQuery,
  syncEventReceiptDocumentJson,
  syncJsonSnapshot,
  SYNC_EVENT_RECEIPT_FILE_BYTES,
  type SyncEventReceiptEnvelope,
  type SyncEventReceiptFile,
  type SyncEventReceiptQuery,
} from '@planemem/contracts';
import { createRequestBudget, type RequestBudget } from './request-budget.js';
export type {
  SyncEventReceiptEnvelope,
  SyncEventReceiptFile,
  SyncEventReceiptDocument,
  SyncEventReceiptQuery,
} from '@planemem/contracts';

export interface WcpSyncEventReceiptFileOptions {
  /** Trace for this local operation; the historical receipt's trace is never replaced. */
  trace_id: string;
  /** Local processing/digest wait: default 30 seconds, between 1 and 90,000 milliseconds. */
  timeout_ms?: number;
  signal?: AbortSignal;
}
export interface WcpInspectSyncEventReceiptFileOptions extends WcpSyncEventReceiptFileOptions {
  /** Optional complete original to which the selected historical file must belong. */
  expected_query?: SyncEventReceiptQuery;
  expected_document_sha256?: string;
}
interface LocalReceiptFileResult {
  schema_version: 1;
  trace_id: string;
  file: SyncEventReceiptFile;
  /** Independent original query, suitable for a later explicit getSyncEventReceipt call. */
  query: SyncEventReceiptQuery;
  file_bytes: number;
  /** Hash of the exact prepared or inspected UTF-8 bytes, including any input BOM/whitespace. */
  file_sha256: string;
  provenance: 'local-capture-not-authenticated';
  current_server_state: 'not-queried';
  local_queue_state: 'not-read';
  event_application: 'not-verified';
  filesystem_access: 'not-performed';
}
export interface WcpPreparedSyncEventReceiptFile extends LocalReceiptFileResult {
  state: 'prepared-not-saved';
  bytes: Uint8Array;
}
export interface WcpInspectedSyncEventReceiptFile extends LocalReceiptFileResult {
  state: 'inspected-historical';
  input_representation: 'utf8-bytes' | 'json-text';
}

const messages = {
  INVALID_INPUT:
    'Supply valid local file options, trace and optional original query/digest constraints',
  SYNC_RECEIPT_FILE_INVALID:
    'The complete original receipt file is invalid or exceeds its size limit',
  SYNC_RECEIPT_FILE_DIGEST_MISMATCH: 'The receipt document does not match its saved digest',
  SYNC_RECEIPT_FILE_BINDING_MISMATCH:
    'The file differs from the selected original query or document digest',
  SYNC_RECEIPT_FILE_INTEGRITY_UNAVAILABLE: 'SHA-256 preparation or verification is unavailable',
  SYNC_RECEIPT_FILE_CANCELED: 'Stopped waiting for this local receipt file operation',
  SYNC_RECEIPT_FILE_TIMEOUT: 'This local receipt file operation exceeded its waiting period',
} as const;
type FailureCode = keyof typeof messages;
type Operation = 'prepare' | 'inspect';
function fail(code: FailureCode, trace: string, operation: Operation) {
  return new ContractError(code, messages[code], {
    trace_id: trace,
    retryable: false,
    details: { operation, filesystem_access: 'not-performed', current_server_state: 'not-queried' },
  });
}
function validTrace(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value.trim()) &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function optionsFor(input: unknown, operation: Operation) {
  let trace = 'trace_sdk_sync_receipt_file';
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    const traceField = Object.getOwnPropertyDescriptor(input, 'trace_id');
    if (traceField && Object.hasOwn(traceField, 'value') && validTrace(traceField.value))
      trace = traceField.value;
    const prototype: unknown = Object.getPrototypeOf(input);
    const fields = Object.keys(input);
    const allowed =
      operation === 'inspect'
        ? ['trace_id', 'timeout_ms', 'signal', 'expected_query', 'expected_document_sha256']
        : ['trace_id', 'timeout_ms', 'signal'];
    if (
      (prototype !== null && prototype !== Object.prototype) ||
      Reflect.ownKeys(input).length !== fields.length ||
      fields.some(
        (key) =>
          !allowed.includes(key) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key)!, 'value'),
      )
    )
      throw new TypeError();
    // Read only validated own data properties; inherited options must never affect the operation.
    const row = Object.create(null) as Record<string, unknown>;
    for (const key of fields)
      row[key] = Object.getOwnPropertyDescriptor(input, key)!.value as unknown;
    if (!validTrace(row.trace_id)) throw new TypeError();
    trace = row.trace_id;
    const timeout = row.timeout_ms === undefined ? 30_000 : row.timeout_ms;
    if (
      typeof timeout !== 'number' ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 90_000
    )
      throw new TypeError();
    if (row.expected_document_sha256 !== undefined && !validDigest(row.expected_document_sha256))
      throw new TypeError();
    const budget = createRequestBudget(trace, timeout, row.signal as AbortSignal | undefined);
    return {
      trace,
      budget,
      expectedQuery: row.expected_query,
      expectedDigest: row.expected_document_sha256 as string | undefined,
    };
  } catch {
    throw fail('INVALID_INPUT', trace, operation);
  }
}
type Settings = ReturnType<typeof optionsFor>;
async function localOperation<T>(
  options: unknown,
  operation: Operation,
  work: (settings: Settings) => Promise<T>,
): Promise<T> {
  const settings = optionsFor(options, operation);
  const { trace, budget } = settings;
  try {
    budget.check();
    const result = await work(settings);
    budget.check();
    return result;
  } catch (error) {
    let failure = error;
    try {
      budget.check();
    } catch (stopped) {
      failure = stopped;
    }
    const envelope =
      failure instanceof ContractError && failure.envelope.trace_id === trace
        ? failure.envelope
        : undefined;
    const code =
      envelope?.code === 'GATEWAY_REQUEST_CANCELED'
        ? 'SYNC_RECEIPT_FILE_CANCELED'
        : envelope?.code === 'GATEWAY_REQUEST_TIMEOUT'
          ? 'SYNC_RECEIPT_FILE_TIMEOUT'
          : envelope && Object.hasOwn(messages, envelope.code)
            ? (envelope.code as FailureCode)
            : 'SYNC_RECEIPT_FILE_INVALID';
    throw fail(code, trace, operation);
  } finally {
    try {
      budget.close();
    } catch {
      // An external signal's cleanup must not replace the bounded result or error.
    }
  }
}
async function hash(bytes: Uint8Array, budget: RequestBudget, trace: string, operation: Operation) {
  budget.check();
  try {
    if (typeof globalThis.crypto?.subtle?.digest !== 'function') throw new TypeError();
    // Own exactly these bytes even if a future caller supplies a view into a larger allocation.
    const snapshot = new Uint8Array(bytes);
    const digest = await budget.wait(() =>
      globalThis.crypto.subtle.digest('SHA-256', snapshot.buffer as ArrayBuffer),
    );
    if (digest.byteLength !== 32) throw new TypeError();
    budget.check();
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  } catch {
    budget.check();
    throw fail('SYNC_RECEIPT_FILE_INTEGRITY_UNAVAILABLE', trace, operation);
  }
}
function inputBytes(input: string | Uint8Array) {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    if (!input || input.length > SYNC_EVENT_RECEIPT_FILE_BYTES || /[\p{Cs}]/u.test(input))
      throw new TypeError();
    bytes = new TextEncoder().encode(input);
  } else {
    if (
      !(input instanceof Uint8Array) ||
      !(input.buffer instanceof ArrayBuffer) ||
      input.byteLength === 0 ||
      input.byteLength > SYNC_EVENT_RECEIPT_FILE_BYTES
    )
      throw new TypeError();
    // SharedArrayBuffer is rejected; copying it cannot promise a coherent original snapshot.
    bytes = new Uint8Array(input);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > SYNC_EVENT_RECEIPT_FILE_BYTES)
    throw new TypeError();
  return bytes;
}
function resultBase(
  file: SyncEventReceiptFile,
  bytes: Uint8Array,
  fileHash: string,
  trace: string,
): LocalReceiptFileResult {
  const { identity, event } = file.document.receipt.data;
  return {
    schema_version: 1,
    trace_id: trace,
    file,
    query: parseSyncEventReceiptQuery({ identity, event }),
    file_bytes: bytes.byteLength,
    file_sha256: fileHash,
    provenance: 'local-capture-not-authenticated',
    current_server_state: 'not-queried',
    local_queue_state: 'not-read',
    event_application: 'not-verified',
    filesystem_access: 'not-performed',
  };
}

/** Prepare complete interoperable bytes; the caller owns explicit persistence and read-back. */
export function prepareSyncEventReceiptFile(
  receipt: SyncEventReceiptEnvelope,
  options: WcpSyncEventReceiptFileOptions,
): Promise<WcpPreparedSyncEventReceiptFile> {
  return localOperation<WcpPreparedSyncEventReceiptFile>(
    options,
    'prepare',
    async ({ trace, budget }) => {
      // Parsing snapshots the entire receipt before the first asynchronous digest wait.
      const document = parseSyncEventReceiptDocument({
        schema_version: 1,
        kind: 'workctx.sync-event-receipt',
        receipt,
      });
      const documentBytes = new TextEncoder().encode(syncEventReceiptDocumentJson(document));
      const documentHash = await hash(documentBytes, budget, trace, 'prepare');
      const file = parseSyncEventReceiptFile({ document, document_sha256: documentHash });
      const bytes = new TextEncoder().encode(syncJsonSnapshot(file, SYNC_EVENT_RECEIPT_FILE_BYTES));
      const fileHash = await hash(bytes, budget, trace, 'prepare');
      return { ...resultBase(file, bytes, fileHash, trace), state: 'prepared-not-saved', bytes };
    },
  );
}

/** Inspect memory only; neither a path, a URL, credentials nor a WcpClient is required or used. */
export function inspectSyncEventReceiptFile(
  input: string | Uint8Array,
  options: WcpInspectSyncEventReceiptFileOptions,
): Promise<WcpInspectedSyncEventReceiptFile> {
  return localOperation<WcpInspectedSyncEventReceiptFile>(
    options,
    'inspect',
    async ({ trace, budget, expectedQuery, expectedDigest }) => {
      let selected: SyncEventReceiptQuery | undefined;
      if (expectedQuery !== undefined) {
        try {
          selected = parseSyncEventReceiptQuery(expectedQuery);
        } catch {
          throw fail('INVALID_INPUT', trace, 'inspect');
        }
      }
      const bytes = inputBytes(input);
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
      const file = parseSyncEventReceiptFile(JSON.parse(raw) as unknown);
      const documentBytes = new TextEncoder().encode(syncEventReceiptDocumentJson(file.document));
      const documentHash = await hash(documentBytes, budget, trace, 'inspect');
      if (documentHash !== file.document_sha256)
        throw fail('SYNC_RECEIPT_FILE_DIGEST_MISMATCH', trace, 'inspect');
      if (expectedDigest !== undefined && expectedDigest !== documentHash)
        throw fail('SYNC_RECEIPT_FILE_BINDING_MISMATCH', trace, 'inspect');
      if (selected) {
        try {
          parseSyncEventReceiptEnvelope(
            file.document.receipt,
            selected,
            file.document.receipt.trace_id,
          );
        } catch {
          throw fail('SYNC_RECEIPT_FILE_BINDING_MISMATCH', trace, 'inspect');
        }
      }
      const fileHash = await hash(bytes, budget, trace, 'inspect');
      return {
        ...resultBase(file, bytes, fileHash, trace),
        state: 'inspected-historical',
        input_representation: typeof input === 'string' ? 'json-text' : 'utf8-bytes',
      };
    },
  );
}
