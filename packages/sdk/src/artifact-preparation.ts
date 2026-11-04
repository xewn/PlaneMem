import {
  ARTIFACT_UPLOAD_DEFAULT_BYTES,
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  createUlid,
  parseArtifactReadEnvelope,
  parseArtifactReceiptQuery,
  parseArtifactUploadDraft,
  syncJsonSnapshot,
  type ArtifactReceiptQuery,
  type ArtifactUploadDraft,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { readArtifactUploadContext } from './artifact-upload-context.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpArtifactPreparationOptions {
  max_bytes?: number;
  timeout_ms?: number;
  signal?: AbortSignal;
}
export interface WcpPreparedArtifactUpload {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: {
    original: ArtifactReceiptQuery;
    /** Save these exact UTF-8 bytes as the original request before explicitly uploading. */
    request_json: string;
    request_bytes: number;
    request_sha256: string;
    identity_observed_expires_at: string;
    local_state: 'prepared-not-saved';
    upload_dispatch_state: 'not-sent';
    next_action: 'save-and-review-original';
  };
}

const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply a new artifact draft, unshared Uint8Array content and valid preparation options without inherited write conditions',
  ARTIFACT_TOO_LARGE: 'Content exceeds the configured preparation or current upload limit',
  ARTIFACT_INTEGRITY_UNAVAILABLE: 'SHA-256 or secure request-key generation is unavailable',
  ARTIFACT_VERSION_CONFLICT:
    'The reviewed version differs from current metadata; review it before preparing a different request',
  ARTIFACT_ACCESS_DENIED: 'This preparation requires the matching artifact read capability',
  ARTIFACT_NOT_FOUND: 'The selected artifact is unavailable to this caller',
  ARTIFACT_LEGACY_UNVERIFIED: 'Current metadata lacks a verified historical snapshot',
  ARTIFACT_STORED_INVALID: 'Current artifact metadata could not be verified',
  ARTIFACT_STORAGE_UNAVAILABLE: 'Artifact metadata storage is unavailable',
  ARTIFACT_UPLOAD_CONTEXT_INVALID: 'The verified upload identity could not be represented',
  DENIED: 'A verified unexpired artifact writer with the required access is needed',
  UNAUTHENTICATED: 'Renew the session before preparing a new artifact request',
  RATE_LIMITED: 'Artifact preparation reads are temporarily busy',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The preparation read audit could not be persisted',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for artifact preparation; no upload was sent',
  GATEWAY_REQUEST_TIMEOUT: 'Artifact preparation exceeded the local deadline; no upload was sent',
  GATEWAY_RESPONSE_INVALID: 'The complete artifact metadata did not match this preparation',
  GATEWAY_UNAVAILABLE: 'Artifact preparation reads could not be completed',
  ARTIFACT_PREPARATION_FAILED:
    'Could not prepare the complete original request; no upload was sent',
};
function failure(code: string, trace: string) {
  return new ContractError(code, messages[code]!, {
    trace_id: trace,
    retryable: false,
    details: { local_state: 'not-saved', upload_dispatch_state: 'not-sent' },
  });
}
function captureOptions(value: WcpArtifactPreparationOptions) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const prototype: unknown = Object.getPrototypeOf(value);
  const fields = Object.keys(value);
  if (
    (prototype !== null && prototype !== Object.prototype) ||
    Reflect.ownKeys(value).length !== fields.length ||
    fields.some(
      (key) =>
        !['max_bytes', 'timeout_ms', 'signal'].includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'),
    )
  )
    throw new TypeError();
  const row = Object.fromEntries(
    fields.map((key) => [key, Object.getOwnPropertyDescriptor(value, key)!.value]),
  ) as WcpArtifactPreparationOptions;
  const maximum = row.max_bytes === undefined ? ARTIFACT_UPLOAD_DEFAULT_BYTES : row.max_bytes;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > ARTIFACT_UPLOAD_MAX_BYTES)
    throw new TypeError();
  return {
    maximum,
    timeout: row.timeout_ms === undefined ? 180_000 : row.timeout_ms,
    signal: row.signal,
  };
}

/** Creates one new original in memory. Persistence, review and upload remain explicit caller actions. */
export async function prepareArtifactUpload(
  transport: WcpTransport,
  originalContext: RequestContext,
  input: ArtifactUploadDraft,
  content: Uint8Array,
  options: WcpArtifactPreparationOptions,
): Promise<WcpPreparedArtifactUpload> {
  const context = { ...originalContext };
  const trace = context.trace_id;
  let budget: RequestBudget | undefined;
  try {
    let draft: ArtifactUploadDraft;
    let bytes: Uint8Array<ArrayBuffer>;
    let settings: ReturnType<typeof captureOptions>;
    try {
      settings = captureOptions(options);
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
      budget.check();
      if (
        context.idempotency_key !== undefined ||
        context.expected_version !== undefined ||
        context.if_match !== undefined
      )
        throw new TypeError();
      draft = parseArtifactUploadDraft(
        JSON.parse(syncJsonSnapshot(input, ARTIFACT_UPLOAD_REQUEST_BYTES)),
      );
      if (!(content instanceof Uint8Array) || !(content.buffer instanceof ArrayBuffer))
        throw new TypeError();
      if (content.byteLength > settings.maximum) throw failure('ARTIFACT_TOO_LARGE', trace);
      // Capture before the first asynchronous read or credential provider can mutate caller inputs.
      bytes = new Uint8Array(content);
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw failure('INVALID_INPUT', trace);
    }
    if (
      typeof globalThis.crypto?.subtle?.digest !== 'function' ||
      typeof globalThis.crypto?.getRandomValues !== 'function'
    )
      throw failure('ARTIFACT_INTEGRITY_UNAVAILABLE', trace);
    const activeBudget = budget;
    const caller = await activeBudget.wait(() =>
      readArtifactUploadContext(transport, context, {
        timeout_ms: settings.timeout,
        signal: activeBudget.signal,
      }),
    );
    const check = () => {
      activeBudget.check();
      if (Date.parse(caller.data.expires_at) <= Date.now()) throw failure('DENIED', trace);
    };
    check();
    if (bytes.byteLength > caller.data.max_bytes) throw failure('ARTIFACT_TOO_LARGE', trace);
    if (
      (draft.operation === 'artifact.put-version' && !caller.data.can_read) ||
      (draft.operation === 'artifact.create' &&
        draft.classification === 'restricted' &&
        !caller.data.can_read_restricted)
    )
      throw failure('ARTIFACT_ACCESS_DENIED', trace);
    const digest = async (value: Uint8Array<ArrayBuffer>) => {
      let raw: ArrayBuffer;
      try {
        raw = await activeBudget.wait(() =>
          globalThis.crypto.subtle.digest('SHA-256', value.buffer),
        );
      } catch {
        activeBudget.check();
        throw failure('ARTIFACT_INTEGRITY_UNAVAILABLE', trace);
      }
      check();
      if (!(raw instanceof ArrayBuffer) || raw.byteLength !== 32)
        throw failure('ARTIFACT_INTEGRITY_UNAVAILABLE', trace);
      return Array.from(new Uint8Array(raw), (byte) => byte.toString(16).padStart(2, '0')).join('');
    };
    const sha256 = await digest(bytes);
    if (draft.operation === 'artifact.put-version') {
      const { artifact_id, expected_version } = draft;
      const identity = { ...caller.data.identity };
      const raw = await activeBudget.wait(() =>
        transport.request({
          method: 'GET',
          path: '/v1/artifacts/' + encodeURIComponent(artifact_id),
          headers: {
            'x-trace-id': trace,
            'x-tenant-id': identity.tenant_id,
            'x-workspace-id': identity.workspace_id,
            'x-project-id': identity.project_id,
            'x-expected-actor-id': identity.actor_id,
            'x-expected-client-id': identity.client_id,
          },
          response_type: 'bounded-json',
          max_response_bytes: 2 * 1024 * 1024,
          signal: activeBudget.signal,
        }),
      );
      check();
      let artifact;
      try {
        artifact = parseArtifactReadEnvelope(
          JSON.parse(syncJsonSnapshot(raw, 2 * 1024 * 1024)),
          { artifact_id },
          identity,
          trace,
        ).data.artifact;
      } catch {
        throw failure('GATEWAY_RESPONSE_INVALID', trace);
      }
      if (artifact.classification === 'restricted' && !caller.data.can_read_restricted)
        throw failure('ARTIFACT_ACCESS_DENIED', trace);
      if (artifact.version !== expected_version) throw failure('ARTIFACT_VERSION_CONFLICT', trace);
    }
    let candidate: ArtifactReceiptQuery;
    try {
      candidate = parseArtifactReceiptQuery({
        identity: caller.data.identity,
        command: {
          ...draft,
          size: bytes.byteLength,
          sha256,
          request_key: 'workctx-artifact-' + '0'.repeat(26),
        },
      });
      syncJsonSnapshot(candidate, ARTIFACT_UPLOAD_REQUEST_BYTES);
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
    check();
    if (typeof globalThis.crypto?.getRandomValues !== 'function')
      throw failure('ARTIFACT_INTEGRITY_UNAVAILABLE', trace);
    const original = parseArtifactReceiptQuery({
      identity: candidate.identity,
      command: { ...candidate.command, request_key: 'workctx-artifact-' + createUlid() },
    });
    const json = syncJsonSnapshot(original, ARTIFACT_UPLOAD_REQUEST_BYTES);
    const encoded = new TextEncoder().encode(json);
    const requestHash = await digest(encoded);
    check();
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: {
        original,
        request_json: json,
        request_bytes: encoded.byteLength,
        request_sha256: requestHash,
        identity_observed_expires_at: caller.data.expires_at,
        local_state: 'prepared-not-saved',
        upload_dispatch_state: 'not-sent',
        next_action: 'save-and-review-original',
      },
    };
  } catch (error) {
    let finalError = error;
    try {
      budget?.check();
    } catch (stopped) {
      finalError = stopped;
    }
    const envelope = finalError instanceof ContractError ? finalError.envelope : undefined;
    throw failure(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? envelope.code
        : 'ARTIFACT_PREPARATION_FAILED',
      trace,
    );
  } finally {
    budget?.close();
  }
}
