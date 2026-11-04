import {
  ARTIFACT_DOWNLOAD_DEFAULT_BYTES,
  ARTIFACT_DOWNLOAD_MAX_BYTES,
  ContractError,
  isSyncIdentifier,
  parseArtifactReadQuery,
  parseArtifactDownloadHeaders,
  syncJsonSnapshot,
  type ArtifactMetadataView,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { readArtifactMetadata } from './artifact-reads.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpArtifactDownloadOptions {
  max_bytes?: number;
  /** Local budget for metadata, content and integrity verification. */
  timeout_ms?: number;
  signal?: AbortSignal;
}
export interface WcpArtifactDownloadResult {
  schema_version: 1;
  trace_id: string;
  source_refs: { type: string; id: string; revision: number }[];
  data: {
    artifact: ArtifactMetadataView;
    audit_id: string;
    audit_state: 'release-recorded';
    content_state: 'verified';
  };
  content: Uint8Array;
}

const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply a fixed artifact version, project/account/client and valid download options',
  UNAUTHENTICATED: 'Renew the matching session before downloading',
  DENIED: 'The current verified session cannot download the selected artifact',
  ARTIFACT_ACCESS_DENIED: 'The current account or client cannot download the selected artifact',
  ARTIFACT_NOT_FOUND: 'The selected artifact is unavailable in this project',
  ARTIFACT_VERSION_NOT_FOUND: 'The selected historical version is unavailable',
  ARTIFACT_LEGACY_UNVERIFIED: 'The selected version lacks a verified historical snapshot',
  ARTIFACT_STORED_INVALID: 'Stored artifact metadata could not be verified',
  ARTIFACT_STORAGE_UNAVAILABLE: 'Artifact metadata storage is unavailable',
  ARTIFACT_OBJECT_UNAVAILABLE: 'The selected content could not be read from storage',
  ARTIFACT_OBJECT_MISSING: 'The selected content is unavailable in storage',
  ARTIFACT_DESCRIPTOR_CONFLICT:
    'The download descriptor differs from the selected historical version',
  ARTIFACT_TOO_LARGE: 'The selected artifact exceeds the download byte limit',
  ARTIFACT_HASH_MISMATCH: 'The selected content did not match its recorded SHA-256',
  ARTIFACT_DOWNLOAD_BUSY: 'Artifact download capacity is occupied',
  ARTIFACT_INTEGRITY_UNAVAILABLE: 'SHA-256 verification is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The download audit could not be confirmed',
  RATE_LIMITED: 'Gateway capacity is occupied',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the download; a server release may already exist',
  GATEWAY_REQUEST_TIMEOUT:
    'Download exceeded the local deadline; a server release may already exist',
  GATEWAY_RESPONSE_INVALID: 'The complete download did not match the selected artifact version',
  GATEWAY_UNAVAILABLE: 'The selected artifact download could not be completed',
};

function plainFields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const prototype: unknown = Object.getPrototypeOf(value);
  const keys = Object.keys(value);
  if (
    (prototype !== null && prototype !== Object.prototype) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(
      (key) =>
        !allowed.includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'),
    )
  )
    throw new TypeError();
  return Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(value, key)!.value]),
  );
}
function settingsFor(value: WcpArtifactDownloadOptions) {
  const row = plainFields(value, [
    'max_bytes',
    'timeout_ms',
    'signal',
  ]) as WcpArtifactDownloadOptions;
  const maximum = row.max_bytes === undefined ? ARTIFACT_DOWNLOAD_DEFAULT_BYTES : row.max_bytes;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > ARTIFACT_DOWNLOAD_MAX_BYTES)
    throw new TypeError();
  return {
    maximum,
    timeout: row.timeout_ms === undefined ? 180_000 : row.timeout_ms,
    signal: row.signal,
  };
}
function text(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}

export async function downloadArtifactVersion(
  transport: WcpTransport,
  original: RequestContext,
  artifactId: string,
  version: number,
  options: WcpArtifactDownloadOptions,
): Promise<WcpArtifactDownloadResult> {
  const context = { ...original };
  const trace = context.trace_id;
  let budget: RequestBudget | undefined;
  let release: string | undefined;
  let stage: 'input' | 'metadata' | 'content' | 'integrity' = 'input';
  let dispatched = false;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, {
      trace_id: trace,
      retryable: false,
      details: {
        download_stage: stage,
        content_dispatch_state: dispatched ? 'started' : 'not-sent',
        content_state: 'not-returned',
        audit_state: release === undefined ? 'unconfirmed' : 'release-recorded',
        ...(release === undefined ? {} : { release_audit_id: release }),
        client_save_state: 'not-confirmed',
      },
    });
  try {
    let settings: ReturnType<typeof settingsFor>;
    let query: { artifact_id: string; version: number };
    try {
      settings = settingsFor(options);
      if (
        !text(trace) ||
        !text(context.actor_id) ||
        !text(context.client_id) ||
        [context.tenant_id, context.workspace_id, context.project_id].some(
          (id) => !isSyncIdentifier(id) || id === '.' || id === '..',
        )
      )
        throw new TypeError();
      const parsed = parseArtifactReadQuery(
        JSON.parse(syncJsonSnapshot({ artifact_id: artifactId, version }, 4096)),
      );
      if (parsed.version === undefined) throw new TypeError();
      query = { artifact_id: parsed.artifact_id, version: parsed.version };
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw fail('INVALID_INPUT');
    }
    const activeBudget = budget;
    activeBudget.check();
    if (typeof globalThis.crypto?.subtle?.digest !== 'function')
      throw fail('ARTIFACT_INTEGRITY_UNAVAILABLE');
    stage = 'metadata';
    const metadata = await activeBudget.wait(() =>
      readArtifactMetadata(transport, context, query, {
        timeout_ms: settings.timeout,
        signal: activeBudget.signal,
      }),
    );
    activeBudget.check();
    const artifact = metadata.data.artifact;
    if (artifact.size > settings.maximum) throw fail('ARTIFACT_TOO_LARGE');
    stage = 'content';
    const response = await activeBudget.wait(() => {
      dispatched = true;
      return transport.request({
        method: 'GET',
        path:
          '/v1/artifacts/' + artifact.artifact_id + '/versions/' + artifact.version + '/content',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': context.tenant_id,
          'x-workspace-id': context.workspace_id,
          'x-project-id': context.project_id!,
          'x-expected-actor-id': context.actor_id!,
          'x-expected-client-id': context.client_id!,
          'x-expected-artifact-sha256': artifact.sha256,
          'x-expected-artifact-size': String(artifact.size),
        },
        response_type: 'bytes',
        max_response_bytes: artifact.size,
        signal: activeBudget.signal,
      });
    });
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const row = plainFields(response, ['status', 'headers', 'content']);
      if (row.status !== 200) throw new TypeError();
      const headers = JSON.parse(syncJsonSnapshot(row.headers, 16 * 1024)) as Record<
        string,
        string
      >;
      if (Object.values(headers).some((value) => typeof value !== 'string')) throw new TypeError();
      release = parseArtifactDownloadHeaders(headers, artifact, trace).audit_id;
      if (
        !(row.content instanceof Uint8Array) ||
        !(row.content.buffer instanceof ArrayBuffer) ||
        row.content.byteLength !== artifact.size
      )
        throw new TypeError();
      // Copy before asynchronous hashing; transport-owned buffers never become the result.
      bytes = new Uint8Array(row.content);
      if (bytes.byteLength !== artifact.size) throw new TypeError();
    } catch {
      activeBudget.check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    activeBudget.check();
    stage = 'integrity';
    let digest: ArrayBuffer;
    try {
      digest = await activeBudget.wait(() =>
        globalThis.crypto.subtle.digest('SHA-256', bytes.buffer),
      );
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
    } catch {
      activeBudget.check();
      throw fail('ARTIFACT_INTEGRITY_UNAVAILABLE');
    }
    if (
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') !==
      artifact.sha256
    )
      throw fail('ARTIFACT_HASH_MISMATCH');
    activeBudget.check();
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [{ type: 'artifact', id: artifact.artifact_id, revision: artifact.version }],
      data: {
        artifact,
        audit_id: release,
        audit_state: 'release-recorded',
        content_state: 'verified',
      },
      content: bytes,
    };
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
    budget?.close();
  }
}
