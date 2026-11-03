import {
  ContractError,
  parsePlaneInboxListQuery,
  parsePlaneInboxRecordQuery,
  parsePlaneInboxRecord,
  parsePlaneInboxPage,
  parsePlaneInboxIdentity,
  parsePlaneInboxSummaryQuery,
  parsePlaneInboxSummary,
  parsePlaneInboxDiagnosis,
  describePlaneInboxVersionPosition,
  type PlaneInboxRecord,
} from '@planemem/contracts';
import type { CommandRouter, RequestContext } from './router.js';
import type { WorkbenchDatabase } from './workbench/repository.js';
import { fingerprint } from './idempotency.js';

// Do not select the event body, signature material, raw hash or original trace.
// Classification is conservative across the event, current index and parent project.
export const planeInboxVisibleRows = `WITH visible AS (
  SELECT i.event_id, i.tenant_id, i.workspace_id, i.project_id, i.aggregate_type, i.aggregate_id,
    i.aggregate_version::text AS aggregate_version, i.status, i.attempts::text AS attempts, i.revision::text AS revision,
    i.received_at, i.updated_at, i.applied_at, i.last_error_code,
    CASE WHEN i.status = 'pending' THEN i.next_attempt_at ELSE NULL END AS next_attempt_at,
    CASE WHEN (i.aggregate_type = 'project' AND i.event_document->>'event_type' IN ('ProjectCreated','ProjectUpdated'))
      OR (i.aggregate_type = 'work_item' AND i.event_document->>'event_type' IN ('WorkItemCreated','WorkItemUpdated','WorkItemStatusConfirmed','WorkItemDeleted','WorkItemRestored'))
      THEN i.event_document->>'event_type' ELSE NULL END AS event_type,
    (ARRAY['public','internal','confidential','restricted'])[GREATEST(
      COALESCE(array_position(ARRAY['public','internal','confidential','restricted'], i.event_document->>'sensitivity'), 4),
      COALESCE(array_position(ARRAY['public','internal','confidential','restricted'], p.classification), 4),
      CASE WHEN h.id IS NULL THEN 1 ELSE COALESCE(array_position(ARRAY['public','internal','confidential','restricted'], h.classification), 4) END
    )] AS classification
  FROM wcp_plane_event_inbox i
  JOIN wcp_projects p ON p.tenant_id = i.tenant_id AND p.workspace_id = i.workspace_id
    AND p.id = i.project_id AND p.deleted_at IS NULL
  LEFT JOIN wcp_context_hits h ON h.tenant_id = i.tenant_id AND h.workspace_id = i.workspace_id
    AND h.project_id = i.project_id AND h.id = 'plane:' || CASE i.aggregate_type WHEN 'project' THEN 'Project' ELSE 'WorkItem' END
      || ':' || COALESCE(i.event_document->'payload'->>'external_id', i.aggregate_id)
  WHERE i.tenant_id = $1 AND i.workspace_id = $2 AND i.project_id = $3
)
SELECT *, statement_timestamp() AS checked_at FROM visible WHERE ($4::boolean OR classification <> 'restricted')`;

export function registerPlaneInboxReads(router: CommandRouter, db: WorkbenchDatabase | undefined) {
  router.register('plane.inbox.diagnosis', async ({ input, context }) => {
    authorize(context);
    let id: string;
    try {
      id = parsePlaneInboxRecordQuery(input).event_id;
    } catch (error) {
      throw invalidInput(error, context);
    }
    // Never substitute the latest visible version for the actual latest committed version.
    // Only readable, matching applied receipts from that tip may leave the database.
    const [row] = await read(
      db,
      `WITH readable AS (${planeInboxVisibleRows}),
      target AS (SELECT * FROM readable WHERE event_id = $5),
      latest AS (
        SELECT e.event_id, e.aggregate_version, e.event_type
        FROM wcp_events e JOIN target t ON e.tenant_id = t.tenant_id
          AND e.workspace_id = t.workspace_id AND COALESCE(e.project_id, e.aggregate_id) = t.project_id
          AND e.aggregate_type = t.aggregate_type AND e.aggregate_id = t.aggregate_id
        WHERE (e.aggregate_type = 'project' AND e.event_type IN ('ProjectCreated', 'ProjectUpdated'))
          OR (e.aggregate_type = 'work_item' AND e.event_type IN ('WorkItemCreated', 'WorkItemUpdated', 'WorkItemStatusConfirmed', 'WorkItemDeleted', 'WorkItemRestored'))
        ORDER BY e.aggregate_version DESC, e.event_id COLLATE "C" ASC LIMIT 2
      ),
      tip AS (SELECT * FROM latest WHERE aggregate_version = (SELECT MAX(aggregate_version) FROM latest)),
      visible_tip AS (
        SELECT r.* FROM tip e JOIN readable r ON r.event_id = e.event_id
          AND r.aggregate_version::bigint = e.aggregate_version AND r.event_type = e.event_type
        JOIN target t ON r.aggregate_type = t.aggregate_type AND r.aggregate_id = t.aggregate_id
        WHERE r.status = 'applied'
      ),
      safe_tip AS (SELECT * FROM visible_tip WHERE (SELECT COUNT(*) FROM visible_tip) = (SELECT COUNT(*) FROM tip)),
      expected AS (
        SELECT (s.aggregate_version::bigint + 1)::text AS version FROM safe_tip s CROSS JOIN target t
        WHERE (SELECT COUNT(*) FROM safe_tip) = 1 AND s.aggregate_version::bigint < t.aggregate_version::bigint
          AND (s.event_type <> 'WorkItemDeleted' OR t.event_type IN ('WorkItemDeleted', 'WorkItemRestored'))
      ),
      next_candidates AS (
        SELECT r.* FROM readable r CROSS JOIN target t
        WHERE r.aggregate_type = t.aggregate_type AND r.aggregate_id = t.aggregate_id
          AND r.aggregate_version = (SELECT version FROM expected)
        ORDER BY r.event_id COLLATE "C" ASC LIMIT 11
      ),
      same_candidates AS (
        SELECT r.* FROM readable r CROSS JOIN target t
        WHERE r.aggregate_type = t.aggregate_type AND r.aggregate_id = t.aggregate_id
          AND r.aggregate_version = t.aggregate_version AND r.event_id <> t.event_id
        ORDER BY r.event_id COLLATE "C" ASC LIMIT 11
      )
      SELECT to_jsonb(t) AS record,
        COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.event_id COLLATE "C") FROM safe_tip s), '[]'::jsonb) AS baseline,
        COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.event_id COLLATE "C") FROM next_candidates n), '[]'::jsonb) AS next_candidates,
        COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.event_id COLLATE "C") FROM same_candidates c), '[]'::jsonb) AS same_candidates
      FROM target t`,
      [...scopeParams(context), id],
      context,
    );
    if (!row)
      throw new ContractError('NOT_FOUND', 'Event diagnosis is unavailable in this project', {
        trace_id: context.trace_id,
      });
    try {
      const metadata = (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return planeInboxMetadata(value as Record<string, unknown>, context);
      };
      const record = metadata(row.record);
      if (!Array.isArray(row.baseline)) throw new Error();
      const baseline = row.baseline.map(metadata);
      const candidates = (value: unknown) => {
        if (!Array.isArray(value) || value.length > 11) throw new Error();
        return { items: value.slice(0, 10).map(metadata), has_more: value.length > 10 };
      };
      const data = parsePlaneInboxDiagnosis(
        {
          schema_version: 1,
          record,
          baseline,
          ...describePlaneInboxVersionPosition(record, baseline),
          next_version_candidates: candidates(row.next_candidates),
          same_version_candidates: candidates(row.same_candidates),
        },
        context,
        id,
      );
      return { schema_version: 1, trace_id: context.trace_id, source_refs: [], data };
    } catch {
      throw invalidStored(context);
    }
  });
  router.register('plane.inbox.summary', async ({ input, context }) => {
    authorize(context);
    try {
      parsePlaneInboxSummaryQuery(input);
    } catch (error) {
      throw invalidInput(error, context);
    }
    // All aggregates share one statement snapshot and one database clock. Filter visibility before counting.
    const [row] = await read(
      db,
      `WITH readable AS (${planeInboxVisibleRows})
      SELECT COUNT(*)::text AS total,
        (COUNT(*) FILTER (WHERE status = 'pending'))::text AS pending,
        (COUNT(*) FILTER (WHERE status = 'applied'))::text AS applied,
        (COUNT(*) FILTER (WHERE status = 'rejected'))::text AS rejected,
        (COUNT(*) FILTER (WHERE status = 'pending' AND next_attempt_at <= statement_timestamp()))::text AS due,
        (COUNT(*) FILTER (WHERE status = 'pending' AND next_attempt_at > statement_timestamp()))::text AS delayed,
        (COUNT(*) FILTER (WHERE status = 'pending' AND last_error_code = 'AGGREGATE_VERSION_GAP'))::text AS version_gap,
        MIN(received_at) FILTER (WHERE status = 'pending') AS oldest_pending_received_at,
        MIN(received_at) FILTER (WHERE status = 'pending' AND next_attempt_at <= statement_timestamp()) AS oldest_due_received_at,
        MIN(next_attempt_at) FILTER (WHERE status = 'pending') AS earliest_pending_attempt_at,
        MAX(received_at) AS latest_received_at, statement_timestamp() AS checked_at
      FROM readable
      HAVING EXISTS (SELECT 1 FROM wcp_projects p WHERE p.tenant_id = $1 AND p.workspace_id = $2
        AND p.id = $3 AND p.deleted_at IS NULL
        AND ($4::boolean OR p.classification IN ('public', 'internal', 'confidential')))`,
      scopeParams(context),
      context,
    );
    if (!row)
      throw new ContractError('NOT_FOUND', 'Event queue overview is unavailable in this project', {
        trace_id: context.trace_id,
      });
    try {
      const value = { ...row };
      for (const field of [
        'oldest_pending_received_at',
        'oldest_due_received_at',
        'earliest_pending_attempt_at',
        'latest_received_at',
        'checked_at',
      ]) {
        if (value[field] === null && field !== 'checked_at') continue;
        const raw = value[field];
        if (!(raw instanceof Date) && typeof raw !== 'string') throw new Error();
        value[field] = new Date(raw).toISOString();
      }
      const data = parsePlaneInboxSummary(
        {
          ...value,
          schema_version: 1,
          scope: scope(context),
          counts: {
            total: row.total,
            pending: row.pending,
            applied: row.applied,
            rejected: row.rejected,
            due: row.due,
            delayed: row.delayed,
            version_gap: row.version_gap,
          },
        },
        context,
      );
      return { schema_version: 1, trace_id: context.trace_id, source_refs: [], data };
    } catch {
      throw invalidStored(context);
    }
  });
  router.register('plane.inbox.list', async ({ input, context }) => {
    authorize(context);
    let query;
    let queryKey: string;
    let before: string | undefined;
    try {
      query = parsePlaneInboxListQuery(input);
      queryKey = fingerprint([
        'plane-inbox-v2',
        context.tenant_id,
        context.workspace_id,
        context.project_id,
        context.capability.includes('data.restricted.read'),
        query.status,
        query.pending_state,
        query.aggregate_id ?? null,
        query.limit,
      ]);
      if (query.cursor !== undefined) {
        const parts: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== 1 || parts[1] !== queryKey)
          throw new Error('Inbox scope, access or filters changed; start from the first page');
        before = parsePlaneInboxRecordQuery({ event_id: parts[2] }).event_id;
        if (
          Buffer.from(JSON.stringify([1, queryKey, before])).toString('base64url') !== query.cursor
        )
          throw new Error('Invalid inbox cursor');
      }
    } catch (error) {
      throw invalidInput(error, context);
    }
    const rows = await read(
      db,
      planeInboxVisibleRows +
        `
      AND ($5 = 'all' OR status = $5) AND ($6::text IS NULL OR aggregate_id = $6)
      AND ($7::text IS NULL OR event_id COLLATE "C" < $7 COLLATE "C")
      AND ($9 = 'all' OR (status = 'pending' AND (
        ($9 = 'due' AND next_attempt_at <= statement_timestamp())
        OR ($9 = 'delayed' AND next_attempt_at > statement_timestamp())
        OR ($9 = 'version_gap' AND last_error_code = 'AGGREGATE_VERSION_GAP')
      )))
      ORDER BY event_id COLLATE "C" DESC LIMIT $8`,
      [
        ...scopeParams(context),
        query.status,
        query.aggregate_id ?? null,
        before ?? null,
        query.limit + 1,
        query.pending_state,
      ],
      context,
    );
    try {
      const items = rows.slice(0, query.limit).map((row) => planeInboxMetadata(row, context));
      const data = parsePlaneInboxPage(
        {
          scope: scope(context),
          items,
          ...(rows.length > query.limit
            ? {
                next_cursor: Buffer.from(
                  JSON.stringify([1, queryKey, items[items.length - 1]!.event_id]),
                ).toString('base64url'),
              }
            : {}),
        },
        context,
        query,
      );
      return { schema_version: 1, trace_id: context.trace_id, source_refs: [], data };
    } catch {
      throw invalidStored(context);
    }
  });
  router.register('plane.inbox.read', async ({ input, context }) => {
    authorize(context);
    let id;
    try {
      id = parsePlaneInboxRecordQuery(input).event_id;
    } catch (error) {
      throw invalidInput(error, context);
    }
    const rows = await read(
      db,
      planeInboxVisibleRows + ' AND event_id = $5 LIMIT 1',
      [...scopeParams(context), id],
      context,
    );
    if (!rows.length)
      throw new ContractError('NOT_FOUND', 'Event receipt is unavailable in this project', {
        trace_id: context.trace_id,
      });
    try {
      const data = parsePlaneInboxRecord(planeInboxMetadata(rows[0]!, context), context, id);
      return {
        schema_version: 1,
        trace_id: context.trace_id,
        source_refs: [],
        data,
        plane_inbox_identity: parsePlaneInboxIdentity({
          ...scope(context),
          actor_id: context.actor_id,
          client_id: context.client_id,
        }),
        // UI eligibility only. The retry command independently checks current policy and visibility.
        plane_inbox_permissions: { retry: context.actor_type === 'human' },
      };
    } catch {
      throw invalidStored(context);
    }
  });
}

function authorize(context: RequestContext) {
  if (context.authenticated_client !== true || context.roles?.includes('admin') !== true)
    throw new ContractError(
      'DENIED',
      'An authenticated administrator is required to inspect event processing',
      { trace_id: context.trace_id },
    );
}
function scope(context: RequestContext) {
  return {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
}
function scopeParams(context: RequestContext) {
  return [
    context.tenant_id,
    context.workspace_id,
    context.project_id,
    context.capability.includes('data.restricted.read'),
  ];
}
export function planeInboxMetadata(
  row: Record<string, unknown>,
  context: RequestContext,
): PlaneInboxRecord {
  const value = { ...row, schema_version: 1 } as Record<string, unknown>;
  for (const field of [
    'received_at',
    'updated_at',
    'applied_at',
    'next_attempt_at',
    'checked_at',
  ]) {
    const raw = value[field];
    if (raw === null && (field === 'applied_at' || field === 'next_attempt_at')) continue;
    if (!(raw instanceof Date) && typeof raw !== 'string') throw new Error();
    value[field] = new Date(raw).toISOString();
  }
  return parsePlaneInboxRecord(value, context);
}
async function read(
  db: WorkbenchDatabase | undefined,
  sql: string,
  params: unknown[],
  context: RequestContext,
) {
  try {
    if (!db) throw new Error();
    return await db.query<Record<string, unknown>>(sql, params);
  } catch {
    throw new ContractError('PLANE_INBOX_UNAVAILABLE', 'Event receipt storage is unavailable', {
      trace_id: context.trace_id,
      retryable: true,
    });
  }
}
function invalidInput(error: unknown, context: RequestContext) {
  return new ContractError(
    'INVALID_INPUT',
    error instanceof Error ? error.message : 'Invalid inbox query',
    { trace_id: context.trace_id },
  );
}
function invalidStored(context: RequestContext) {
  return new ContractError(
    'PLANE_INBOX_INVALID',
    'Saved event processing metadata is inconsistent',
    { trace_id: context.trace_id },
  );
}
