import { isUlid } from './ids.js';
import { isSyncIdentifier } from './sync.js';
import { buildEtag } from './versioning.js';
import { validateSourceRef, type Classification, type SourceRef } from './metadata.js';

export interface ArtifactReadQuery {
  artifact_id: string;
  version?: number;
}
export interface ArtifactMetadataView {
  schema_version: 1;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  artifact_id: string;
  name: string;
  mime: string;
  classification: Classification;
  source_refs: SourceRef[];
  sha256: string;
  size: number;
  version: number;
  etag: string;
  trace_id: string;
  created_at: string;
  updated_at: string;
}

export function parseArtifactReadQuery(value: unknown): ArtifactReadQuery {
  const row = object(value);
  only(row, ['artifact_id', 'version']);
  if (!isUlid(row.artifact_id)) throw new TypeError('Supply an artifact ULID');
  if (row.version !== undefined) integer(row.version, 1);
  return {
    artifact_id: row.artifact_id,
    ...(row.version === undefined ? {} : { version: row.version as number }),
  };
}

/** Public metadata deliberately excludes storage addresses and object bytes. */
export function parseArtifactMetadataView(value: unknown): ArtifactMetadataView {
  const row = object(value);
  only(row, [
    'schema_version',
    'tenant_id',
    'workspace_id',
    'project_id',
    'artifact_id',
    'name',
    'mime',
    'classification',
    'source_refs',
    'sha256',
    'size',
    'version',
    'etag',
    'trace_id',
    'created_at',
    'updated_at',
  ]);
  if (row.schema_version !== 1 || !isUlid(row.artifact_id))
    throw new TypeError('Invalid artifact metadata');
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isSyncIdentifier(row[key]) || row[key] === '.' || row[key] === '..')
      throw new TypeError('Invalid artifact scope');
  text(row.name, 255);
  text(row.mime, 255);
  text(row.trace_id, 1024);
  if (
    !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(row.mime as string) ||
    typeof row.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.sha256) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(row.classification as string)
  )
    throw new TypeError('Invalid artifact content descriptor');
  integer(row.size, 0);
  integer(row.version, 1);
  if (row.etag !== buildEtag(row.version as number)) throw new TypeError('Artifact ETag differs');
  const created = date(row.created_at);
  const updated = date(row.updated_at);
  if (Date.parse(updated) < Date.parse(created)) throw new TypeError('Invalid artifact timestamps');
  if (
    !Array.isArray(row.source_refs) ||
    row.source_refs.length > 200 ||
    Object.keys(row.source_refs).length !== row.source_refs.length
  )
    throw new TypeError('Invalid artifact sources');
  const refs = Array.from(row.source_refs, (entry) => {
    const ref = validateSourceRef(entry);
    only(object(entry), ['type', 'id', 'revision', 'uri']);
    text(ref.type, 128);
    text(ref.id, 1024);
    if (ref.uri !== undefined) text(ref.uri, 4096);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
  return {
    schema_version: 1,
    tenant_id: row.tenant_id as string,
    workspace_id: row.workspace_id as string,
    project_id: row.project_id as string,
    artifact_id: row.artifact_id,
    name: row.name as string,
    mime: row.mime as string,
    classification: row.classification as Classification,
    source_refs: refs,
    sha256: row.sha256,
    size: row.size as number,
    version: row.version as number,
    etag: row.etag as string,
    trace_id: row.trace_id as string,
    created_at: created,
    updated_at: updated,
  };
}

export function parseArtifactReadEnvelope(
  value: unknown,
  rawQuery: ArtifactReadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
) {
  const query = parseArtifactReadQuery(rawQuery);
  const row = object(value);
  only(row, ['schema_version', 'trace_id', 'source_refs', 'data', 'revision', 'etag']);
  text(trace, 1024);
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !scope.project_id ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== 1
  )
    throw new TypeError('Invalid artifact read envelope');
  const source = object(row.source_refs[0]);
  only(source, ['type', 'id']);
  if (source.type !== 'artifact' || source.id !== query.artifact_id)
    throw new TypeError('Artifact source differs');
  const data = object(row.data);
  only(data, ['artifact', 'snapshot', 'content_state']);
  const snapshot = query.version === undefined ? 'current' : 'historical';
  const artifact = parseArtifactMetadataView(data.artifact);
  if (
    data.snapshot !== snapshot ||
    data.content_state !== 'not-checked' ||
    artifact.artifact_id !== query.artifact_id ||
    artifact.tenant_id !== scope.tenant_id ||
    artifact.workspace_id !== scope.workspace_id ||
    artifact.project_id !== scope.project_id ||
    row.revision !== artifact.version ||
    (query.version !== undefined && artifact.version !== query.version) ||
    row.etag !== (query.version === undefined ? artifact.etag : undefined)
  )
    throw new TypeError('Artifact read target, version or scope differs');
  return {
    schema_version: 1 as const,
    trace_id: trace,
    revision: artifact.version,
    ...(query.version === undefined ? { etag: artifact.etag } : {}),
    source_refs: [{ type: 'artifact', id: query.artifact_id }],
    data: {
      artifact,
      snapshot: snapshot as 'current' | 'historical',
      content_state: 'not-checked' as const,
    },
  };
}
export type ArtifactReadDetail = ReturnType<typeof parseArtifactReadEnvelope>['data'];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected artifact record');
  return value as Record<string, unknown>;
}
function only(row: Record<string, unknown>, fields: string[]) {
  if (Object.keys(row).some((field) => !fields.includes(field)))
    throw new TypeError('Unexpected artifact fields');
}
function integer(value: unknown, min: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    throw new TypeError('Invalid artifact number');
}
function text(value: unknown, max: number) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new TypeError('Invalid artifact text');
}
function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError('Invalid artifact date');
  return value;
}
