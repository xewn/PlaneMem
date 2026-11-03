import { validateSourceRef, type Classification, type SourceRef } from './metadata.js';
import { parseWorkItemProjectionQuery, WORK_ITEM_STATUSES } from './work-item-projection.js';

export interface ProjectSearchQuery {
  query: string;
  type?: 'all' | 'work_item' | 'context_item';
  mode?: 'fts' | 'substring';
  include_inactive_context?: boolean;
  limit?: number;
  cursor?: string;
}
export type NormalizedProjectSearchQuery = ProjectSearchQuery & {
  type: 'all' | 'work_item' | 'context_item';
  mode: 'fts' | 'substring';
  include_inactive_context: boolean;
  limit: number;
};
export interface ProjectSearchHit {
  type: 'work_item' | 'context_item';
  id: string;
  title: string;
  snippet: string;
  version: string;
  status: string;
  classification: Classification;
  updated_at: string;
  expires_at: string | null;
  score: number;
  source_refs: SourceRef[];
}
export interface ProjectSearchPage {
  query: string;
  type: NormalizedProjectSearchQuery['type'];
  mode: NormalizedProjectSearchQuery['mode'];
  include_inactive_context: boolean;
  scope: { tenant_id: string; workspace_id: string; project_id: string };
  hits: ProjectSearchHit[];
  next_cursor?: string;
  backend: 'postgres';
  vector_used: false;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a search object');
  return value as Record<string, unknown>;
}
export function parseProjectSearchQuery(value: unknown): NormalizedProjectSearchQuery {
  const input = object(value);
  if (
    Object.keys(input).some(
      (key) =>
        !['query', 'type', 'mode', 'include_inactive_context', 'limit', 'cursor'].includes(key),
    )
  )
    throw new TypeError('Unknown search query field');
  if (
    typeof input.query !== 'string' ||
    !input.query.trim() ||
    input.query.length > 500 ||
    /[\u0000\p{Cs}]/u.test(input.query)
  )
    throw new TypeError('query must contain 1–500 characters');
  const type = input.type === undefined ? 'all' : input.type;
  const mode = input.mode === undefined ? 'fts' : input.mode;
  const limit = input.limit === undefined ? 20 : input.limit;
  const inactive =
    input.include_inactive_context === undefined ? false : input.include_inactive_context;
  if (
    !['all', 'work_item', 'context_item'].includes(type as string) ||
    !['fts', 'substring'].includes(mode as string)
  )
    throw new TypeError('Invalid search type or mode');
  if (typeof inactive !== 'boolean')
    throw new TypeError('include_inactive_context must be boolean');
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new TypeError('limit must be an integer from 1 to 50');
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(input.cursor))
  )
    throw new TypeError('Invalid search cursor');
  return {
    query: input.query.trim(),
    type: type as NormalizedProjectSearchQuery['type'],
    mode: mode as NormalizedProjectSearchQuery['mode'],
    include_inactive_context: inactive,
    limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor as string }),
  };
}
export function parseProjectSearchPage(
  value: unknown,
  input: ProjectSearchQuery,
): ProjectSearchPage {
  const query = parseProjectSearchQuery(input),
    page = object(value),
    scope = object(page.scope);
  if (
    page.query !== query.query ||
    page.type !== query.type ||
    page.mode !== query.mode ||
    page.include_inactive_context !== query.include_inactive_context ||
    page.backend !== 'postgres' ||
    page.vector_used !== false ||
    !Array.isArray(page.hits) ||
    page.hits.length > query.limit
  )
    throw new TypeError('Search response does not match the request');
  for (const key of ['tenant_id', 'workspace_id', 'project_id'])
    if (typeof scope[key] !== 'string' || !scope[key]) throw new TypeError('Invalid search scope');
  const ids = new Set<string>();
  const hits = page.hits.map((value): ProjectSearchHit => {
    const row = object(value);
    const { item_id: id } = parseWorkItemProjectionQuery({ item_id: row.id });
    if (
      !['work_item', 'context_item'].includes(row.type as string) ||
      (query.type !== 'all' && row.type !== query.type)
    )
      throw new TypeError('Unexpected search record type');
    const key = `${row.type}:${id}`;
    if (ids.has(key)) throw new TypeError('Duplicate search hit');
    ids.add(key);
    if (
      typeof row.title !== 'string' ||
      typeof row.snippet !== 'string' ||
      typeof row.version !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(row.version) ||
      BigInt(row.version) > 9223372036854775807n ||
      !['public', 'internal', 'confidential', 'restricted'].includes(
        row.classification as string,
      ) ||
      typeof row.updated_at !== 'string' ||
      !Number.isFinite(Date.parse(row.updated_at)) ||
      (row.expires_at !== null &&
        (typeof row.expires_at !== 'string' || !Number.isFinite(Date.parse(row.expires_at)))) ||
      typeof row.score !== 'number' ||
      !Number.isFinite(row.score) ||
      row.score < 0 ||
      row.score > 1 ||
      (query.mode === 'substring' && row.score !== 0) ||
      !Array.isArray(row.source_refs)
    )
      throw new TypeError('Invalid search hit');
    const statuses: readonly string[] =
      row.type === 'work_item'
        ? WORK_ITEM_STATUSES
        : ['confirmed', 'proposed', 'expired', 'excluded'];
    if (
      !statuses.includes(row.status as string) ||
      (!query.include_inactive_context &&
        row.type === 'context_item' &&
        !['confirmed', 'proposed'].includes(row.status as string))
    )
      throw new TypeError('Unexpected search status');
    return {
      type: row.type as ProjectSearchHit['type'],
      id,
      title: row.title,
      snippet: row.snippet,
      version: row.version,
      status: row.status as string,
      classification: row.classification as Classification,
      updated_at: row.updated_at,
      expires_at: row.expires_at as string | null,
      score: row.score,
      source_refs: row.source_refs.map((value) => {
        const ref = validateSourceRef(value);
        return {
          type: ref.type,
          id: ref.id,
          ...(ref.revision === undefined ? {} : { revision: ref.revision }),
          ...(ref.uri === undefined ? {} : { uri: ref.uri }),
        };
      }),
    };
  });
  if (
    page.next_cursor !== undefined &&
    (typeof page.next_cursor !== 'string' ||
      !/^[A-Za-z0-9_-]{1,2048}$/.test(page.next_cursor) ||
      hits.length !== query.limit ||
      page.next_cursor === query.cursor)
  )
    throw new TypeError('Invalid search continuation');
  return {
    query: query.query,
    type: query.type,
    mode: query.mode,
    include_inactive_context: query.include_inactive_context,
    scope: {
      tenant_id: scope.tenant_id as string,
      workspace_id: scope.workspace_id as string,
      project_id: scope.project_id as string,
    },
    hits,
    ...(page.next_cursor === undefined ? {} : { next_cursor: page.next_cursor as string }),
    backend: 'postgres',
    vector_used: false,
  };
}
