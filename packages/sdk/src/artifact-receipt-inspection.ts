import {
  ARTIFACT_SAVED_RECEIPT_BYTES,
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  parseArtifactReceiptEnvelope,
  parseArtifactReceiptQuery,
  parseSavedArtifactReceipt,
  syncJsonSnapshot,
  type ArtifactReceiptEnvelope,
  type ArtifactReceiptQuery,
  type ParsedSavedArtifactReceipt,
} from '@planemem/contracts';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpArtifactReceiptInspectionOptions {
  /** Identifies this local operation; the receipt retains its original trace. */
  trace_id: string;
  /** Full independent identity/command original, never a current-session identity. */
  expected_original?: ArtifactReceiptQuery;
  /** SHA-256 of the exact UTF-8 input, including BOM/whitespace. */
  expected_receipt_sha256?: string;
  /** SHA-256 of the shared parser's normalized receipt JSON. */
  expected_canonical_receipt_sha256?: string;
  /** Local waiting deadline; defaults to 30 seconds. */
  timeout_ms?: number;
  signal?: AbortSignal;
}

export interface WcpInspectedArtifactReceipt {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: {
    status: 'locally-valid';
    input_representation: 'utf8-bytes' | 'json-text';
    receipt: ArtifactReceiptEnvelope;
    original: ArtifactReceiptQuery;
    original_json: string;
    original_binding: 'embedded-only' | 'matches-expected-original';
    receipt_bytes: number;
    receipt_sha256: string;
    canonical_receipt_json: string;
    canonical_receipt_bytes: number;
    canonical_receipt_sha256: string;
    identity_state: 'not-authenticated';
    server_outcome: 'not-checked';
    content_state: 'not-checked';
    upload_dispatch_state: 'not-sent';
    filesystem_access: 'not-performed';
  };
}

const messages = {
  INVALID_INPUT: 'Supply valid local receipt inspection options, trace and expected constraints',
  ARTIFACT_RECEIPT_INVALID:
    'Supply a complete UTF-8 bare artifact receipt within 4 MiB containing an original within 1 MiB',
  ARTIFACT_RECEIPT_ORIGINAL_INVALID:
    'Supply one complete independent identity/command original within 1 MiB',
  ARTIFACT_RECEIPT_ORIGINAL_MISMATCH:
    'The saved receipt differs from the complete expected original; retain both originals and the receipt',
  ARTIFACT_RECEIPT_DIGEST_MISMATCH:
    'The receipt input or normalized receipt differs from its expected SHA-256; retain the input',
  ARTIFACT_INTEGRITY_UNAVAILABLE: 'SHA-256 inspection is unavailable',
  ARTIFACT_RECEIPT_INSPECTION_CANCELED:
    'Stopped waiting for local receipt inspection; no upload was sent',
  ARTIFACT_RECEIPT_INSPECTION_TIMEOUT:
    'Local receipt inspection exceeded its deadline; no upload was sent',
  ARTIFACT_RECEIPT_INSPECTION_FAILED:
    'Could not inspect the complete saved receipt; retain the input',
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
      upload_dispatch_state: 'not-sent',
      filesystem_access: 'not-performed',
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
function optionsFor(input: WcpArtifactReceiptInspectionOptions) {
  let trace = 'trace_sdk_artifact_receipt_inspection';
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    const traceField = Object.getOwnPropertyDescriptor(input, 'trace_id');
    if (traceField && Object.hasOwn(traceField, 'value') && validTrace(traceField.value))
      trace = traceField.value;
    const prototype: unknown = Object.getPrototypeOf(input);
    const keys = Object.keys(input);
    const allowed = [
      'trace_id',
      'expected_original',
      'expected_receipt_sha256',
      'expected_canonical_receipt_sha256',
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
    ) as WcpArtifactReceiptInspectionOptions;
    if (!validTrace(row.trace_id)) throw new TypeError();
    for (const digest of [row.expected_receipt_sha256, row.expected_canonical_receipt_sha256])
      if (digest !== undefined && (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)))
        throw new TypeError();
    return {
      trace: row.trace_id,
      original: row.expected_original,
      expectedReceipt: row.expected_receipt_sha256,
      expectedCanonical: row.expected_canonical_receipt_sha256,
      timeout: row.timeout_ms === undefined ? 30_000 : row.timeout_ms,
      signal: row.signal,
    };
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
}

function receiptBytes(input: string | Uint8Array): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  if (typeof input === 'string') {
    if (!input || input.length > ARTIFACT_SAVED_RECEIPT_BYTES || /[\p{Cs}]/u.test(input))
      throw new TypeError();
    bytes = new TextEncoder().encode(input);
  } else {
    if (!(input instanceof Uint8Array)) throw new TypeError();
    // Read native slots so an overridden byteLength/buffer cannot bypass the copy limit.
    const prototype: object = Object.getPrototypeOf(Uint8Array.prototype);
    const buffer: unknown = Object.getOwnPropertyDescriptor(prototype, 'buffer')!.get!.call(input);
    const size: number = Object.getOwnPropertyDescriptor(prototype, 'byteLength')!.get!.call(input);
    if (!(buffer instanceof ArrayBuffer) || size === 0 || size > ARTIFACT_SAVED_RECEIPT_BYTES)
      throw new TypeError();
    bytes = new Uint8Array(input);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > ARTIFACT_SAVED_RECEIPT_BYTES)
    throw new TypeError();
  return bytes;
}

async function hash(bytes: Uint8Array<ArrayBuffer>, budget: RequestBudget, trace: string) {
  try {
    budget.check();
    if (typeof globalThis.crypto?.subtle?.digest !== 'function') throw new TypeError();
    const result = await budget.wait(() =>
      globalThis.crypto.subtle.digest('SHA-256', bytes.buffer),
    );
    if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) throw new TypeError();
    budget.check();
    return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  } catch {
    budget.check();
    throw fail('ARTIFACT_INTEGRITY_UNAVAILABLE', trace);
  }
}

/** Offline structural inspection only; recorded/not-observed remain unsigned historical claims. */
export async function inspectArtifactReceipt(
  input: string | Uint8Array,
  options: WcpArtifactReceiptInspectionOptions,
): Promise<WcpInspectedArtifactReceipt> {
  const settings = optionsFor(options);
  const { trace } = settings;
  let budget: RequestBudget | undefined;
  try {
    try {
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw fail('INVALID_INPUT', trace);
    }
    budget.check();
    let bytes: Uint8Array<ArrayBuffer>;
    let parsed: ParsedSavedArtifactReceipt;
    try {
      bytes = receiptBytes(input);
      parsed = parseSavedArtifactReceipt(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
    } catch {
      throw fail('ARTIFACT_RECEIPT_INVALID', trace);
    }
    if (settings.original !== undefined) {
      let expected: ArtifactReceiptQuery;
      try {
        expected = parseArtifactReceiptQuery(
          JSON.parse(syncJsonSnapshot(settings.original, ARTIFACT_UPLOAD_REQUEST_BYTES)),
        );
        syncJsonSnapshot(expected, ARTIFACT_UPLOAD_REQUEST_BYTES);
      } catch {
        throw fail('ARTIFACT_RECEIPT_ORIGINAL_INVALID', trace);
      }
      try {
        parseArtifactReceiptEnvelope(parsed.receipt, expected, parsed.receipt.trace_id);
      } catch {
        throw fail('ARTIFACT_RECEIPT_ORIGINAL_MISMATCH', trace);
      }
    }
    // All caller-owned input and constraints have been captured before the first await.
    const canonicalBytes = new TextEncoder().encode(parsed.receipt_json);
    budget.check();
    const receiptHash = await hash(bytes, budget, trace);
    if (settings.expectedReceipt !== undefined && settings.expectedReceipt !== receiptHash)
      throw fail('ARTIFACT_RECEIPT_DIGEST_MISMATCH', trace);
    const canonicalHash = await hash(canonicalBytes, budget, trace);
    if (settings.expectedCanonical !== undefined && settings.expectedCanonical !== canonicalHash)
      throw fail('ARTIFACT_RECEIPT_DIGEST_MISMATCH', trace);
    budget.check();
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: {
        status: 'locally-valid',
        input_representation: typeof input === 'string' ? 'json-text' : 'utf8-bytes',
        receipt: parsed.receipt,
        original: parsed.original,
        original_json: parsed.original_json,
        original_binding:
          settings.original === undefined ? 'embedded-only' : 'matches-expected-original',
        receipt_bytes: bytes.byteLength,
        receipt_sha256: receiptHash,
        canonical_receipt_json: parsed.receipt_json,
        canonical_receipt_bytes: canonicalBytes.byteLength,
        canonical_receipt_sha256: canonicalHash,
        identity_state: 'not-authenticated',
        server_outcome: 'not-checked',
        content_state: 'not-checked',
        upload_dispatch_state: 'not-sent',
        filesystem_access: 'not-performed',
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
        ? 'ARTIFACT_RECEIPT_INSPECTION_CANCELED'
        : envelope?.code === 'GATEWAY_REQUEST_TIMEOUT'
          ? 'ARTIFACT_RECEIPT_INSPECTION_TIMEOUT'
          : envelope && Object.hasOwn(messages, envelope.code)
            ? (envelope.code as FailureCode)
            : 'ARTIFACT_RECEIPT_INSPECTION_FAILED';
    throw fail(code, trace);
  } finally {
    try {
      budget?.close();
    } catch {
      /* Cleanup must not replace the inspection result. */
    }
  }
}
