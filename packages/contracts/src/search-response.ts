import {
  parseProjectSearchQuery,
  parseProjectSearchPage,
  type ProjectSearchQuery,
  type ProjectSearchPage,
} from './project-search.js';
import {
  parseLegacySearchQuery,
  parseIndexedContextInput,
  type LegacySearchQuery,
  type IndexedContextInput,
} from './legacy-search.js';
import {
  parseLegacyContextIdentity,
  type LegacyContextIdentity,
} from './legacy-context-lifecycle.js';
import { parseObservedRecordId } from './observed-state.js';
import { validateSourceRef, type SourceRef } from './metadata.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const SEARCH_INPUT_BYTES = 8 * 1024;
export const SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;
export type SearchResponseScope = Pick<
  LegacyContextIdentity,
  'tenant_id' | 'workspace_id' | 'project_id'
>;
export type LegacyIndexedSearchHit = IndexedContextInput &
  SearchResponseScope & { schema_version: 1; rank_source: 'fts' };
export interface LegacyMemorySearchHit extends SearchResponseScope {
  schema_version: 1;
  id: string;
  title: 'ai-memory';
  snippet: string;
  revision: number;
  score: number;
  rank_source: 'memory';
  classification: 'restricted';
  source_refs: SourceRef[];
}
export type LegacySearchHit = LegacyIndexedSearchHit | LegacyMemorySearchHit;
export interface LegacySearchResult {
  schema_version: 1;
  query: string;
  scope: SearchResponseScope;
  trace_id: string;
  hits: LegacySearchHit[];
  degraded: boolean;
  backend: 'postgres';
  vector_used: false;
  memory_used: boolean;
  source_refs: SourceRef[];
}
export interface ProjectSearchEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: ProjectSearchPage;
}
export interface LegacySearchEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: LegacySearchResult;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected search data');
  return value as Record<string, unknown>;
}
function scopeOf(value: unknown, expected: SearchResponseScope): SearchResponseScope {
  const row = object(value);
  const identity = parseLegacyContextIdentity({
    tenant_id: expected.tenant_id,
    workspace_id: expected.workspace_id,
    project_id: expected.project_id,
    actor_id: 'validation',
    client_id: 'validation',
  });
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (row[field] !== identity[field]) throw new TypeError('Search scope mismatch');
  return {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child))
        .join(',') +
      '}'
    );
  return JSON.stringify(value)!;
}
function sources(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || value.length > 6400) throw new TypeError('Invalid search sources');
  return value.map(validateSourceRef);
}
function envelope(value: unknown, trace: string) {
  const row = object(JSON.parse(syncJsonSnapshot(value, SEARCH_RESPONSE_BYTES)));
  if (
    typeof trace !== 'string' ||
    !trace.trim() ||
    trace.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace) ||
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !Object.hasOwn(row, 'data')
  )
    throw new TypeError('Search envelope mismatch');
  return row;
}
export function projectSearchSources(type: ProjectSearchQuery['type']): SourceRef[] {
  return [
    ...(type === 'context_item' ? [] : [{ type: 'postgres', id: 'wcp_work_items' }]),
    ...(type === 'work_item' ? [] : [{ type: 'postgres', id: 'wcp_context_items' }]),
  ];
}
export function parseProjectSearchEnvelope(
  value: unknown,
  input: ProjectSearchQuery,
  expected: SearchResponseScope,
  trace: string,
): ProjectSearchEnvelope {
  const query = parseProjectSearchQuery(JSON.parse(syncJsonSnapshot(input, SEARCH_INPUT_BYTES)));
  const row = envelope(value, trace);
  const data = parseProjectSearchPage(row.data, query);
  scopeOf(data.scope, expected);
  const source_refs = sources(row.source_refs);
  if (canonical(source_refs) !== canonical(projectSearchSources(query.type)))
    throw new TypeError('Unexpected project search sources');
  return { schema_version: 1, trace_id: trace, source_refs, data };
}
export function parseLegacySearchEnvelope(
  value: unknown,
  input: LegacySearchQuery,
  expected: SearchResponseScope,
  trace: string,
): LegacySearchEnvelope {
  const query = parseLegacySearchQuery(JSON.parse(syncJsonSnapshot(input, SEARCH_INPUT_BYTES)));
  const outer = envelope(value, trace),
    row = object(outer.data);
  const scope = scopeOf(row.scope, expected);
  if (
    row.schema_version !== 1 ||
    row.query !== query.query ||
    row.trace_id !== trace ||
    row.backend !== 'postgres' ||
    row.vector_used !== false ||
    typeof row.degraded !== 'boolean' ||
    typeof row.memory_used !== 'boolean' ||
    !Array.isArray(row.hits) ||
    row.hits.length > query.budget ||
    (query.use_vector && !row.degraded) ||
    (row.memory_used && row.degraded !== query.use_vector)
  )
    throw new TypeError('Legacy search result mismatch');
  let memoryCount = 0;
  const ids = new Set<string>();
  const hits = row.hits.map((value): LegacySearchHit => {
    const hit = object(value);
    scopeOf(hit, scope);
    if (hit.schema_version !== 1 || !['fts', 'memory'].includes(hit.rank_source as string))
      throw new TypeError('Invalid search hit');
    const id = parseObservedRecordId(hit.id);
    const key = JSON.stringify([hit.rank_source, id]);
    if (ids.has(key)) throw new TypeError('Duplicate search hit');
    ids.add(key);
    if (hit.rank_source === 'fts') {
      if (
        memoryCount > 0 ||
        !Object.hasOwn(hit, 'expires_at') ||
        !Object.hasOwn(hit, 'classification')
      )
        throw new TypeError('Invalid local search ordering or fields');
      const { schema_version: _v, tenant_id: _t, workspace_id: _w, project_id: _p, ...body } = hit;
      const parsed = parseIndexedContextInput(body);
      return { ...parsed, ...scope, schema_version: 1, rank_source: 'fts' };
    }
    memoryCount++;
    if (
      !row.memory_used ||
      hit.title !== 'ai-memory' ||
      hit.classification !== 'restricted' ||
      Object.hasOwn(hit, 'expires_at') ||
      typeof hit.snippet !== 'string' ||
      hit.snippet.length > 65536 ||
      typeof hit.revision !== 'number' ||
      !Number.isSafeInteger(hit.revision) ||
      hit.revision < 0 ||
      hit.score !== 1 / memoryCount ||
      !Array.isArray(hit.source_refs) ||
      hit.source_refs.length > 64
    )
      throw new TypeError('Invalid memory search hit');
    return {
      ...scope,
      schema_version: 1,
      id,
      title: 'ai-memory',
      snippet: hit.snippet,
      revision: hit.revision,
      score: hit.score as number,
      rank_source: 'memory',
      classification: 'restricted',
      source_refs: hit.source_refs.map(validateSourceRef),
    };
  });
  const source_refs = sources(row.source_refs),
    outerSources = sources(outer.source_refs);
  const combined = hits.flatMap((hit) => hit.source_refs);
  if (
    canonical(source_refs) !== canonical(combined) ||
    canonical(outerSources) !== canonical(combined)
  )
    throw new TypeError('Search source order or content mismatch');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: outerSources,
    data: {
      schema_version: 1,
      query: query.query,
      scope,
      trace_id: trace,
      hits,
      degraded: row.degraded,
      backend: 'postgres',
      vector_used: false,
      memory_used: row.memory_used,
      source_refs,
    },
  };
}
