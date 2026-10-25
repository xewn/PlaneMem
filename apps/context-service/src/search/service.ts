import { renderMcpResource, type ContextPack, type ContextScope } from '@planemem/context-compiler';

export interface SearchHit {
  schema_version: 1;
  id: string;
  snippet: string;
  rank: number;
  source_refs: ContextPack['source_refs'];
  trace_id: string;
}

export interface SearchResult {
  schema_version: 1;
  hits: SearchHit[];
  trace_id: string;
  scope: ContextScope;
  fallback: boolean;
}

export class ContextSearchService {
  private readonly packs = new Map<string, ContextPack>();

  health(): {
    service: 'context-search';
    version: '0.1.0';
    status: 'ok';
    ready: true;
    metrics: { packs: number };
  } {
    return {
      service: 'context-search',
      version: '0.1.0',
      status: 'ok',
      ready: true,
      metrics: { packs: this.packs.size },
    };
  }

  addPack(pack: ContextPack): void {
    this.packs.set(pack.pack_hash, pack);
  }

  searchProjectContext(query: string, scope: ContextScope, budget: number): SearchResult {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits: SearchHit[] = [];
    for (const pack of this.packs.values()) {
      if (
        pack.scope.tenant_id !== scope.tenant_id ||
        pack.scope.workspace_id !== scope.workspace_id ||
        pack.scope.project_id !== scope.project_id
      )
        continue;
      for (const item of pack.items) {
        const content = item.content.toLowerCase();
        const score = terms.filter((term) => content.includes(term)).length;
        if (score > 0 && hits.length < budget)
          hits.push({
            schema_version: 1,
            id: item.id,
            snippet: item.content.slice(0, 240),
            rank: score,
            source_refs: item.source_refs,
            trace_id: pack.trace_id,
          });
      }
    }
    return {
      schema_version: 1,
      hits: hits.sort((left, right) => right.rank - left.rank || left.id.localeCompare(right.id)),
      trace_id: 'trace_search',
      scope,
      fallback: hits.length === 0,
    };
  }

  getContextResource(uri: string, scope?: ContextScope): ContextPack | undefined {
    const prefix = 'wcp://context/';
    if (!uri.startsWith(prefix)) return undefined;
    const pack = this.packs.get(uri.slice(prefix.length));
    if (
      pack !== undefined &&
      scope !== undefined &&
      (pack.scope.tenant_id !== scope.tenant_id ||
        pack.scope.workspace_id !== scope.workspace_id ||
        pack.scope.project_id !== scope.project_id)
    ) {
      return undefined;
    }
    return pack;
  }

  getMcpResource(
    uri: string,
    scope?: ContextScope,
  ): { uri: string; mimeType: string; text: string } | undefined {
    const pack = this.getContextResource(uri, scope);
    return pack === undefined ? undefined : renderMcpResource(pack);
  }
}
