import {
  ARTIFACT_UPLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ContractError,
  assertArtifactReceiptIdentity,
  buildEtag,
  parseArtifactReceiptQuery,
  parseArtifactUploadEnvelope,
  syncJsonSnapshot,
  type ArtifactReceiptQuery,
  type ArtifactUploadEnvelope,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpArtifactUploadOptions {
  /** Local wait across content verification, transport and response validation. Defaults to 180 s. */
  timeout_ms?: number;
  signal?: AbortSignal;
}
const RESPONSE_BYTES = 4 * 1024 * 1024;
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply the complete saved original, matching identity/scope and exact unshared content with valid upload options',
  ARTIFACT_TOO_LARGE: 'The original request or content exceeds the upload protocol limit',
  ARTIFACT_SIZE_MISMATCH:
    'Content length differs from the original; retain the request and locate its exact content',
  ARTIFACT_HASH_MISMATCH:
    'Content SHA-256 differs from the original; retain the request and locate its exact content',
  ARTIFACT_INTEGRITY_UNAVAILABLE:
    'SHA-256 verification is unavailable; retain the original request',
  ARTIFACT_UPLOAD_UNAVAILABLE: 'Native multipart uploads are unavailable in this runtime',
  UNAUTHENTICATED: 'Renew the matching session and check the original receipt',
  DENIED: 'The current verified session cannot upload this original; retain it unchanged',
  ARTIFACT_ACCESS_DENIED:
    'The current account or client cannot upload this original; retain it unchanged',
  ARTIFACT_NOT_FOUND:
    'The original target is unavailable in this project; retain the original request',
  ARTIFACT_VERSION_CONFLICT:
    'The original version could not be matched; keep it unchanged and check its receipt',
  ARTIFACT_VERSION_NOT_FOUND:
    'The original historical version is unavailable; retain the original request',
  ARTIFACT_LEGACY_UNVERIFIED: 'The original target lacks a verified historical snapshot',
  ARTIFACT_STORED_INVALID: 'Stored artifact metadata or receipt could not be verified',
  ARTIFACT_STORAGE_UNAVAILABLE: 'Artifact storage is unavailable; retain the original request',
  ARTIFACT_OBJECT_UNAVAILABLE:
    'Artifact content storage is unavailable; retain the original request',
  ARTIFACT_OBJECT_MISSING: 'Stored content is unavailable; retain the original request',
  ARTIFACT_UPLOAD_BUSY: 'Artifact upload capacity is occupied; retain the original request',
  IDEMPOTENCY_KEY_REUSED:
    'The original key belongs to different parameters; recover the exact original',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable; retain the original request',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The upload request audit could not be confirmed',
  RATE_LIMITED: 'Gateway capacity is occupied; retain the original request',
  GATEWAY_REQUEST_CANCELED:
    'Stopped waiting for the upload; retain the original and check its receipt',
  GATEWAY_REQUEST_TIMEOUT:
    'Upload exceeded the local deadline; retain the original and check its receipt',
  GATEWAY_RESPONSE_INVALID:
    'The complete upload response could not be verified; retain the original and check its receipt',
  GATEWAY_UNAVAILABLE:
    'The upload could not be confirmed; retain the original and check its receipt',
};

function settingsFor(value: WcpArtifactUploadOptions) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const prototype: unknown = Object.getPrototypeOf(value);
  const keys = Object.keys(value);
  if (
    (prototype !== null && prototype !== Object.prototype) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(
      (key) =>
        !['timeout_ms', 'signal'].includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'),
    )
  )
    throw new TypeError();
  const row = Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(value, key)!.value]),
  ) as WcpArtifactUploadOptions;
  return { timeout: row.timeout_ms === undefined ? 180_000 : row.timeout_ms, signal: row.signal };
}

/** At most one transport call per invocation. Local cancellation never disproves a previous write. */
export async function uploadArtifact(
  transport: WcpTransport,
  originalContext: RequestContext,
  operation: ArtifactReceiptQuery['command']['operation'],
  input: ArtifactReceiptQuery,
  content: Uint8Array,
  options: WcpArtifactUploadOptions,
): Promise<ArtifactUploadEnvelope> {
  const context = { ...originalContext };
  const trace = context.trace_id;
  let budget: RequestBudget | undefined;
  let dispatched = false;
  let stage: 'input' | 'integrity' | 'multipart' | 'transport' | 'response' = 'input';
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, {
      trace_id: trace,
      retryable: false,
      details: {
        upload_stage: stage,
        upload_dispatch_state: dispatched ? 'started' : 'not-sent',
        server_outcome: dispatched ? 'unknown' : 'not-checked',
        recovery:
          'Keep the saved original identity, command, key, version and content. Query its receipt explicitly; this failure does not disprove a prior upload.',
      },
    });
  try {
    let query: ArtifactReceiptQuery;
    let json: string;
    let snapshot: Uint8Array<ArrayBuffer>;
    try {
      const settings = settingsFor(options);
      if (
        typeof trace !== 'string' ||
        !trace.trim() ||
        trace.length > 1024 ||
        /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace)
      )
        throw new TypeError();
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw fail('INVALID_INPUT');
    }
    const activeBudget = budget;
    activeBudget.check();
    try {
      query = parseArtifactReceiptQuery(
        JSON.parse(syncJsonSnapshot(input, ARTIFACT_UPLOAD_REQUEST_BYTES)),
      );
      assertArtifactReceiptIdentity(query.identity, {
        ...context,
        actor_id: context.actor_id ?? query.identity.actor_id,
        client_id: context.client_id ?? query.identity.client_id,
      });
      if (
        query.command.operation !== operation ||
        !(content instanceof Uint8Array) ||
        !(content.buffer instanceof ArrayBuffer)
      )
        throw new TypeError();
      if (
        content.byteLength > ARTIFACT_UPLOAD_MAX_BYTES ||
        query.command.size > ARTIFACT_UPLOAD_MAX_BYTES
      )
        throw fail('ARTIFACT_TOO_LARGE');
      if (content.byteLength !== query.command.size) throw fail('ARTIFACT_SIZE_MISMATCH');
      // Detach the original and bytes before hashing or credential callbacks can yield.
      json = syncJsonSnapshot(query, ARTIFACT_UPLOAD_REQUEST_BYTES);
      snapshot = new Uint8Array(content);
      if (snapshot.byteLength !== query.command.size) throw fail('ARTIFACT_SIZE_MISMATCH');
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw fail('INVALID_INPUT');
    }
    activeBudget.check();
    if (typeof FormData !== 'function' || typeof Blob !== 'function')
      throw fail('ARTIFACT_UPLOAD_UNAVAILABLE');
    stage = 'integrity';
    let digest: ArrayBuffer;
    try {
      if (typeof globalThis.crypto?.subtle?.digest !== 'function') throw new TypeError();
      digest = await activeBudget.wait(() =>
        globalThis.crypto.subtle.digest('SHA-256', snapshot.buffer),
      );
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
    } catch {
      activeBudget.check();
      throw fail('ARTIFACT_INTEGRITY_UNAVAILABLE');
    }
    if (
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') !==
      query.command.sha256
    )
      throw fail('ARTIFACT_HASH_MISMATCH');
    activeBudget.check();
    stage = 'multipart';
    const form = new FormData();
    const metadata = new Blob([json], { type: 'application/json' });
    if (metadata.size > ARTIFACT_UPLOAD_REQUEST_BYTES) throw fail('ARTIFACT_TOO_LARGE');
    form.append('request', metadata, 'request.json');
    form.append(
      'content',
      new Blob([snapshot.buffer], { type: 'application/octet-stream' }),
      'content.bin',
    );
    const headers: Record<string, string> = {
      'x-trace-id': trace,
      'x-tenant-id': query.identity.tenant_id,
      'x-workspace-id': query.identity.workspace_id,
      'x-project-id': query.identity.project_id,
      'x-expected-actor-id': query.identity.actor_id,
      'x-expected-client-id': query.identity.client_id,
      'idempotency-key': query.command.request_key,
    };
    let path = '/v1/artifacts';
    if (query.command.operation === 'artifact.put-version') {
      headers['if-match'] = buildEtag(query.command.expected_version);
      path += '/' + query.command.artifact_id + '/versions';
    }
    stage = 'transport';
    const raw = await activeBudget.wait(() => {
      dispatched = true;
      return transport.request({
        method: 'POST',
        path,
        headers,
        body: form,
        response_type: 'bounded-json',
        max_response_bytes: RESPONSE_BYTES,
        signal: activeBudget.signal,
      });
    });
    stage = 'response';
    let result: ArtifactUploadEnvelope;
    try {
      result = parseArtifactUploadEnvelope(
        JSON.parse(syncJsonSnapshot(raw, RESPONSE_BYTES)),
        query,
        trace,
      );
    } catch {
      activeBudget.check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    activeBudget.check();
    return result;
  } catch (error) {
    let finalError = error;
    try {
      budget?.check();
    } catch (stopped) {
      finalError = stopped;
    }
    const envelope = finalError instanceof ContractError ? finalError.envelope : undefined;
    throw fail(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE',
    );
  } finally {
    try {
      budget?.close();
    } catch {
      /* Do not replace the original upload result during cleanup. */
    }
  }
}
