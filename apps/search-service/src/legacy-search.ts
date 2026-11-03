import {
  ContractError,
  parseLegacySearchQuery,
  parseIndexedContextInput,
  parseWorkItemProjectionQuery,
  type LegacySearchQuery,
} from '@planemem/contracts';
import type { ProjectSearchDatabase } from './postgres-search.js';
import type { SearchHit, SearchResult, SearchScope } from './service.js';

export class PostgresLegacySearch {
  constructor(private readonly db: ProjectSearchDatabase | undefined) {}

  async projectReadable(
    scope: SearchScope & { read_restricted: boolean },
    trace_id: string,
  ): Promise<boolean> {
    if (!this.db)
      throw new ContractError('SEARCH_STORAGE_UNAVAILABLE', 'Context storage is not configured', {
        trace_id,
        retryable: true,
      });
    try {
      const rows = await this.db.query<{ id: string }>(
        `SELECT id FROM wcp_projects WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3
        AND deleted_at IS NULL ${scope.read_restricted ? '' : "AND classification <> 'restricted'"}`,
        [scope.tenant_id, scope.workspace_id, scope.project_id],
      );
      return rows.length === 1;
    } catch {
      throw new ContractError(
        'SEARCH_STORAGE_UNAVAILABLE',
        'Project visibility could not be read',
        { trace_id, retryable: true },
      );
    }
  }

  async read(
    scope: SearchScope & { read_restricted: boolean },
    id: string,
    trace_id: string,
  ): Promise<SearchHit | undefined> {
    try {
      parseWorkItemProjectionQuery({ item_id: id });
    } catch {
      throw new ContractError('INVALID_INPUT', 'Invalid context resource ID', { trace_id });
    }
    if (!this.db)
      throw new ContractError('SEARCH_STORAGE_UNAVAILABLE', 'Context storage is not configured', {
        trace_id,
        retryable: true,
      });
    let rows: Record<string, unknown>[];
    try {
      rows = await this.db.query<Record<string, unknown>>(
        `SELECT h.id, h.title, h.snippet, h.revision::text AS revision,
        h.score, h.rank_source, h.source_refs, h.classification, h.expires_at
        FROM wcp_context_hits h
        WHERE h.tenant_id = $1 AND h.workspace_id = $2 AND h.project_id = $3 AND h.id = $4
          AND h.deleted_at IS NULL AND (h.expires_at IS NULL OR h.expires_at > statement_timestamp())
          ${scope.read_restricted ? '' : "AND h.classification <> 'restricted'"}
          AND EXISTS (SELECT 1 FROM wcp_projects p WHERE p.id = $3 AND p.tenant_id = $1 AND p.workspace_id = $2
            AND p.deleted_at IS NULL ${scope.read_restricted ? '' : "AND p.classification <> 'restricted'"})`,
        [scope.tenant_id, scope.workspace_id, scope.project_id, id],
      );
    } catch {
      throw new ContractError('SEARCH_STORAGE_UNAVAILABLE', 'Context storage could not be read', {
        trace_id,
        retryable: true,
      });
    }
    if (!rows[0]) return undefined;
    try {
      const row = rows[0];
      if (typeof row.revision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(row.revision))
        throw new Error();
      const hit = parseIndexedContextInput({
        ...row,
        revision: Number(row.revision),
        expires_at: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
      });
      return {
        ...hit,
        schema_version: 1,
        tenant_id: scope.tenant_id,
        workspace_id: scope.workspace_id,
        project_id: scope.project_id,
      };
    } catch {
      throw new ContractError('SEARCH_RESULT_INVALID', 'Stored context resource is invalid', {
        trace_id,
      });
    }
  }

  async search(
    scope: SearchScope & { read_restricted: boolean },
    input: LegacySearchQuery,
    trace_id: string,
  ): Promise<SearchResult> {
    let query: Required<LegacySearchQuery>;
    try {
      query = parseLegacySearchQuery(input);
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid search query',
        { trace_id },
      );
    }
    if (!this.db)
      throw new ContractError(
        'SEARCH_STORAGE_UNAVAILABLE',
        'Context search storage is not configured',
        { trace_id, retryable: true },
      );
    let rows: Record<string, unknown>[];
    try {
      rows = await this.db.query<Record<string, unknown>>(
        `SELECT h.id, h.title, h.snippet, h.revision::text AS revision,
        ts_rank_cd(to_tsvector('simple'::regconfig, h.title || ' ' || h.snippet), plainto_tsquery('simple'::regconfig, $4::text), 32) AS score,
        h.source_refs, h.classification, h.expires_at
        FROM wcp_context_hits h
        WHERE h.tenant_id = $1 AND h.workspace_id = $2 AND h.project_id = $3
          AND h.deleted_at IS NULL AND (h.expires_at IS NULL OR h.expires_at > statement_timestamp())
          ${scope.read_restricted ? '' : "AND h.classification <> 'restricted'"}
          AND EXISTS (SELECT 1 FROM wcp_projects p WHERE p.id = $3 AND p.tenant_id = $1 AND p.workspace_id = $2
            AND p.deleted_at IS NULL ${scope.read_restricted ? '' : "AND p.classification <> 'restricted'"})
          AND to_tsvector('simple'::regconfig, h.title || ' ' || h.snippet) @@ plainto_tsquery('simple'::regconfig, $4::text)
        ORDER BY score DESC, h.updated_at DESC, h.id LIMIT $5`,
        [scope.tenant_id, scope.workspace_id, scope.project_id, query.query, query.budget],
      );
    } catch {
      throw new ContractError(
        'SEARCH_STORAGE_UNAVAILABLE',
        'Context search storage could not be read',
        { trace_id, retryable: true },
      );
    }
    let hits: SearchHit[];
    try {
      hits = rows.map((row) => {
        if (typeof row.revision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(row.revision))
          throw new Error();
        const hit = parseIndexedContextInput({
          ...row,
          revision: Number(row.revision),
          rank_source: 'fts',
          expires_at:
            row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
        });
        return {
          ...hit,
          schema_version: 1,
          tenant_id: scope.tenant_id,
          workspace_id: scope.workspace_id,
          project_id: scope.project_id,
        } as SearchHit;
      });
    } catch {
      throw new ContractError(
        'SEARCH_RESULT_INVALID',
        'Stored context search records are invalid',
        { trace_id },
      );
    }
    return {
      schema_version: 1,
      query: query.query,
      scope: {
        tenant_id: scope.tenant_id,
        workspace_id: scope.workspace_id,
        project_id: scope.project_id,
      },
      trace_id,
      hits,
      degraded: query.use_vector,
      backend: 'postgres',
      vector_used: false,
      source_refs: hits.flatMap((hit) => hit.source_refs),
    };
  }
}
