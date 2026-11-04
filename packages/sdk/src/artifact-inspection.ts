import {
  ARTIFACT_UPLOAD_DEFAULT_BYTES,
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  parseArtifactReceiptQuery,
  syncJsonSnapshot,
  type ArtifactReceiptQuery,
} from '@planemem/contracts';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpArtifactInspectionOptions {
  /** Identifies this local inspection; never replaces any field in the saved original. */
  trace_id: string;
  content?: Uint8Array;
  /** Content limit only, allowed only with content; defaults to 64 MiB. */
  max_bytes?: number;
  /** SHA-256 of the exact input bytes, including BOM/whitespace. */
  expected_request_sha256?: string;
  /** SHA-256 of the shared parser's normalized identity/command JSON. */
  expected_canonical_request_sha256?: string;
  timeout_ms?: number;
  signal?: AbortSignal;
}
export interface WcpInspectedArtifactUploadRequest {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: {
    status: 'locally-valid';
    input_representation: 'utf8-bytes' | 'json-text';
    original: ArtifactReceiptQuery;
    request_bytes: number;
    request_sha256: string;
    canonical_request_json: string;
    canonical_request_bytes: number;
    canonical_request_sha256: string;
    content_state: 'not-checked' | 'matches-original';
    identity_state: 'not-authenticated';
    server_outcome: 'not-checked';
    upload_dispatch_state: 'not-sent';
    filesystem_access: 'not-performed';
  };
}

const messages = {
  INVALID_INPUT:
    'Supply valid local inspection options, trace, optional content and expected digests',
  ARTIFACT_REQUEST_INVALID: 'Supply one complete UTF-8 identity/command original within 1 MiB',
  ARTIFACT_REQUEST_DIGEST_MISMATCH:
    'The original input or normalized request differs from its expected SHA-256; retain the original input',
  ARTIFACT_TOO_LARGE: 'Content exceeds the configured local inspection limit',
  ARTIFACT_SIZE_MISMATCH:
    'Content length differs from the saved original; retain the request and locate its exact content',
  ARTIFACT_HASH_MISMATCH:
    'Content SHA-256 differs from the saved original; retain the request and locate its exact content',
  ARTIFACT_INTEGRITY_UNAVAILABLE: 'SHA-256 inspection is unavailable',
  ARTIFACT_REQUEST_INSPECTION_CANCELED:
    'Stopped waiting for local original inspection; no upload was sent',
  ARTIFACT_REQUEST_INSPECTION_TIMEOUT:
    'Local original inspection exceeded its deadline; no upload was sent',
  ARTIFACT_REQUEST_INSPECTION_FAILED:
    'Could not inspect the complete original; retain the input and content',
} as const;
type FailureCode = keyof typeof messages;

function fail(code: FailureCode, trace: string) {
  return new ContractError(code, messages[code], {
    trace_id: trace,
    retryable: false,
    details: {
      identity_state: 'not-authenticated',
      server_outcome: 'not-checked',
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
function optionsFor(input: WcpArtifactInspectionOptions) {
  let trace = 'trace_sdk_artifact_inspection';
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    const traceField = Object.getOwnPropertyDescriptor(input, 'trace_id');
    if (traceField && Object.hasOwn(traceField, 'value') && validTrace(traceField.value))
      trace = traceField.value;
    const prototype: unknown = Object.getPrototypeOf(input);
    const keys = Object.keys(input);
    const allowed = [
      'trace_id',
      'content',
      'max_bytes',
      'expected_request_sha256',
      'expected_canonical_request_sha256',
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
    ) as WcpArtifactInspectionOptions;
    if (!validTrace(row.trace_id)) throw new TypeError();
    for (const digest of [row.expected_request_sha256, row.expected_canonical_request_sha256])
      if (digest !== undefined && (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)))
        throw new TypeError();
    if (row.max_bytes !== undefined && row.content === undefined) throw new TypeError();
    const maximum = row.max_bytes === undefined ? ARTIFACT_UPLOAD_DEFAULT_BYTES : row.max_bytes;
    if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > ARTIFACT_UPLOAD_MAX_BYTES)
      throw new TypeError();
    return {
      trace: row.trace_id,
      maximum,
      content: row.content,
      expectedRequest: row.expected_request_sha256,
      expectedCanonical: row.expected_canonical_request_sha256,
      timeout: row.timeout_ms === undefined ? 180_000 : row.timeout_ms,
      signal: row.signal,
    };
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
}

function requestBytes(input: string | Uint8Array): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  if (typeof input === 'string') {
    if (!input || input.length > ARTIFACT_UPLOAD_REQUEST_BYTES || /[\p{Cs}]/u.test(input))
      throw new TypeError();
    bytes = new TextEncoder().encode(input);
  } else {
    if (
      !(input instanceof Uint8Array) ||
      !(input.buffer instanceof ArrayBuffer) ||
      input.byteLength === 0 ||
      input.byteLength > ARTIFACT_UPLOAD_REQUEST_BYTES
    )
      throw new TypeError();
    bytes = new Uint8Array(input);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > ARTIFACT_UPLOAD_REQUEST_BYTES)
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

/** Offline only. A matching local original never authenticates its identity or confirms an upload. */
export async function inspectArtifactUploadRequest(
  input: string | Uint8Array,
  options: WcpArtifactInspectionOptions,
): Promise<WcpInspectedArtifactUploadRequest> {
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
    let original: ArtifactReceiptQuery;
    let canonical: string;
    try {
      bytes = requestBytes(input);
      original = parseArtifactReceiptQuery(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      canonical = syncJsonSnapshot(original, ARTIFACT_UPLOAD_REQUEST_BYTES);
    } catch {
      throw fail('ARTIFACT_REQUEST_INVALID', trace);
    }
    const canonicalBytes = new TextEncoder().encode(canonical);
    let content: Uint8Array<ArrayBuffer> | undefined;
    if (settings.content !== undefined) {
      if (
        !(settings.content instanceof Uint8Array) ||
        !(settings.content.buffer instanceof ArrayBuffer)
      )
        throw fail('INVALID_INPUT', trace);
      if (
        settings.content.byteLength > settings.maximum ||
        original.command.size > settings.maximum
      )
        throw fail('ARTIFACT_TOO_LARGE', trace);
      if (settings.content.byteLength !== original.command.size)
        throw fail('ARTIFACT_SIZE_MISMATCH', trace);
      // Capture every caller-owned byte before the first digest can yield control.
      content = new Uint8Array(settings.content);
      if (content.byteLength !== original.command.size) throw fail('ARTIFACT_SIZE_MISMATCH', trace);
    }
    budget.check();
    const requestHash = await hash(bytes, budget, trace);
    if (settings.expectedRequest !== undefined && settings.expectedRequest !== requestHash)
      throw fail('ARTIFACT_REQUEST_DIGEST_MISMATCH', trace);
    const canonicalHash = await hash(canonicalBytes, budget, trace);
    if (settings.expectedCanonical !== undefined && settings.expectedCanonical !== canonicalHash)
      throw fail('ARTIFACT_REQUEST_DIGEST_MISMATCH', trace);
    if (content !== undefined && (await hash(content, budget, trace)) !== original.command.sha256)
      throw fail('ARTIFACT_HASH_MISMATCH', trace);
    budget.check();
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: {
        status: 'locally-valid',
        input_representation: typeof input === 'string' ? 'json-text' : 'utf8-bytes',
        original,
        request_bytes: bytes.byteLength,
        request_sha256: requestHash,
        canonical_request_json: canonical,
        canonical_request_bytes: canonicalBytes.byteLength,
        canonical_request_sha256: canonicalHash,
        content_state: content === undefined ? 'not-checked' : 'matches-original',
        identity_state: 'not-authenticated',
        server_outcome: 'not-checked',
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
        ? 'ARTIFACT_REQUEST_INSPECTION_CANCELED'
        : envelope?.code === 'GATEWAY_REQUEST_TIMEOUT'
          ? 'ARTIFACT_REQUEST_INSPECTION_TIMEOUT'
          : envelope && Object.hasOwn(messages, envelope.code)
            ? (envelope.code as FailureCode)
            : 'ARTIFACT_REQUEST_INSPECTION_FAILED';
    throw fail(code, trace);
  } finally {
    try {
      budget?.close();
    } catch {
      /* Cleanup must not replace the local inspection result. */
    }
  }
}
