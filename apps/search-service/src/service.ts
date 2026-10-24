export interface SearchScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}

export interface SearchHit extends SearchScope {
  schema_version: 1;
  id: string;
  title: string;
  snippet: string;
  revision: number;
  score: number;
  rank_source: 'fts' | 'vector' | 'rrf';
  source_refs: Array<{ type: string; id: string }>;
}

export interface SearchResult {
  schema_version: 1;
  query: string;
  scope: SearchScope;
  trace_id: string;
  hits: SearchHit[];
  degraded: boolean;
  source_refs: Array<{ type: string; id: string }>;
}

export class SearchService {
  private readonly hits: SearchHit[] = [];
  private readonly vector_enabled: boolean;

  constructor(options: { vector_enabled: boolean }) {
    this.vector_enabled = options.vector_enabled;
  }

  health(): {
    service: 'search-service';
    version: '0.1.0';
    status: 'ok' | 'degraded';
    ready: true;
    vector_enabled: boolean;
  } {
    return {
      service: 'search-service',
      version: '0.1.0',
      status: this.vector_enabled ? 'ok' : 'degraded',
      ready: true,
      vector_enabled: this.vector_enabled,
    };
  }

  index(
    hit: Omit<SearchHit, 'schema_version' | 'rank_source'> & {
      rank_source?: SearchHit['rank_source'];
    },
  ): SearchHit {
    const stored: SearchHit = { schema_version: 1, rank_source: hit.rank_source ?? 'fts', ...hit };
    this.hits.push({ ...stored, source_refs: stored.source_refs.map((ref) => ({ ...ref })) });
    return clone(stored);
  }

  search(
    input: SearchScope & { query: string; trace_id: string; budget?: number; use_vector?: boolean },
  ): SearchResult {
    const normalized = input.query.toLowerCase();
    const scoped = this.hits.filter(
      (hit) =>
        hit.tenant_id === input.tenant_id &&
        hit.workspace_id === input.workspace_id &&
        hit.project_id === input.project_id,
    );
    const matched = scoped
      .filter((hit) => `${hit.title} ${hit.snippet}`.toLowerCase().includes(normalized))
      .sort((left, right) => right.score - left.score)
      .slice(0, input.budget ?? 20)
      .map(clone);
    return {
      schema_version: 1,
      query: input.query,
      scope: {
        tenant_id: input.tenant_id,
        workspace_id: input.workspace_id,
        project_id: input.project_id,
      },
      trace_id: input.trace_id,
      hits: matched,
      degraded: !this.vector_enabled || input.use_vector === false,
      source_refs: matched.flatMap((hit) => hit.source_refs),
    };
  }
}

function clone(hit: SearchHit): SearchHit {
  return { ...hit, source_refs: hit.source_refs.map((ref) => ({ ...ref })) };
}
