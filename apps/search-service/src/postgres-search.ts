import { createHash } from 'node:crypto';
import {
  ContractError,
  parseProjectSearchQuery,
  parseProjectSearchPage,
  parseWorkItemProjectionQuery,
  type ProjectSearchQuery,
  type NormalizedProjectSearchQuery,
  type ProjectSearchPage,
} from '@planemem/contracts';
import type { SearchScope } from './service.js';

export interface ProjectSearchDatabase {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
interface Position {
  score: number;
  updated: string;
  type: 'work_item' | 'context_item';
  id: string;
}

function encode(position: Position, key: string): string {
  return Buffer.from(
    JSON.stringify([1, key, position.score, position.updated, position.type, position.id]),
  ).toString('base64url');
}
function decode(cursor: string | undefined, key: string, trace_id: string): Position | undefined {
  if (cursor === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 6) throw new Error();
    const [version, bound, score, updated, type, id] = value;
    if (
      version !== 1 ||
      bound !== key ||
      typeof score !== 'number' ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1 ||
      typeof updated !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(updated) ||
      !['work_item', 'context_item'].includes(type)
    )
      throw new Error();
    const milliseconds = updated.slice(0, 23) + 'Z';
    if (updated.startsWith('0000') || new Date(milliseconds).toISOString() !== milliseconds)
      throw new Error();
    const { item_id } = parseWorkItemProjectionQuery({ item_id: id });
    const position = { score, updated, type: type as Position['type'], id: item_id };
    if (encode(position, key) !== cursor) throw new Error();
    return position;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid search cursor. Restart with the current scope and filters.',
      { trace_id },
    );
  }
}

const contextBody = `(CASE jsonb_typeof(c.content) WHEN 'string' THEN c.content #>> '{}' ELSE c.content::text END)`;
// Keep these immutable expressions in sync with migration 031's expression indexes.
const workVector = `(setweight(to_tsvector('simple'::regconfig, coalesce(w.title, '') || ' ' || coalesce(w.external_id, '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce(w.description, '') || ' ' || coalesce(w.owner, '')), 'B'))`;
const contextVector = `(setweight(to_tsvector('simple'::regconfig, coalesce(c.title, '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce(${contextBody}, '')), 'B'))`;

export class PostgresProjectSearch {
  constructor(private readonly db: ProjectSearchDatabase | undefined) {}

  async search(
    scope: SearchScope & { read_restricted: boolean },
    input: ProjectSearchQuery,
    trace_id: string,
  ): Promise<ProjectSearchPage> {
    let query: NormalizedProjectSearchQuery;
    try {
      query = parseProjectSearchQuery(input);
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
        'Project search storage is not configured',
        { trace_id, retryable: true },
      );
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          'project-search-v1',
          scope.tenant_id,
          scope.workspace_id,
          scope.project_id,
          scope.read_restricted,
          query.query,
          query.type,
          query.mode,
          query.include_inactive_context,
        ]),
      )
      .digest('hex');
    const after = decode(query.cursor, key, trace_id);
    const params: unknown[] = [scope.tenant_id, scope.workspace_id, scope.project_id, query.query];
    const branches: string[] = [];
    const term = `plainto_tsquery('simple'::regconfig, $4::text)`;
    if (query.type !== 'context_item') {
      branches.push(`SELECT 'work_item'::text AS type, w.id, w.title, left(w.description, 360) AS snippet,
        w.version::text AS version, w.status, w.classification, w.updated_at, NULL::timestamptz AS expires_at, w.source_refs,
        ${query.mode === 'fts' ? `ts_rank_cd(${workVector}, ${term}, 32)` : '0::real'} AS score
        FROM wcp_work_items w
        WHERE w.tenant_id = $1 AND w.workspace_id = $2 AND w.project_id = $3 AND w.deleted_at IS NULL
          ${scope.read_restricted ? '' : "AND w.classification <> 'restricted'"}
          AND ${query.mode === 'fts' ? `${workVector} @@ ${term}` : "strpos(lower(concat_ws(' ', w.title, w.external_id, w.description, w.owner)), lower($4::text)) > 0"}`);
    }
    if (query.type !== 'work_item') {
      branches.push(`SELECT 'context_item'::text AS type, c.id, c.title, left(${contextBody}, 360) AS snippet,
        c.version::text AS version, c.status, c.classification, c.updated_at, c.expires_at, c.source_refs,
        ${query.mode === 'fts' ? `ts_rank_cd(${contextVector}, ${term}, 32)` : '0::real'} AS score
        FROM wcp_context_items c
        WHERE c.tenant_id = $1 AND c.workspace_id = $2 AND c.project_id = $3 AND c.deleted_at IS NULL
          ${scope.read_restricted ? '' : "AND c.classification <> 'restricted'"}
          ${query.include_inactive_context ? '' : "AND c.status IN ('confirmed', 'proposed') AND (c.expires_at IS NULL OR c.expires_at > statement_timestamp())"}
          AND ${query.mode === 'fts' ? `${contextVector} @@ ${term}` : `strpos(lower(concat_ws(' ', c.title, ${contextBody})), lower($4::text)) > 0`}`);
    }
    let continuation = '';
    if (after) {
      const score = params.push(after.score),
        time = params.push(after.updated),
        type = params.push(after.type),
        id = params.push(after.id);
      continuation = `AND (score < $${score}::real OR (score = $${score}::real AND
        (updated_at < $${time}::timestamptz OR (updated_at = $${time}::timestamptz AND
          (type > $${type}::text OR (type = $${type}::text AND id > $${id}::text))))))`;
    }
    let rows: Array<Record<string, unknown> & Position>;
    try {
      rows = await this.db.query<Record<string, unknown> & Position>(
        `WITH candidates AS (${branches.join(' UNION ALL ')})
        SELECT candidates.*, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated
        FROM candidates WHERE EXISTS (SELECT 1 FROM wcp_projects p
          WHERE p.tenant_id = $1 AND p.workspace_id = $2 AND p.id = $3 AND p.deleted_at IS NULL
            ${scope.read_restricted ? '' : "AND p.classification <> 'restricted'"})
        ${continuation} ORDER BY score DESC, updated_at DESC, type, id LIMIT $${params.push(query.limit + 1)}`,
        params,
      );
    } catch {
      throw new ContractError(
        'SEARCH_STORAGE_UNAVAILABLE',
        'Project search storage could not be read',
        { trace_id, retryable: true },
      );
    }
    const selected = rows.slice(0, query.limit),
      last = selected[selected.length - 1];
    const next =
      rows.length > query.limit && last
        ? encode({ score: last.score, updated: last.updated, type: last.type, id: last.id }, key)
        : undefined;
    try {
      const timestamp = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
      if (next) decode(next, key, trace_id);
      return parseProjectSearchPage(
        {
          query: query.query,
          type: query.type,
          mode: query.mode,
          include_inactive_context: query.include_inactive_context,
          scope: {
            tenant_id: scope.tenant_id,
            workspace_id: scope.workspace_id,
            project_id: scope.project_id,
          },
          hits: selected.map((row) => ({
            ...row,
            updated_at: timestamp(row.updated_at),
            expires_at: timestamp(row.expires_at),
          })),
          ...(next === undefined ? {} : { next_cursor: next }),
          backend: 'postgres',
          vector_used: false,
        },
        query,
      );
    } catch {
      throw new ContractError(
        'SEARCH_RESULT_INVALID',
        'Stored project search records are invalid',
        { trace_id },
      );
    }
  }
}
