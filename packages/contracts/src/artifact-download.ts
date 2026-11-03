import { isUlid } from './ids.js';
import type { SourceRef } from './metadata.js';
import {
  parseArtifactReadQuery,
  parseArtifactMetadataView,
  type ArtifactMetadataView,
} from './artifact-read.js';

export const ARTIFACT_DOWNLOAD_DEFAULT_BYTES = 64 * 1024 * 1024;
export const ARTIFACT_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024;

export interface ArtifactDownloadQuery {
  artifact_id: string;
  version: number;
  sha256: string;
  size: number;
}

export interface ArtifactDownloadEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: {
    artifact: ArtifactMetadataView;
    content: Uint8Array;
    audit_id: string;
    audit_state: 'release-recorded';
    content_state: 'verified';
  };
}

/** Validate an in-process delivery envelope. Callers must independently hash its copied bytes. */
export function parseArtifactDownloadEnvelope(
  value: unknown,
  input: ArtifactDownloadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
): ArtifactDownloadEnvelope {
  const query = parseArtifactDownloadQuery(input);
  const row = fields(value, ['schema_version', 'trace_id', 'source_refs', 'data']);
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== 1 ||
    Object.keys(row.source_refs).length !== 1
  )
    throw new TypeError('Invalid artifact delivery envelope');
  const data = fields(row.data, [
    'artifact',
    'content',
    'audit_id',
    'audit_state',
    'content_state',
  ]);
  if (
    !(data.content instanceof Uint8Array) ||
    data.content.byteLength !== query.size ||
    !isUlid(data.audit_id) ||
    data.audit_state !== 'release-recorded' ||
    data.content_state !== 'verified'
  )
    throw new TypeError('Invalid artifact delivery state');
  const artifact = parseArtifactDownloadMetadata(data.artifact, query, scope);
  const source = fields(row.source_refs[0], ['type', 'id', 'revision']);
  if (
    source.type !== 'artifact' ||
    source.id !== query.artifact_id ||
    source.revision !== query.version
  )
    throw new TypeError('Invalid artifact delivery source');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [{ type: 'artifact', id: query.artifact_id, revision: query.version }],
    data: {
      artifact,
      content: new Uint8Array(data.content),
      audit_id: data.audit_id,
      audit_state: 'release-recorded',
      content_state: 'verified',
    },
  };
}

function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new TypeError('Invalid artifact delivery fields');
  return value as Record<string, unknown>;
}

export function parseArtifactDownloadQuery(value: unknown): ArtifactDownloadQuery {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['artifact_id', 'version', 'sha256', 'size'].includes(key))
  )
    throw new TypeError('Invalid artifact download query');
  const row = value as Record<string, unknown>;
  const target = parseArtifactReadQuery({ artifact_id: row.artifact_id, version: row.version });
  if (
    target.version === undefined ||
    typeof row.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.sha256) ||
    typeof row.size !== 'number' ||
    !Number.isSafeInteger(row.size) ||
    row.size < 0 ||
    row.size > ARTIFACT_DOWNLOAD_MAX_BYTES
  )
    throw new TypeError('Supply a pinned artifact version, SHA-256 and byte length');
  return {
    artifact_id: target.artifact_id,
    version: target.version,
    sha256: row.sha256,
    size: row.size,
  };
}

export function parseArtifactDownloadMetadata(
  value: unknown,
  input: ArtifactDownloadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
): ArtifactMetadataView {
  const query = parseArtifactDownloadQuery(input);
  const artifact = parseArtifactMetadataView(value);
  if (
    artifact.artifact_id !== query.artifact_id ||
    artifact.version !== query.version ||
    artifact.sha256 !== query.sha256 ||
    artifact.size !== query.size ||
    artifact.tenant_id !== scope.tenant_id ||
    artifact.workspace_id !== scope.workspace_id ||
    artifact.project_id !== scope.project_id
  )
    throw new TypeError('Artifact download differs from the selected version');
  return artifact;
}

/** Exact headers bind binary responses without exposing internal storage addresses. */
export function parseArtifactDownloadHeaders(
  headers: Record<string, string>,
  expected: ArtifactMetadataView,
  trace: string,
): { audit_id: string } {
  const artifact = parseArtifactMetadataView(expected);
  if (
    headers['x-wcp-schema-version'] !== '1' ||
    headers['x-trace-id'] !== trace ||
    headers['x-tenant-id'] !== encodeURIComponent(artifact.tenant_id) ||
    headers['x-workspace-id'] !== encodeURIComponent(artifact.workspace_id) ||
    headers['x-project-id'] !== encodeURIComponent(artifact.project_id) ||
    headers['x-artifact-id'] !== artifact.artifact_id ||
    headers['x-artifact-version'] !== String(artifact.version) ||
    headers['x-artifact-sha256'] !== artifact.sha256 ||
    headers['content-length'] !== String(artifact.size) ||
    headers['content-type'] !== 'application/octet-stream' ||
    (headers['content-encoding'] !== undefined && headers['content-encoding'] !== 'identity') ||
    headers['content-range'] !== undefined ||
    headers.etag !== undefined ||
    headers['x-artifact-audit-stage'] !== 'release' ||
    !isUlid(headers['x-artifact-audit-id'])
  )
    throw new TypeError('Invalid artifact download response headers');
  return { audit_id: headers['x-artifact-audit-id'] };
}
