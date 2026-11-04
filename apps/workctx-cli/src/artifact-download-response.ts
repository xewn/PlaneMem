import {
  ContractError,
  parseArtifactDownloadEnvelope,
  syncJsonSnapshot,
  type ArtifactDownloadQuery,
} from '@planemem/contracts';

const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply a fixed artifact version and valid download options',
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
  ARTIFACT_DESCRIPTOR_CONFLICT: 'The download descriptor differs from the historical version',
  ARTIFACT_TOO_LARGE: 'The selected artifact exceeds the download byte limit',
  ARTIFACT_HASH_MISMATCH: 'The selected content did not match its recorded SHA-256',
  ARTIFACT_DOWNLOAD_BUSY: 'Artifact download capacity is occupied',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The download audit could not be confirmed',
  RATE_LIMITED: 'Gateway capacity is occupied',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the download; a server release may already exist',
  GATEWAY_REQUEST_TIMEOUT:
    'Download exceeded the local deadline; a server release may already exist',
  GATEWAY_RESPONSE_INVALID: 'The complete download did not match the selected artifact version',
  GATEWAY_UNAVAILABLE: 'The selected artifact download could not be completed',
};

export function artifactDownloadFailure(
  error: unknown,
  trace: string,
  details: Record<string, unknown>,
) {
  const envelope = error instanceof ContractError ? error.envelope : undefined;
  const code =
    envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
      ? envelope.code
      : 'GATEWAY_UNAVAILABLE';
  return new ContractError(code, messages[code]!, { trace_id: trace, retryable: false, details });
}

function fields(value: unknown, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const prototype: unknown = Object.getPrototypeOf(value);
  const keys = Object.keys(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
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

export function artifactDownloadResponse(
  value: unknown,
  query: ArtifactDownloadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
) {
  const row = fields(value, ['schema_version', 'trace_id', 'source_refs', 'data']);
  const data = fields(row.data, [
    'artifact',
    'content',
    'audit_id',
    'audit_state',
    'content_state',
  ]);
  const { content, ...metadata } = data;
  if (
    !(content instanceof Uint8Array) ||
    ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(content)) ||
    ['buffer', 'byteLength', 'byteOffset', 'length'].some((key) => Object.hasOwn(content, key)) ||
    !(content.buffer instanceof ArrayBuffer) ||
    content.byteLength !== query.size
  )
    throw new TypeError();
  const snapshot = JSON.parse(syncJsonSnapshot({ ...row, data: metadata }, 2 * 1024 * 1024)) as {
    data: Record<string, unknown>;
  };
  // The shared parser copies unshared bytes and binds every descriptor/source/audit field.
  return parseArtifactDownloadEnvelope(
    { ...snapshot, data: { ...snapshot.data, content } },
    query,
    scope,
    trace,
  );
}
