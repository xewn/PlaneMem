import {
  ContractError,
  parseObservedRecordId,
  parseObservedWorkItemListQuery,
  parseObservedWorkItemPage,
} from '@planemem/contracts';
import type { CommandRouter } from './router.js';
import type { WorkbenchDatabase } from './workbench/repository.js';
import { fingerprint } from './idempotency.js';

export function registerObservedDirectory(
  router: CommandRouter,
  db: WorkbenchDatabase | undefined,
) {
  router.register('workitem.observed.list', async ({ input, context }) => {
    let query;
    let queryKey: string;
    let after: string | null = null;
    try {
      query = parseObservedWorkItemListQuery(input);
      queryKey = fingerprint([
        'plane-observed-list-v2',
        context.tenant_id,
        context.workspace_id,
        context.project_id,
        context.actor_id,
        context.client_id,
        context.capability.includes('data.restricted.read'),
        query.query,
        query.state,
        query.limit,
      ]);
      if (query.cursor !== undefined) {
        const raw: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (!Array.isArray(raw) || raw.length !== 3 || raw[0] !== 2 || raw[1] !== queryKey)
          throw new Error('Cursor does not match this directory query');
        after = parseObservedRecordId(raw[2]);
      }
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid observation directory query',
        { trace_id: context.trace_id },
      );
    }
    const unavailable = () =>
      new ContractError(
        'OBSERVED_STATE_UNAVAILABLE',
        'Observation directory storage is unavailable',
        { trace_id: context.trace_id, retryable: true },
      );
    if (!db) throw unavailable();
    let rows: Record<string, unknown>[];
    try {
      rows = await db.query<Record<string, unknown>>(
        `WITH parent AS (
        SELECT classification FROM wcp_projects WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3
          AND deleted_at IS NULL AND ($4::boolean OR classification IN ('public','internal','confidential'))
      ), visible AS (
        SELECT s.external_id, e.aggregate_id, s.plane_version::text AS plane_version,
          s.source_event_id, e.event_type, s.observed_at, s.deleted_at,
          CASE WHEN s.deleted_at IS NULL THEN 'active' ELSE 'deleted' END AS state,
          CASE WHEN s.deleted_at IS NOT NULL THEN NULL ELSE LEFT(CASE
            WHEN jsonb_typeof(s.fields->'title') = 'string' AND BTRIM(s.fields->>'title') <> ''
              THEN s.fields->>'title' ELSE s.external_id END, 2000) END AS title,
          CASE WHEN s.deleted_at IS NOT NULL THEN NULL ELSE LEFT(s.status, 255) END AS status,
          (ARRAY['public','internal','confidential','restricted'])[GREATEST(
            COALESCE(array_position(ARRAY['public','internal','confidential','restricted'], h.classification), 4),
            COALESCE(array_position(ARRAY['public','internal','confidential','restricted'], p.classification), 4))] AS classification
        FROM wcp_projection_states s CROSS JOIN parent p
        JOIN wcp_events e ON e.event_id = s.source_event_id AND e.tenant_id = s.tenant_id
          AND e.workspace_id = s.workspace_id AND COALESCE(e.project_id, e.aggregate_id) = s.project_id
          AND e.aggregate_type = 'work_item' AND e.schema_version = 1 AND e.aggregate_version = s.plane_version
          AND e.payload = s.fields AND e.occurred_at = s.observed_at
          AND e.event_type IN ('WorkItemCreated','WorkItemUpdated','WorkItemStatusConfirmed','WorkItemDeleted','WorkItemRestored')
        JOIN wcp_context_hits h ON h.tenant_id = s.tenant_id AND h.workspace_id = s.workspace_id
          AND h.project_id = s.project_id AND h.id = 'plane:WorkItem:' || s.external_id AND h.revision = s.plane_version
        WHERE s.tenant_id = $1 AND s.workspace_id = $2 AND s.project_id = $3
          AND s.entity_kind = 'WorkItem' AND s.authority = 'plane'
          AND COALESCE(s.fields->>'external_id', e.aggregate_id) = s.external_id
          AND s.status IS NOT DISTINCT FROM CASE WHEN jsonb_typeof(s.fields->'status') = 'string' THEN s.fields->>'status' ELSE NULL END
          AND ($4::boolean OR h.classification IN ('public','internal','confidential'))
          AND ((s.deleted_at IS NULL AND e.event_type <> 'WorkItemDeleted' AND h.deleted_at IS NULL
            AND (h.expires_at IS NULL OR h.expires_at > statement_timestamp()))
            OR (e.event_type = 'WorkItemDeleted' AND s.deleted_at = s.observed_at AND h.deleted_at = s.deleted_at
              AND s.status IS NULL AND s.fields = jsonb_build_object('external_id', s.external_id)))
          AND ($5 = 'all' OR ($5 = 'active' AND s.deleted_at IS NULL) OR ($5 = 'deleted' AND s.deleted_at IS NOT NULL))
          AND ($6::text IS NULL OR s.external_id COLLATE "C" > $6::text COLLATE "C")
      ), page AS (
        SELECT * FROM visible
        WHERE $8::text = ''
          OR strpos(translate(external_id, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), translate($8::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0
          OR strpos(translate(aggregate_id, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), translate($8::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0
          OR (state = 'active' AND strpos(translate(title, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), translate($8::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) > 0)
        ORDER BY external_id COLLATE "C" ASC LIMIT $7
      ) SELECT statement_timestamp() AS checked_at,
        COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY external_id COLLATE "C") FROM page), '[]'::jsonb) AS items
      FROM parent`,
        [
          context.tenant_id,
          context.workspace_id,
          context.project_id,
          context.capability.includes('data.restricted.read'),
          query.state,
          after,
          query.limit + 1,
          query.query,
        ],
      );
    } catch {
      throw unavailable();
    }
    if (!rows.length)
      throw new ContractError('NOT_FOUND', 'Observed project is unavailable', {
        trace_id: context.trace_id,
      });
    try {
      const row = rows[0]!;
      if (rows.length !== 1 || !Array.isArray(row.items) || row.items.length > query.limit + 1)
        throw new Error();
      const time = (value: unknown): string => {
        if (!(value instanceof Date) && typeof value !== 'string') throw new Error();
        return new Date(value).toISOString();
      };
      const items = row.items.slice(0, query.limit).map((raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
        const item = raw as Record<string, unknown>;
        if (typeof item.plane_version !== 'string' || !/^[1-9][0-9]*$/.test(item.plane_version))
          throw new Error();
        const external_id = parseObservedRecordId(item.external_id);
        return {
          ...item,
          external_id,
          title:
            item.state === 'deleted'
              ? item.title
              : typeof item.title === 'string' && item.title.trim()
                ? item.title
                : external_id,
          plane_version: Number(item.plane_version),
          observed_at: time(item.observed_at),
          deleted_at: item.deleted_at === null ? null : time(item.deleted_at),
        };
      });
      const scope = {
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
      };
      const data = parseObservedWorkItemPage(
        {
          schema_version: 1,
          scope,
          checked_at: time(row.checked_at),
          items,
          ...(row.items.length > query.limit
            ? {
                next_cursor: Buffer.from(
                  JSON.stringify([2, queryKey, items.at(-1)!.external_id]),
                ).toString('base64url'),
              }
            : {}),
        },
        scope,
        query,
      );
      return { schema_version: 1, trace_id: context.trace_id, source_refs: [], data };
    } catch {
      throw new ContractError(
        'OBSERVED_STATE_INVALID',
        'Stored observation directory metadata is invalid',
        { trace_id: context.trace_id },
      );
    }
  });
}
