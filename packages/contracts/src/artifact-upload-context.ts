import { parseArtifactCommandIdentity, type ArtifactCommandIdentity } from './artifact-receipt.js';
import { ARTIFACT_UPLOAD_MAX_BYTES } from './artifact-upload.js';

export interface ArtifactUploadContextEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: {
    identity: ArtifactCommandIdentity;
    expires_at: string;
    max_bytes: number;
    can_read: boolean;
    can_read_restricted: boolean;
  };
}

/** This context describes the verified caller, never a reservation or future write authorization. */
export function parseArtifactUploadContextEnvelope(
  value: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
): ArtifactUploadContextEnvelope {
  const row = record(value, ['schema_version', 'trace_id', 'source_refs', 'data']);
  const data = record(row.data, [
    'identity',
    'expires_at',
    'max_bytes',
    'can_read',
    'can_read_restricted',
  ]);
  const identity = parseArtifactCommandIdentity(data.identity);
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !trace.trim() ||
    trace.length > 1024 ||
    /[\u0000-\u001f\u007f]/.test(trace) ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== 0 ||
    Object.keys(row.source_refs).length !== 0 ||
    identity.tenant_id !== scope.tenant_id ||
    identity.workspace_id !== scope.workspace_id ||
    identity.project_id !== scope.project_id ||
    typeof data.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(data.expires_at)) ||
    new Date(data.expires_at).toISOString() !== data.expires_at ||
    typeof data.max_bytes !== 'number' ||
    !Number.isSafeInteger(data.max_bytes) ||
    data.max_bytes < 0 ||
    data.max_bytes > ARTIFACT_UPLOAD_MAX_BYTES ||
    typeof data.can_read !== 'boolean' ||
    typeof data.can_read_restricted !== 'boolean'
  )
    throw new TypeError('Invalid artifact upload context');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: {
      identity,
      expires_at: data.expires_at,
      max_bytes: data.max_bytes,
      can_read: data.can_read,
      can_read_restricted: data.can_read_restricted,
    },
  };
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new TypeError('Invalid upload context fields');
  return value as Record<string, unknown>;
}
