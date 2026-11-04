import { isUlid } from './ids.js';
import { isSyncIdentifier } from './sync.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import type { ArtifactMetadataView } from './artifact-read.js';

export const ARTIFACT_VERSIONS_RESPONSE_BYTES = 256 * 1024;
export interface ArtifactVersionsQuery {
  artifact_id: string;
  limit?: number;
  /** Inclusive version ceiling; preserved when following next_query. */
  at_version?: number;
  /** Exclusive position; requires at_version. */
  before_version?: number;
}
export type ArtifactVersionSummary = Pick<
  ArtifactMetadataView,
  | 'version'
  | 'name'
  | 'mime'
  | 'classification'
  | 'sha256'
  | 'size'
  | 'trace_id'
  | 'created_at'
  | 'updated_at'
> & { source_ref_count: number };
export interface ArtifactVersionsPage {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  query: ArtifactVersionsQuery & { limit: number };
  snapshot_version: number;
  items: ArtifactVersionSummary[];
  has_more: boolean;
  next_query:
    | (ArtifactVersionsQuery & { limit: number; at_version: number; before_version: number })
    | null;
  content_state: 'not-checked';
}
export interface ArtifactVersionsEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: { type: 'artifact'; id: string }[];
  data: ArtifactVersionsPage;
}

export function parseArtifactVersionsQuery(
  value: unknown,
): ArtifactVersionsQuery & { limit: number } {
  const row = object(JSON.parse(syncJsonSnapshot(value, 4096)), [
    'artifact_id',
    'limit',
    'at_version',
    'before_version',
  ]);
  if (!isUlid(row.artifact_id)) throw new TypeError('Supply an artifact ULID');
  const limit = row.limit === undefined ? 10 : integer(row.limit);
  if (limit > 20) throw new TypeError('Read at most 20 versions');
  const at = row.at_version === undefined ? undefined : integer(row.at_version);
  const before = row.before_version === undefined ? undefined : integer(row.before_version);
  if (before !== undefined && (at === undefined || before > at))
    throw new TypeError('Version position requires its original ceiling');
  return {
    artifact_id: row.artifact_id,
    limit,
    ...(at === undefined ? {} : { at_version: at }),
    ...(before === undefined ? {} : { before_version: before }),
  };
}

/** Public summary of an already validated immutable snapshot; never includes storage addresses. */
export function summarizeArtifactVersion(metadata: ArtifactMetadataView): ArtifactVersionSummary {
  return {
    version: metadata.version,
    name: metadata.name,
    mime: metadata.mime,
    classification: metadata.classification,
    sha256: metadata.sha256,
    size: metadata.size,
    trace_id: metadata.trace_id,
    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
    source_ref_count: metadata.source_refs.length,
  };
}

export function parseArtifactVersionsPage(
  value: unknown,
  input: ArtifactVersionsQuery,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
): ArtifactVersionsPage {
  const query = parseArtifactVersionsQuery(input);
  const row = object(JSON.parse(syncJsonSnapshot(value, ARTIFACT_VERSIONS_RESPONSE_BYTES)), [
    'tenant_id',
    'workspace_id',
    'project_id',
    'query',
    'snapshot_version',
    'items',
    'has_more',
    'next_query',
    'content_state',
  ]);
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (
      !isSyncIdentifier(row[key]) ||
      row[key] === '.' ||
      row[key] === '..' ||
      row[key] !== scope[key]
    )
      throw new TypeError('Artifact directory scope differs');
  const echoed = parseArtifactVersionsQuery(row.query);
  if (JSON.stringify(echoed) !== JSON.stringify(query))
    throw new TypeError('Version query differs');
  const snapshot = integer(row.snapshot_version);
  if (
    (query.at_version !== undefined && snapshot !== query.at_version) ||
    !Array.isArray(row.items) ||
    row.items.length > query.limit ||
    typeof row.has_more !== 'boolean' ||
    row.content_state !== 'not-checked'
  )
    throw new TypeError('Invalid artifact version page');
  let previous = query.before_version;
  const items = row.items.map((value: unknown) => {
    const item = parseArtifactVersionSummary(value);
    const version = item.version;
    if (version > snapshot || (previous !== undefined && version >= previous))
      throw new TypeError('Artifact versions must descend within the selected range');
    previous = version;
    return item;
  });
  let next: ArtifactVersionsPage['next_query'] = null;
  if (row.has_more) {
    if (items.length !== query.limit || !previous || previous <= 1)
      throw new TypeError('Invalid artifact version continuation');
    next = {
      artifact_id: query.artifact_id,
      limit: query.limit,
      at_version: snapshot,
      before_version: previous,
    };
    if (JSON.stringify(parseArtifactVersionsQuery(row.next_query)) !== JSON.stringify(next))
      throw new TypeError('Artifact version continuation differs');
  } else if (row.next_query !== null) throw new TypeError('Unexpected version continuation');
  return {
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id!,
    query,
    snapshot_version: snapshot,
    items,
    has_more: row.has_more,
    next_query: next,
    content_state: 'not-checked',
  };
}

/** Shared bounded public summary, independent of page order or current/historical semantics. */
export function parseArtifactVersionSummary(value: unknown): ArtifactVersionSummary {
  const item = object(JSON.parse(syncJsonSnapshot(value, 16 * 1024)), [
    'version',
    'name',
    'mime',
    'classification',
    'sha256',
    'size',
    'trace_id',
    'created_at',
    'updated_at',
    'source_ref_count',
  ]);
  const version = integer(item.version);
  const name = text(item.name, 255);
  const mime = text(item.mime, 255);
  if (
    !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mime) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(item.classification as string) ||
    typeof item.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(item.sha256)
  )
    throw new TypeError('Invalid artifact version descriptor');
  const created = date(item.created_at);
  const updated = date(item.updated_at);
  const count = integer(item.source_ref_count, 0);
  if (Date.parse(updated) < Date.parse(created) || count > 200)
    throw new TypeError('Invalid artifact version summary');
  return {
    version,
    name,
    mime,
    classification: item.classification as ArtifactVersionSummary['classification'],
    sha256: item.sha256,
    size: integer(item.size, 0),
    trace_id: text(item.trace_id, 1024),
    created_at: created,
    updated_at: updated,
    source_ref_count: count,
  };
}

export function parseArtifactVersionsEnvelope(
  value: unknown,
  input: ArtifactVersionsQuery,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
): ArtifactVersionsEnvelope {
  const query = parseArtifactVersionsQuery(input);
  const row = object(JSON.parse(syncJsonSnapshot(value, ARTIFACT_VERSIONS_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'data',
  ]);
  text(trace, 1024);
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== 1
  )
    throw new TypeError('Invalid artifact versions envelope');
  const source = object(row.source_refs[0], ['type', 'id']);
  if (source.type !== 'artifact' || source.id !== query.artifact_id)
    throw new TypeError('Artifact directory source differs');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [{ type: 'artifact', id: query.artifact_id }],
    data: parseArtifactVersionsPage(row.data, query, scope),
  };
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new TypeError('Invalid version fields');
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    throw new TypeError('Invalid version number');
  return value;
}
function text(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new TypeError('Invalid version text');
  return value;
}
function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError('Invalid version date');
  return value;
}
