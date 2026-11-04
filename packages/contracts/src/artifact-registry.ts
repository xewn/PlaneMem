import { isUlid } from './ids.js';
import { isSyncIdentifier } from './sync.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import { parseArtifactVersionSummary, type ArtifactVersionSummary } from './artifact-versions.js';

export const ARTIFACT_REGISTRY_RESPONSE_BYTES = 256 * 1024;
export interface ArtifactRegistryQuery {
  query?: string;
  classification?: ArtifactVersionSummary['classification'];
  limit?: number;
  cursor?: string;
}
export type ArtifactRegistryItem = ArtifactVersionSummary & { artifact_id: string };
export interface ArtifactRegistryPage {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  query: ArtifactRegistryQuery & { limit: number };
  items: ArtifactRegistryItem[];
  has_more: boolean;
  next_query: (ArtifactRegistryQuery & { limit: number; cursor: string }) | null;
  content_state: 'not-checked';
}
export interface ArtifactRegistryEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: { type: 'artifact'; id: string }[];
  data: ArtifactRegistryPage;
}
type Scope = { tenant_id: string; workspace_id: string; project_id?: string };
const classes = ['public', 'internal', 'confidential', 'restricted'];

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new TypeError('Invalid artifact directory fields');
  return value as Record<string, unknown>;
}
export function foldArtifactRegistryQuery(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
export function parseArtifactRegistryQuery(
  value: unknown,
): ArtifactRegistryQuery & { limit: number } {
  const row = object(JSON.parse(syncJsonSnapshot(value, 8192)), [
    'query',
    'classification',
    'limit',
    'cursor',
  ]);
  let query: string | undefined;
  if (row.query !== undefined) {
    if (
      typeof row.query !== 'string' ||
      row.query.length > 255 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.query)
    )
      throw new TypeError('Invalid file name search');
    query = row.query.trim() || undefined;
  }
  if (row.classification !== undefined && !classes.includes(row.classification as string))
    throw new TypeError('Invalid file classification');
  const limit = row.limit === undefined ? 20 : row.limit;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new TypeError('Read between one and twenty files');
  if (row.cursor !== undefined) parseArtifactRegistryCursor(row.cursor);
  return {
    ...(query === undefined ? {} : { query }),
    ...(row.classification === undefined
      ? {}
      : { classification: row.classification as ArtifactVersionSummary['classification'] }),
    limit,
    ...(row.cursor === undefined ? {} : { cursor: row.cursor as string }),
  };
}
export function encodeArtifactRegistryCursor(key: string, artifactId: string): string {
  if (
    key.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(key) ||
    !isUlid(artifactId) ||
    artifactId.length !== 26
  )
    throw new TypeError('Invalid file directory cursor');
  // Both fields are ASCII; no environment-dependent Unicode base64 conversion is needed.
  return btoa(JSON.stringify([1, key, artifactId]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function parseArtifactRegistryCursor(value: unknown): { key: string; artifact_id: string } {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value))
    throw new TypeError('Invalid file directory cursor');
  const raw = value.replace(/-/g, '+').replace(/_/g, '/');
  const row: unknown = JSON.parse(atob(raw + '='.repeat((4 - (raw.length % 4)) % 4)));
  if (
    !Array.isArray(row) ||
    row.length !== 3 ||
    row[0] !== 1 ||
    typeof row[1] !== 'string' ||
    typeof row[2] !== 'string' ||
    encodeArtifactRegistryCursor(row[1], row[2]) !== value
  )
    throw new TypeError('Invalid file directory cursor');
  return { key: row[1], artifact_id: row[2] };
}
export function parseArtifactRegistryPage(
  value: unknown,
  input: ArtifactRegistryQuery,
  scope: Scope,
): ArtifactRegistryPage {
  const query = parseArtifactRegistryQuery(input);
  const row = object(JSON.parse(syncJsonSnapshot(value, ARTIFACT_REGISTRY_RESPONSE_BYTES)), [
    'tenant_id',
    'workspace_id',
    'project_id',
    'query',
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
      throw new TypeError('File directory scope differs');
  if (
    JSON.stringify(parseArtifactRegistryQuery(row.query)) !== JSON.stringify(query) ||
    !Array.isArray(row.items) ||
    row.items.length > query.limit ||
    typeof row.has_more !== 'boolean' ||
    row.content_state !== 'not-checked'
  )
    throw new TypeError('Invalid file directory page');
  const cursor = query.cursor === undefined ? undefined : parseArtifactRegistryCursor(query.cursor);
  let previous = cursor?.artifact_id;
  const items = row.items.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError('Invalid directory item');
    const { artifact_id, ...summary } = value as Record<string, unknown>;
    if (
      !isUlid(artifact_id) ||
      artifact_id.length !== 26 ||
      (previous !== undefined && artifact_id >= previous)
    )
      throw new TypeError('File IDs must descend without duplicates');
    previous = artifact_id;
    const item = parseArtifactVersionSummary(summary);
    if (
      (query.classification !== undefined && item.classification !== query.classification) ||
      (query.query !== undefined &&
        !foldArtifactRegistryQuery(item.name).includes(foldArtifactRegistryQuery(query.query)))
    )
      throw new TypeError('File directory filters differ');
    return { artifact_id, ...item };
  });
  let next: ArtifactRegistryPage['next_query'] = null;
  if (row.has_more) {
    if (items.length !== query.limit || !previous)
      throw new TypeError('Invalid file directory continuation');
    const supplied = parseArtifactRegistryQuery(row.next_query);
    const position = parseArtifactRegistryCursor(supplied.cursor);
    if (position.artifact_id !== previous || (cursor !== undefined && cursor.key !== position.key))
      throw new TypeError('File directory continuation differs');
    next = { ...query, cursor: supplied.cursor! };
    if (JSON.stringify(supplied) !== JSON.stringify(next))
      throw new TypeError('File directory next query differs');
  } else if (row.next_query !== null) throw new TypeError('Unexpected file continuation');
  return {
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id!,
    query,
    items,
    has_more: row.has_more,
    next_query: next,
    content_state: 'not-checked',
  };
}
export function parseArtifactRegistryEnvelope(
  value: unknown,
  query: ArtifactRegistryQuery,
  scope: Scope,
  trace: string,
): ArtifactRegistryEnvelope {
  const row = object(JSON.parse(syncJsonSnapshot(value, ARTIFACT_REGISTRY_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'data',
  ]);
  if (
    row.schema_version !== 1 ||
    typeof trace !== 'string' ||
    !trace.trim() ||
    trace.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace) ||
    row.trace_id !== trace ||
    !Array.isArray(row.source_refs)
  )
    throw new TypeError('Invalid file directory envelope');
  const data = parseArtifactRegistryPage(row.data, query, scope);
  if (row.source_refs.length !== data.items.length)
    throw new TypeError('File directory sources differ');
  const sources = row.source_refs.map((value: unknown, index: number) => {
    const source = object(value, ['type', 'id']);
    if (source.type !== 'artifact' || source.id !== data.items[index]!.artifact_id)
      throw new TypeError('File directory source differs');
    return { type: 'artifact' as const, id: data.items[index]!.artifact_id };
  });
  return { schema_version: 1, trace_id: trace, source_refs: sources, data };
}
