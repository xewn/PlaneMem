import {
  ContractError,
  parseConflictReadQuery,
  parseConflictRegistryQuery,
  parseConflictRegistryRecord,
  parseConflictRegistryPage,
  encodeConflictRegistryCursor,
  compareConflictIds,
  foldConflictQuery,
  CONFLICT_REGISTRY_RECORD_BYTES,
  type ConflictRegistryQuery,
  CheckpointReadLimitError,
  CHECKPOINT_HISTORY_RESPONSE_BYTES,
  CHECKPOINT_READ_METADATA_BYTES,
  assertCheckpointReadBytes,
  parseSessionRegistryQuery,
  parseSessionRegistryPage,
  parseSessionRegistryPosition,
  encodeSessionRegistryCursor,
  SESSION_REGISTRY_SOURCES,
  type SessionRegistryQuery,
  parseHandoffRegistryQuery,
  parseHandoffRegistryPage,
  parseHandoffRegistryPosition,
  encodeHandoffRegistryCursor,
  HANDOFF_REGISTRY_SOURCES,
  HANDOFF_REGISTRY_SUMMARY_BYTES,
  type HandoffRegistryQuery,
  parseCheckpointRegistryQuery,
  parseCheckpointRegistryPage,
  parseCheckpointRegistryPosition,
  encodeCheckpointRegistryCursor,
  CHECKPOINT_REGISTRY_SOURCE,
  CHECKPOINT_REGISTRY_SUMMARY_BYTES,
  type CheckpointRegistryQuery,
  parseWorkItemProjection,
  type WorkItemProjection,
  type WorkItemListQuery,
  type ContextItemListQuery,
  parseWorkbenchOverview,
  parseWorkbenchAdminEnvelope,
  workbenchAdminSources,
  WORKBENCH_ADMIN_CHECKS,
  type WorkbenchAdminEnvelope,
  type WorkbenchAdminCount,
  WORKBENCH_AUDIT_LIMIT,
  WORKBENCH_AUDIT_METADATA_BYTES,
  WORKBENCH_AUDIT_DETAILS_BYTES,
  WORKBENCH_AUDIT_SOURCES_BYTES,
  parseWorkbenchAuditQuery,
  parseWorkbenchAuditRecord,
  parseWorkbenchAuditEnvelope,
  parseWorkbenchAuditPosition,
  encodeWorkbenchAuditCursor,
  type WorkbenchAuditQuery,
  type WorkbenchAuditEnvelope,
  type WorkbenchOverview,
  parseSessionClosureState,
  type SessionClosureState,
  CHECKPOINT_HISTORY_PAGE_SIZE,
  isUlid,
  parseCheckpointHistoryQuery,
  parseCheckpointHistoryEntry,
  parseCheckpointHistoryPage,
} from '@planemem/contracts';
import { contextQueryKey, decodeContextCursor, encodeContextCursor } from './context-pagination.js';
import { overviewQuery } from './overview-query.js';
import { auditQueryKey, decodeAuditCursor } from './audit-pagination.js';
import { sessionQueryKey, decodeSessionCursor } from './session-pagination.js';
import { handoffQueryKey, decodeHandoffCursor } from './handoff-pagination.js';
import { checkpointQueryKey, decodeCheckpointCursor } from './checkpoint-pagination.js';
import { conflictQueryKey, decodeConflictCursor } from './conflict-pagination.js';
import {
  workItemQueryKey,
  decodeWorkItemCursor,
  encodeWorkItemCursor,
} from './work-item-pagination.js';

export interface WorkbenchScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  read_restricted?: boolean;
}

export interface WorkbenchDatabase {
  query<T>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface WorkbenchEnvelope<T> {
  schema_version: 1;
  data: T;
  trace_id: string;
  source_refs: Array<{ type: string; id: string }>;
}

export type ContextFilters = ContextItemListQuery;

const source = (id: string): Array<{ type: string; id: string }> => [{ type: 'postgres', id }];

function readableProject(scope: WorkbenchScope, alias: 'w' | 'c' | 's' | 'h'): string {
  return `EXISTS (SELECT 1 FROM wcp_projects p WHERE p.tenant_id = ${alias}.tenant_id
    AND p.workspace_id = ${alias}.workspace_id AND p.id = ${alias}.project_id AND p.deleted_at IS NULL
    ${scope.read_restricted ? '' : "AND p.classification <> 'restricted'"})`;
}

// Conflicts carry copies of field values. Apply the source row's visibility
// before those copies (or their counts) leave the projection.
export function visibleConflicts(scope: WorkbenchScope): string {
  return `AND (${conflictClassification}) ${scope.read_restricted ? 'IS NOT NULL' : "<> 'restricted'"}`;
}

export function sourceClassification(alias: 'c' | 'u'): string {
  return `CASE replace(lower(${alias}.entity_type), '_', '')
    WHEN 'workitem' THEN (
      SELECT src.classification FROM wcp_work_items src
      WHERE src.tenant_id = ${alias}.tenant_id AND src.workspace_id = ${alias}.workspace_id AND src.project_id = ${alias}.project_id
        AND src.id = ${alias}.entity_id AND src.deleted_at IS NULL)
    WHEN 'contextitem' THEN (
      SELECT src.classification FROM wcp_context_items src
      WHERE src.tenant_id = ${alias}.tenant_id AND src.workspace_id = ${alias}.workspace_id AND src.project_id = ${alias}.project_id
        AND src.id = ${alias}.entity_id AND src.deleted_at IS NULL)
    WHEN 'session' THEN (
      SELECT 'internal'::text FROM wcp_sessions s WHERE s.tenant_id = ${alias}.tenant_id AND s.workspace_id = ${alias}.workspace_id
        AND s.project_id = ${alias}.project_id AND s.session_id = ${alias}.entity_id)
    ELSE 'restricted' END`;
}

const classifications = "ARRAY['public', 'internal', 'confidential', 'restricted']";
export const conflictClassification = `(SELECT CASE WHEN current_level IS NOT NULL THEN
  (${classifications})[GREATEST(array_position(${classifications}, current_level),
                               array_position(${classifications}, c.sensitivity))]
  END FROM (SELECT (${sourceClassification('c')}) AS current_level) AS source_visibility)`;

/**
 * Reads the scoped workbench projection from PostgreSQL and preserves the
 * trace/source envelope required by the public gateway contract.
 */
export class WorkbenchRepository {
  constructor(private readonly db: WorkbenchDatabase | undefined) {}

  async listOverview(
    scope: WorkbenchScope,
    trace_id: string,
  ): Promise<WorkbenchEnvelope<WorkbenchOverview>> {
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      overviewQuery(scope.read_restricted === true, visibleConflicts(scope)),
      scope,
    );
    const row = rows[0];
    if (!row)
      throw new ContractError('NOT_FOUND', 'Project is not available in the readable scope', {
        trace_id,
      });
    let data: WorkbenchOverview;
    try {
      const timestamp = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
      data = parseWorkbenchOverview({
        ...row,
        read_at: timestamp(row.read_at),
        last_activity_at: timestamp(row.last_activity_at),
      });
      if (data.project_id !== scope.project_id) throw new Error();
    } catch {
      throw new ContractError(
        'WORKBENCH_OVERVIEW_INVALID',
        'Stored overview data is inconsistent',
        { trace_id },
      );
    }
    return {
      schema_version: 1,
      data,
      trace_id,
      source_refs: [
        ...source('wcp_projects'),
        ...source('wcp_work_items'),
        ...source('wcp_context_items'),
        ...source('wcp_sessions'),
        ...source('wcp_agent_runs'),
        ...source('wcp_tool_calls'),
        ...source('wcp_conflicts'),
      ],
    };
  }

  async listWorkItems(
    scope: WorkbenchScope,
    trace_id: string,
    query: WorkItemListQuery = {},
  ): Promise<WorkbenchEnvelope<WorkItemProjection[]> & { next_cursor?: string }> {
    this.ensureDb(trace_id);
    const limit = query.limit ?? 25;
    const queryKey = workItemQueryKey(scope, query);
    const after = decodeWorkItemCursor(query.cursor, queryKey, trace_id);
    const params: unknown[] = [scope.tenant_id, scope.workspace_id, scope.project_id];
    const filters: string[] = [readableProject(scope, 'w')];
    if (!scope.read_restricted) filters.push("w.classification <> 'restricted'");
    if (query.status) filters.push(`w.status = $${params.push(query.status)}`);
    if (query.query) {
      const position = params.push(query.query);
      filters.push(
        `strpos(lower(concat_ws(' ', w.external_id, w.title, w.owner)), lower($${position}::text)) > 0`,
      );
    }
    if (after) {
      const time = params.push(after.updated);
      const id = params.push(after.id);
      filters.push(
        `(w.updated_at < $${time}::timestamptz OR (w.updated_at = $${time}::timestamptz AND w.id > $${id}))`,
      );
    }
    const rows = await this.query<Record<string, unknown> & { id: string; page_updated: string }>(
      `SELECT w.id, w.external_id, w.title, w.status, w.priority, w.owner,
              w.progress, w.description, w.due_at, w.classification, w.source_refs,
              w.trace_id, w.created_at, w.updated_at, w.version::text AS version,
              to_char(w.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS page_updated
         FROM wcp_work_items w
        WHERE w.tenant_id = $1 AND w.workspace_id = $2 AND w.project_id = $3
          AND w.deleted_at IS NULL ${filters.map((filter) => 'AND ' + filter).join(' ')}
        ORDER BY w.updated_at DESC, w.id
        LIMIT $${params.push(limit + 1)}`,
      params,
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const next_cursor =
      rows.length > limit && last
        ? encodeWorkItemCursor({ updated: last.page_updated, id: last.id }, queryKey)
        : undefined;
    return {
      schema_version: 1,
      data: page.map((row) => this.workItem(row, row.id, trace_id)),
      trace_id,
      source_refs: source('wcp_work_items'),
      ...(next_cursor === undefined ? {} : { next_cursor }),
    };
  }

  async getWorkItem(
    scope: WorkbenchScope,
    trace_id: string,
    itemId: string,
  ): Promise<WorkbenchEnvelope<WorkItemProjection>> {
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `SELECT w.id, w.external_id, w.title, w.status, w.priority, w.owner,
              w.progress, w.description, w.due_at, w.classification, w.source_refs,
              w.version::text AS version, w.trace_id, w.created_at, w.updated_at
         FROM wcp_work_items w
        WHERE w.tenant_id = $1 AND w.workspace_id = $2 AND w.project_id = $3
          AND w.id = $4 AND w.deleted_at IS NULL
          AND ${readableProject(scope, 'w')}
          ${scope.read_restricted ? '' : "AND w.classification <> 'restricted'"}`,
      [scope.tenant_id, scope.workspace_id, scope.project_id, itemId],
    );
    const row = rows[0];
    if (!row)
      throw new ContractError(
        'WORK_ITEM_NOT_FOUND',
        'Work item not found in the readable project scope',
        { trace_id },
      );
    const data = this.workItem(row, itemId, trace_id);
    return { schema_version: 1, data, trace_id, source_refs: source('wcp_work_items') };
  }

  private workItem(
    row: Record<string, unknown>,
    itemId: string,
    trace_id: string,
  ): WorkItemProjection {
    try {
      const timestamp = (value: unknown) => (value instanceof Date ? value.toISOString() : value);
      return parseWorkItemProjection(
        {
          ...row,
          due_at: timestamp(row.due_at),
          created_at: timestamp(row.created_at),
          updated_at: timestamp(row.updated_at),
        },
        itemId,
      );
    } catch {
      throw new ContractError(
        'WORK_ITEM_PROJECTION_INVALID',
        'Stored work item projection is invalid',
        { trace_id },
      );
    }
  }

  async listContext(
    scope: WorkbenchScope,
    trace_id: string,
    filters: ContextFilters = {},
  ): Promise<WorkbenchEnvelope<Record<string, unknown>[]> & { next_cursor?: string }> {
    this.ensureDb(trace_id);
    const limit = filters.limit ?? 25;
    const queryKey = contextQueryKey(scope, filters);
    const after = decodeContextCursor(filters.cursor, queryKey, trace_id);
    const rank = "CASE c.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END";
    const params: unknown[] = [scope.tenant_id, scope.workspace_id, scope.project_id];
    const clauses: string[] = [];
    for (const field of ['layer', 'classification', 'status', 'item_type'] as const)
      if (filters[field]) clauses.push(`AND c.${field} = $${params.push(filters[field])}`);
    if (filters.query?.trim())
      clauses.push(
        `AND strpos(lower(concat_ws(' ', c.title, c.source_ref, c.content::text)), lower($${params.push(filters.query.trim())}::text)) > 0`,
      );
    if (after) {
      const r = params.push(after.rank);
      const time = params.push(after.updated);
      const id = params.push(after.id);
      clauses.push(`AND ((${rank}) > $${r} OR ((${rank}) = $${r} AND
        (c.updated_at < $${time}::timestamptz OR (c.updated_at = $${time}::timestamptz AND c.id > $${id}))))`);
    }
    const rows = await this.query<
      Record<string, unknown> & { id: string; page_rank: number; page_updated: string }
    >(
      `SELECT c.id, c.title, c.item_type, c.layer, c.classification, c.status,
              c.source_ref, c.expires_at, c.confidence, c.priority, c.content,
              c.source_refs, c.trace_id, c.updated_at, c.version, c.deleted_at AS archived_at,
              (${rank}) AS page_rank,
              to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS page_updated
         FROM wcp_context_items c
        WHERE c.tenant_id = $1 AND c.workspace_id = $2 AND c.project_id = $3
          AND ${readableProject(scope, 'c')}
          AND c.deleted_at IS ${filters.archived === true ? 'NOT NULL' : 'NULL'}
          ${scope.read_restricted ? '' : "AND c.classification <> 'restricted'"}
          ${clauses.join(' ')}
        ORDER BY (${rank}), c.updated_at DESC, c.id
        LIMIT $${params.push(limit + 1)}`,
      params,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      schema_version: 1,
      data: page.map(({ page_rank, page_updated, ...item }) => item),
      trace_id,
      source_refs: source('wcp_context_items'),
      ...(rows.length > limit && last
        ? {
            next_cursor: encodeContextCursor(
              { rank: last.page_rank, updated: last.page_updated, id: last.id },
              queryKey,
            ),
          }
        : {}),
    };
  }

  async getSessionState(
    scope: WorkbenchScope,
    trace_id: string,
    sessionId: string,
  ): Promise<WorkbenchEnvelope<SessionClosureState>> {
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `SELECT s.session_id, s.status, s.version, s.ended_at FROM wcp_sessions s
        WHERE s.tenant_id = $1 AND s.workspace_id = $2 AND s.project_id = $3 AND s.session_id = $4
          AND EXISTS (SELECT 1 FROM wcp_projects p WHERE p.tenant_id = s.tenant_id
            AND p.workspace_id = s.workspace_id AND p.id = s.project_id AND p.deleted_at IS NULL
            AND p.classification IN ('public', 'internal', 'confidential'${scope.read_restricted ? ", 'restricted'" : ''}))`,
      [scope.tenant_id, scope.workspace_id, scope.project_id, sessionId],
    );
    const row = rows[0];
    if (!row)
      throw new ContractError('SESSION_NOT_FOUND', 'Session is unavailable in this project', {
        trace_id,
      });
    try {
      const data = parseSessionClosureState(
        {
          session_id: row.session_id,
          status: row.status,
          version: Number(row.version),
          ended_at: row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at,
        },
        sessionId,
      );
      return {
        schema_version: 1,
        data,
        trace_id,
        source_refs: [{ type: 'session', id: sessionId }],
      };
    } catch {
      throw new ContractError('SESSION_ACTIVITY_INVALID', 'Stored session state is invalid', {
        trace_id,
      });
    }
  }

  async listSessions(scope: WorkbenchScope, trace_id: string, input: SessionRegistryQuery = {}) {
    this.ensureDb(trace_id);
    const query = parseSessionRegistryQuery(input);
    const limit = query.limit ?? 25;
    const key = sessionQueryKey(scope, query);
    const after = decodeSessionCursor(query.cursor, key, trace_id);
    const params: unknown[] = [scope.tenant_id, scope.workspace_id, scope.project_id];
    const filters = [readableProject(scope, 's')];
    if (query.status) filters.push(`s.status = $${params.push(query.status)}`);
    if (query.client_id) filters.push(`s.client_id = $${params.push(query.client_id)}`);
    if (query.query) {
      const parameter = params.push(query.query);
      filters.push(
        `strpos(lower(concat_ws(' ', s.session_id, s.client_id, s.actor_id, s.trace_id)), lower($${parameter}::text)) > 0`,
      );
    }
    if (after) {
      const time = params.push(after.started_at);
      const id = params.push(after.session_id);
      filters.push(
        `(s.started_at < $${time}::timestamptz OR (s.started_at = $${time}::timestamptz AND s.session_id COLLATE "C" > $${id}::text COLLATE "C"))`,
      );
    }
    const bound = params.push(limit + 1);
    const rows = await this.query<Record<string, unknown>>(
      `WITH page AS MATERIALIZED (
         SELECT s.session_id, s.client_id, s.actor_id, s.parent_session_id, s.resume_origin,
                s.status, s.started_at, s.ended_at, s.trace_id, s.version FROM wcp_sessions s
         WHERE s.tenant_id = $1 AND s.workspace_id = $2 AND s.project_id = $3
           ${filters.map((filter) => 'AND ' + filter).join(' ')}
         ORDER BY s.started_at DESC, s.session_id COLLATE "C" LIMIT $${bound}
       )
       SELECT s.session_id, s.client_id, s.actor_id, s.parent_session_id, s.resume_origin, s.status,
              to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
              to_char(s.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ended_at,
              s.trace_id, s.version::text AS version,
              (SELECT count(*)::text FROM wcp_agent_runs r WHERE r.session_id = s.session_id) AS run_count,
              (SELECT count(*)::text FROM wcp_tool_calls t WHERE t.session_id = s.session_id) AS tool_call_count,
              latest.checkpoint_id, latest.revision AS checkpoint_revision
         FROM page s
         LEFT JOIN LATERAL (
           SELECT c.checkpoint_id, c.revision::text AS revision FROM wcp_session_checkpoints c WHERE c.session_id = s.session_id
             AND c.tenant_id = s.tenant_id AND c.workspace_id = s.workspace_id AND c.project_id = s.project_id
           ORDER BY c.revision DESC LIMIT 1
         ) latest ON true
        ORDER BY s.started_at DESC, s.session_id COLLATE "C"`,
      params,
    );
    try {
      const number = (value: unknown) => {
        if (
          typeof value !== 'string' ||
          !/^(0|[1-9][0-9]*)$/.test(value) ||
          !Number.isSafeInteger(Number(value))
        )
          throw new TypeError();
        return Number(value);
      };
      const data = rows.slice(0, limit).map((row) => ({
        ...row,
        version: number(row.version),
        run_count: number(row.run_count),
        tool_call_count: number(row.tool_call_count),
        checkpoint_revision:
          row.checkpoint_revision === null ? null : number(row.checkpoint_revision),
      }));
      const last = data[data.length - 1];
      const has_more = rows.length > limit;
      const page = parseSessionRegistryPage(
        {
          data,
          has_more,
          ...(has_more && last
            ? {
                next_cursor: encodeSessionRegistryCursor(key, parseSessionRegistryPosition(last)),
              }
            : {}),
        },
        query,
      );
      return {
        schema_version: 1 as const,
        trace_id,
        scope: {
          tenant_id: scope.tenant_id,
          workspace_id: scope.workspace_id,
          project_id: scope.project_id,
        },
        source_refs: SESSION_REGISTRY_SOURCES.map((id) => ({ type: 'postgres', id })),
        ...page,
      };
    } catch {
      throw new ContractError(
        'SESSION_REGISTRY_INVALID',
        'Stored session registry page is invalid',
        { trace_id },
      );
    }
  }

  async listHandoffs(scope: WorkbenchScope, trace_id: string, input: HandoffRegistryQuery = {}) {
    this.ensureDb(trace_id);
    const query = parseHandoffRegistryQuery(input);
    const limit = query.limit ?? 25;
    const key = handoffQueryKey(scope, query);
    const after = decodeHandoffCursor(query.cursor, key, trace_id);
    const params: unknown[] = [scope.tenant_id, scope.workspace_id, scope.project_id];
    const filters: string[] = [];
    if (query.status)
      filters.push(
        query.status === 'open'
          ? "d.status IN ('open', 'offered')"
          : "d.status NOT IN ('open', 'offered')",
      );
    if (query.origin) filters.push(`d.origin = $${params.push(query.origin)}`);
    if (query.session_id) filters.push(`d.session_id = $${params.push(query.session_id)}`);
    if (query.query)
      filters.push(
        `strpos(lower(concat_ws(' ', d.handoff_id, d.session_id, d.checkpoint_id, d.offered_to, d.claimed_by, d.claimed_by_actor, d.summary)), lower($${params.push(query.query)}::text)) > 0`,
      );
    if (after) {
      const time = params.push(after.updated_at);
      const id = params.push(after.handoff_id);
      filters.push(
        `(d.updated_at < $${time}::timestamptz OR (d.updated_at = $${time}::timestamptz AND d.handoff_id COLLATE "C" > $${id}::text COLLATE "C"))`,
      );
    }
    const bound = params.push(limit + 1);
    const rows = await this.query<Record<string, unknown>>(
      `WITH candidates AS (
         SELECT h.handoff_id, c.session_id, h.checkpoint_id, h.status,
                h.from_client, h.target_client AS offered_to,
                COALESCE(c.next_actions->>0, c.in_progress->>0, c.completed->>0) AS summary,
                h.created_at, h.updated_at, h.version, h.claimed_by, h.claimed_by_actor, 'session'::text AS origin
           FROM wcp_session_handoffs h
           JOIN wcp_session_checkpoints c ON c.checkpoint_id = h.checkpoint_id
            AND c.tenant_id = h.tenant_id AND c.workspace_id = h.workspace_id AND c.project_id = h.project_id
           JOIN wcp_sessions s ON s.session_id = c.session_id
            AND s.tenant_id = h.tenant_id AND s.workspace_id = h.workspace_id AND s.project_id = h.project_id
          WHERE h.tenant_id = $1 AND h.workspace_id = $2 AND h.project_id = $3
            AND ${readableProject(scope, 'h')}
       UNION ALL
       SELECT h.handoff_id, h.session_id, h.checkpoint_id, h.status, NULL::text AS from_client, h.offered_to,
              h.summary, h.created_at, h.updated_at, NULL::bigint AS version,
              NULL::text AS claimed_by, NULL::text AS claimed_by_actor, 'projection'::text AS origin
         FROM wcp_handoffs h
        WHERE h.tenant_id = $1 AND h.workspace_id = $2 AND h.project_id = $3
          AND ${readableProject(scope, 'h')}
          AND NOT EXISTS (SELECT 1 FROM wcp_session_handoffs c WHERE c.handoff_id = h.handoff_id
            AND c.tenant_id = h.tenant_id AND c.workspace_id = h.workspace_id AND c.project_id = h.project_id)
       ), page AS MATERIALIZED (
         SELECT d.* FROM candidates d WHERE true ${filters.map((filter) => 'AND ' + filter).join(' ')}
         ORDER BY d.updated_at DESC, d.handoff_id COLLATE "C" LIMIT $${bound}
       )
       SELECT d.handoff_id, d.session_id, d.checkpoint_id, d.status, d.from_client, d.offered_to,
              d.claimed_by, d.claimed_by_actor, d.version::text AS version, d.origin,
              to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
              CASE WHEN octet_length(d.summary) <= ${HANDOFF_REGISTRY_SUMMARY_BYTES} THEN d.summary ELSE NULL END AS summary,
              CASE WHEN d.summary IS NULL THEN 'missing' WHEN octet_length(d.summary) <= ${HANDOFF_REGISTRY_SUMMARY_BYTES} THEN 'available' ELSE 'too-large' END AS summary_state
         FROM page d ORDER BY d.updated_at DESC, d.handoff_id COLLATE "C"`,
      params,
    );
    try {
      const data = rows.slice(0, limit).map((row) => {
        if (
          row.version !== null &&
          (typeof row.version !== 'string' ||
            !/^[1-9][0-9]*$/.test(row.version) ||
            !Number.isSafeInteger(Number(row.version)))
        )
          throw new TypeError();
        return { ...row, version: row.version === null ? null : Number(row.version) };
      });
      const last = data[data.length - 1];
      const has_more = rows.length > limit;
      const page = parseHandoffRegistryPage(
        {
          data,
          has_more,
          ...(has_more && last
            ? { next_cursor: encodeHandoffRegistryCursor(key, parseHandoffRegistryPosition(last)) }
            : {}),
        },
        query,
      );
      return {
        schema_version: 1 as const,
        trace_id,
        scope: {
          tenant_id: scope.tenant_id,
          workspace_id: scope.workspace_id,
          project_id: scope.project_id,
        },
        source_refs: HANDOFF_REGISTRY_SOURCES.map((id) => ({ type: 'postgres', id })),
        ...page,
      };
    } catch {
      throw new ContractError(
        'HANDOFF_REGISTRY_INVALID',
        'Stored handoff registry page is invalid',
        { trace_id },
      );
    }
  }

  async listCheckpoints(
    scope: WorkbenchScope,
    trace_id: string,
    input: CheckpointRegistryQuery = {},
  ) {
    this.ensureDb(trace_id);
    const query = parseCheckpointRegistryQuery(input);
    const limit = query.limit ?? 25;
    const key = checkpointQueryKey(scope, query);
    const after = decodeCheckpointCursor(query.cursor, key, trace_id);
    const params: unknown[] = [scope.tenant_id, scope.workspace_id, scope.project_id];
    const filters: string[] = [];
    if (query.checkpoint_id) filters.push(`c.checkpoint_id = $${params.push(query.checkpoint_id)}`);
    if (query.query)
      filters.push(`strpos(lower(concat_ws(' ', c.checkpoint_id, c.session_id, c.revision::text,
        COALESCE(c.next_actions->>0, c.in_progress->>0, c.completed->>0))), lower($${params.push(query.query)}::text)) > 0`);
    if (after) {
      const time = params.push(after.created_at);
      const id = params.push(after.checkpoint_id);
      filters.push(`(c.created_at < $${time}::timestamptz OR (c.created_at = $${time}::timestamptz
        AND c.checkpoint_id COLLATE "C" > $${id}::text COLLATE "C"))`);
    }
    const bound = params.push(limit + 1);
    const rows = await this.query<Record<string, unknown>>(
      `WITH page AS MATERIALIZED (
         SELECT c.checkpoint_id, c.session_id, c.revision, c.created_at,
                COALESCE(c.next_actions->>0, c.in_progress->>0, c.completed->>0) AS summary
         FROM wcp_session_checkpoints c
         JOIN wcp_sessions s ON s.session_id = c.session_id AND s.tenant_id = c.tenant_id
          AND s.workspace_id = c.workspace_id AND s.project_id = c.project_id
        WHERE c.tenant_id = $1 AND c.workspace_id = $2 AND c.project_id = $3
          AND ${readableProject(scope, 'c')}
          ${filters.map((filter) => 'AND ' + filter).join(' ')}
        ORDER BY c.created_at DESC, c.checkpoint_id COLLATE "C" LIMIT $${bound}
       ) SELECT c.checkpoint_id, c.session_id, c.revision::text AS revision,
         to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
         CASE WHEN octet_length(c.summary) <= ${CHECKPOINT_REGISTRY_SUMMARY_BYTES} THEN c.summary ELSE NULL END AS summary,
         CASE WHEN c.summary IS NULL THEN 'missing' WHEN octet_length(c.summary) <= ${CHECKPOINT_REGISTRY_SUMMARY_BYTES}
           THEN 'available' ELSE 'too-large' END AS summary_state
       FROM page c ORDER BY c.created_at DESC, c.checkpoint_id COLLATE "C"`,
      params,
    );
    try {
      if (rows.length > limit + 1) throw new TypeError();
      const data = rows.slice(0, limit).map((row) => {
        if (
          typeof row.revision !== 'string' ||
          !/^[1-9][0-9]*$/.test(row.revision) ||
          !Number.isSafeInteger(Number(row.revision))
        )
          throw new TypeError();
        return { ...row, revision: Number(row.revision) };
      });
      const last = data.at(-1);
      const has_more = rows.length > limit;
      const page = parseCheckpointRegistryPage(
        {
          data,
          has_more,
          ...(has_more && last
            ? {
                next_cursor: encodeCheckpointRegistryCursor(
                  key,
                  parseCheckpointRegistryPosition(last),
                ),
              }
            : {}),
        },
        query,
      );
      return {
        schema_version: 1 as const,
        trace_id,
        scope: {
          tenant_id: scope.tenant_id,
          workspace_id: scope.workspace_id,
          project_id: scope.project_id,
        },
        source_refs: [{ type: 'postgres', id: CHECKPOINT_REGISTRY_SOURCE }],
        ...page,
      };
    } catch {
      throw new ContractError(
        'CHECKPOINT_REGISTRY_INVALID',
        'Stored checkpoint registry page is invalid',
        { trace_id },
      );
    }
  }

  async sessionCheckpoints(
    scope: WorkbenchScope,
    trace_id: string,
    sessionId: string,
    before?: number,
  ) {
    const query = parseCheckpointHistoryQuery({ session_id: sessionId, before_revision: before });
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `WITH visible AS MATERIALIZED (
        SELECT s.session_id, s.tenant_id, s.workspace_id, s.project_id FROM wcp_sessions s
        WHERE s.tenant_id = $1 AND s.workspace_id = $2 AND s.project_id = $3 AND s.session_id = $4
          AND EXISTS (SELECT 1 FROM wcp_projects p WHERE p.tenant_id = s.tenant_id
            AND p.workspace_id = s.workspace_id AND p.id = s.project_id AND p.deleted_at IS NULL
            AND p.classification IN ('public', 'internal', 'confidential'${scope.read_restricted ? ", 'restricted'" : ''}))
       ), positions AS MATERIALIZED (
        SELECT c.checkpoint_id, c.session_id, c.revision, c.created_at,
          row_number() OVER (ORDER BY c.revision DESC) AS position
        FROM visible s JOIN wcp_session_checkpoints c ON c.session_id = s.session_id
          AND c.tenant_id = s.tenant_id AND c.workspace_id = s.workspace_id AND c.project_id = s.project_id
        WHERE ($5::bigint IS NULL OR c.revision < $5)
        ORDER BY c.revision DESC LIMIT ${CHECKPOINT_HISTORY_PAGE_SIZE + 1}
       ), payloads AS MATERIALIZED (
        SELECT p.*, CASE WHEN p.position <= ${CHECKPOINT_HISTORY_PAGE_SIZE} THEN jsonb_build_object(
          'completed', c.completed, 'in_progress', c.in_progress, 'next_actions', c.next_actions,
          'decisions', c.decisions, 'risks', c.risks, 'open_questions', c.open_questions,
          'trace_id', c.trace_id, 'context_pack_id', c.context_pack_id, 'context_pack_hash', c.context_pack_hash)
          ELSE NULL END AS payload
        FROM positions p JOIN wcp_session_checkpoints c ON c.checkpoint_id = p.checkpoint_id
          AND c.session_id = p.session_id AND c.tenant_id = $1 AND c.workspace_id = $2 AND c.project_id = $3
       ), budget AS (
        SELECT COALESCE(sum(octet_length(payload::text)), 0) > ${CHECKPOINT_HISTORY_RESPONSE_BYTES - CHECKPOINT_READ_METADATA_BYTES} AS oversized
        FROM payloads
       ) SELECT s.session_id AS parent_session_id, p.checkpoint_id, p.session_id,
          p.revision::text AS revision, p.created_at, budget.oversized,
          CASE WHEN NOT budget.oversized THEN p.payload ELSE NULL END AS payload
        FROM visible s LEFT JOIN payloads p ON true CROSS JOIN budget
        ORDER BY p.revision DESC`,
      [scope.tenant_id, scope.workspace_id, scope.project_id, sessionId, before ?? null],
    );
    if (!rows.length)
      throw new ContractError('SESSION_NOT_FOUND', 'Session is unavailable in this project', {
        trace_id,
      });
    try {
      if (
        rows.length > CHECKPOINT_HISTORY_PAGE_SIZE + 1 ||
        rows.some(
          (row) => row.parent_session_id !== sessionId || typeof row.oversized !== 'boolean',
        )
      )
        throw new TypeError();
      if (rows.some((row) => row.oversized === true)) throw new CheckpointReadLimitError();
      const empty =
        rows.length === 1 && rows[0]!.checkpoint_id === null && rows[0]!.session_id === null;
      if (
        empty &&
        (rows[0]!.revision !== null || rows[0]!.created_at !== null || rows[0]!.payload !== null)
      )
        throw new TypeError();
      const positions = empty
        ? []
        : rows.map((row) => {
            if (
              row.session_id !== sessionId ||
              !isUlid(row.checkpoint_id) ||
              typeof row.revision !== 'string' ||
              !/^[1-9][0-9]*$/.test(row.revision) ||
              !Number.isSafeInteger(Number(row.revision))
            )
              throw new TypeError();
            return {
              checkpoint_id: row.checkpoint_id,
              revision: Number(row.revision),
              payload: row.payload,
              created_at: row.created_at,
            };
          });
      const seen = new Set<string>();
      if (
        positions.length > CHECKPOINT_HISTORY_PAGE_SIZE &&
        positions[CHECKPOINT_HISTORY_PAGE_SIZE]!.payload !== null
      )
        throw new TypeError();
      let upper = before;
      for (const record of positions) {
        if (seen.has(record.checkpoint_id) || (upper !== undefined && record.revision >= upper))
          throw new TypeError();
        seen.add(record.checkpoint_id);
        upper = record.revision;
      }
      const page = positions.slice(0, CHECKPOINT_HISTORY_PAGE_SIZE).map((position) => {
        if (
          typeof position.payload === 'string' &&
          new TextEncoder().encode(position.payload).byteLength > CHECKPOINT_HISTORY_RESPONSE_BYTES
        )
          throw new CheckpointReadLimitError();
        const payload: unknown =
          typeof position.payload === 'string' ? JSON.parse(position.payload) : position.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
          throw new TypeError();
        assertCheckpointReadBytes(
          payload,
          CHECKPOINT_HISTORY_RESPONSE_BYTES - CHECKPOINT_READ_METADATA_BYTES,
        );
        const fields = payload as Record<string, unknown>;
        return parseCheckpointHistoryEntry(
          {
            ...fields,
            checkpoint_id: position.checkpoint_id,
            session_id: sessionId,
            revision: position.revision,
            created_at:
              position.created_at instanceof Date
                ? position.created_at.toISOString()
                : position.created_at,
            context_pack_id: fields.context_pack_id ?? undefined,
            context_pack_hash: fields.context_pack_hash ?? undefined,
          },
          sessionId,
        );
      });
      return parseCheckpointHistoryPage(
        {
          schema_version: 1,
          session_id: sessionId,
          data: page,
          trace_id,
          source_refs: source('wcp_session_checkpoints'),
          ...(positions.length > page.length
            ? { next_before_revision: page[page.length - 1]!.revision }
            : {}),
        },
        query,
        trace_id,
      );
    } catch (error) {
      if (error instanceof CheckpointReadLimitError)
        throw new ContractError(
          'CHECKPOINT_READ_TOO_LARGE',
          'Checkpoint history exceeds the complete read limit; no partial page was returned',
          { trace_id },
        );
      throw new ContractError('SESSION_ACTIVITY_INVALID', 'Stored checkpoint history is invalid', {
        trace_id,
      });
    }
  }

  async listConflicts(scope: WorkbenchScope, trace_id: string, input: ConflictRegistryQuery = {}) {
    this.ensureDb(trace_id);
    const query = parseConflictRegistryQuery(input);
    const limit = query.limit ?? 25;
    const key = conflictQueryKey(scope, query);
    const before = decodeConflictCursor(query.cursor, key, trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `WITH visible AS MATERIALIZED (
        SELECT p.id FROM wcp_projects p WHERE p.tenant_id = $1 AND p.workspace_id = $2 AND p.id = $3 AND p.deleted_at IS NULL
          AND p.classification IN ('public', 'internal', 'confidential'${scope.read_restricted ? ", 'restricted'" : ''})
       ), positions AS MATERIALIZED (
        SELECT c.conflict_id, row_number() OVER (ORDER BY c.conflict_id COLLATE "C") AS position
        FROM visible p JOIN wcp_conflicts c ON c.project_id = p.id AND c.tenant_id = $1 AND c.workspace_id = $2
        WHERE ($4::text IS NULL OR strpos(translate(concat_ws(E'\\n', c.conflict_id, c.entity_type, c.entity_id, c.field, c.actor_id, c.trace_id),
          'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), $4) > 0)
          AND ($5::text IS NULL OR c.status = $5) AND ($6::text IS NULL OR c.entity_type = $6)
          AND ($7::text IS NULL OR c.conflict_id = $7)
          AND ($8::text IS NULL OR c.conflict_id COLLATE "C" > $8::text COLLATE "C")
          ${visibleConflicts(scope)}
        ORDER BY c.conflict_id COLLATE "C" LIMIT $9
       ), metadata AS MATERIALIZED (
        SELECT p.conflict_id, CASE WHEN p.position <= ${limit} THEN jsonb_build_object(
          'conflict_id', c.conflict_id, 'entity_type', c.entity_type, 'entity_id', c.entity_id, 'field', c.field,
          'base_version', c.base_version::text, 'local_version', c.local_version::text, 'server_version', c.server_version::text,
          'version', c.version::text, 'status', c.status, 'resolution', c.resolution, 'actor_id', c.actor_id, 'trace_id', c.trace_id)
          ELSE NULL END AS payload
        FROM positions p JOIN wcp_conflicts c ON c.conflict_id = p.conflict_id AND c.tenant_id = $1 AND c.workspace_id = $2 AND c.project_id = $3
       ) SELECT v.id AS parent_project_id, m.conflict_id IS NOT NULL AS has_conflict,
         CASE WHEN octet_length(m.conflict_id) <= 1024 THEN m.conflict_id ELSE NULL END AS conflict_id,
         CASE WHEN octet_length(m.payload::text) <= ${CONFLICT_REGISTRY_RECORD_BYTES} THEN m.payload ELSE NULL END AS payload
       FROM visible v LEFT JOIN metadata m ON true ORDER BY m.conflict_id COLLATE "C"`,
      [
        scope.tenant_id,
        scope.workspace_id,
        scope.project_id,
        query.query === undefined ? null : foldConflictQuery(query.query),
        query.status ?? null,
        query.entity_type ?? null,
        query.conflict_id ?? null,
        before?.conflict_id ?? null,
        limit + 1,
      ],
    );
    if (!rows.length)
      throw new ContractError('NOT_FOUND', 'Project is unavailable in the readable scope', {
        trace_id,
      });
    try {
      if (
        rows.length > limit + 1 ||
        rows.some(
          (row) =>
            row.parent_project_id !== scope.project_id || typeof row.has_conflict !== 'boolean',
        )
      )
        throw new TypeError();
      const empty =
        rows.length === 1 &&
        rows[0]!.has_conflict === false &&
        rows[0]!.conflict_id === null &&
        rows[0]!.payload === null;
      if (!empty && rows.some((row) => row.has_conflict !== true)) throw new TypeError();
      const positions = empty
        ? []
        : rows.map((row) => ({
            conflict_id: parseConflictReadQuery({ conflict_id: row.conflict_id }).conflict_id,
            payload: row.payload,
          }));
      let previous = before?.conflict_id;
      for (const row of positions) {
        if (previous !== undefined && compareConflictIds(previous, row.conflict_id) >= 0)
          throw new TypeError();
        previous = row.conflict_id;
      }
      const data = positions.slice(0, limit).map((row) => {
        if (
          typeof row.payload === 'string' &&
          new TextEncoder().encode(row.payload).byteLength > CONFLICT_REGISTRY_RECORD_BYTES
        )
          throw new TypeError();
        const item = parseConflictRegistryRecord(
          typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        );
        if (item.conflict_id !== row.conflict_id) throw new TypeError();
        return item;
      });
      const has_more = positions.length > limit;
      if (has_more && positions[limit]!.payload !== null) throw new TypeError();
      return {
        schema_version: 1 as const,
        trace_id,
        scope: {
          tenant_id: scope.tenant_id,
          workspace_id: scope.workspace_id,
          project_id: scope.project_id,
        },
        source_refs: source('wcp_conflicts'),
        ...parseConflictRegistryPage(
          {
            data,
            has_more,
            ...(has_more
              ? { next_cursor: encodeConflictRegistryCursor(key, data.at(-1)!.conflict_id) }
              : {}),
          },
          query,
        ),
      };
    } catch {
      throw new ContractError(
        'CONFLICT_REGISTRY_INVALID',
        'Stored conflict metadata page is invalid or exceeds its limit',
        { trace_id },
      );
    }
  }

  async listAudit(
    scope: WorkbenchScope,
    trace_id: string,
    filters: WorkbenchAuditQuery | string = {},
  ): Promise<WorkbenchAuditEnvelope> {
    this.ensureDb(trace_id);
    const query = parseWorkbenchAuditQuery(
      typeof filters === 'string' ? { resource: filters } : filters,
    );
    const queryKey = auditQueryKey(scope, query);
    const before = decodeAuditCursor(query.cursor, queryKey, trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `WITH audit_page AS MATERIALIZED (
       SELECT audit_id, actor_id, client_id, session_id, action, resource, result,
              classification, details, trace_id, source_refs, occurred_at
         FROM wcp_audit_records
        WHERE tenant_id = $1 AND workspace_id = $2 AND project_id = $3
          ${scope.read_restricted ? '' : "AND classification <> 'restricted'"}
          AND ($4::text IS NULL OR resource = $4)
          AND ($5::text IS NULL OR trace_id = $5)
          AND ($6::text IS NULL OR action = $6)
          AND ($7::text IS NULL OR audit_id = $7)
          AND ($10::text IS NULL OR session_id = $10)
          AND ($8::timestamptz IS NULL OR
               (occurred_at, audit_id COLLATE "C") < ($8::timestamptz, $9::text COLLATE "C"))
        ORDER BY wcp_audit_records.occurred_at DESC, audit_id COLLATE "C" DESC
        LIMIT ${WORKBENCH_AUDIT_LIMIT + 1}
       ), audit_projection AS MATERIALIZED (
         SELECT audit_id, occurred_at, details, source_refs,
           octet_length(details::text) AS details_bytes,
           octet_length(source_refs::text) AS source_refs_bytes,
           jsonb_build_object(
             'audit_id', audit_id, 'actor_id', actor_id, 'client_id', client_id,
             'session_id', session_id, 'action', action, 'resource', resource,
             'result', result, 'classification', classification, 'trace_id', trace_id,
             'occurred_at', to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           ) AS metadata
         FROM audit_page
       )
       SELECT
         CASE WHEN octet_length(metadata::text) <= ${WORKBENCH_AUDIT_METADATA_BYTES}
           THEN metadata ELSE NULL END AS metadata,
         CASE WHEN details_bytes <= ${WORKBENCH_AUDIT_DETAILS_BYTES}
           THEN details ELSE NULL END AS details,
         CASE WHEN details_bytes <= ${WORKBENCH_AUDIT_DETAILS_BYTES}
           THEN 'available' ELSE 'too-large' END AS details_state,
         details_bytes,
         CASE WHEN source_refs_bytes <= ${WORKBENCH_AUDIT_SOURCES_BYTES}
           THEN source_refs ELSE '[]'::jsonb END AS source_refs,
         CASE WHEN jsonb_typeof(source_refs) <> 'array' THEN 'invalid'
           WHEN source_refs_bytes <= ${WORKBENCH_AUDIT_SOURCES_BYTES}
           THEN 'available' ELSE 'too-large' END AS source_refs_state,
         source_refs_bytes
       FROM audit_projection
       ORDER BY occurred_at DESC, audit_id COLLATE "C" DESC`,
      [
        scope.tenant_id,
        scope.workspace_id,
        scope.project_id,
        query.resource ?? null,
        query.trace_id ?? null,
        query.action ?? null,
        query.audit_id ?? null,
        before?.occurred_at ?? null,
        before?.audit_id ?? null,
        query.session_id ?? null,
      ],
    );
    try {
      if (rows.length > WORKBENCH_AUDIT_LIMIT + 1) throw new TypeError();
      const records = rows.map((row) => {
        if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata))
          throw new TypeError();
        return parseWorkbenchAuditRecord({
          ...row.metadata,
          details: row.details,
          details_state: row.details_state,
          details_bytes: row.details_bytes,
          source_refs: row.source_refs,
          source_refs_state: row.source_refs_state,
          source_refs_bytes: row.source_refs_bytes,
        });
      });
      if (!scope.read_restricted && records.some((row) => row.classification === 'restricted'))
        throw new TypeError();
      const page = records.slice(0, WORKBENCH_AUDIT_LIMIT);
      const last = page[page.length - 1];
      const next_cursor =
        rows.length > WORKBENCH_AUDIT_LIMIT && last
          ? encodeWorkbenchAuditCursor(queryKey, parseWorkbenchAuditPosition(last))
          : undefined;
      const result = parseWorkbenchAuditEnvelope(
        {
          schema_version: 1,
          data: page,
          scope: {
            tenant_id: scope.tenant_id,
            workspace_id: scope.workspace_id,
            project_id: scope.project_id,
          },
          has_more: rows.length > WORKBENCH_AUDIT_LIMIT,
          ...(next_cursor === undefined ? {} : { next_cursor }),
          trace_id,
          source_refs: source('wcp_audit_records'),
        },
        query,
        scope,
        trace_id,
      );
      return result;
    } catch {
      throw new ContractError('WORKBENCH_AUDIT_INVALID', 'Stored audit records could not be read', {
        trace_id,
      });
    }
  }

  async adminHealth(
    scope: WorkbenchScope,
    trace_id: string,
    gatewayVersion: string,
    access: { audit: boolean; context: boolean } = { audit: false, context: false },
  ): Promise<WorkbenchAdminEnvelope> {
    this.ensureDb(trace_id);
    const authorized = { audit: access.audit === true, context: access.context === true };
    const rows = await this.query<Record<string, unknown>>(
      `SELECT current_setting('server_version') AS database_version,
         to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS read_at,
         CASE WHEN $4::boolean THEN (SELECT COUNT(*)::text FROM wcp_audit_records a
           WHERE a.tenant_id = $1 AND a.workspace_id = $2 AND a.project_id = $3
             ${scope.read_restricted ? '' : "AND a.classification <> 'restricted'"}) ELSE NULL END AS audit_count,
         CASE WHEN $5::boolean THEN (SELECT COUNT(*)::text FROM wcp_sessions s
           WHERE s.tenant_id = $1 AND s.workspace_id = $2 AND s.project_id = $3
             AND ${readableProject(scope, 's')}
             AND s.status = 'running') ELSE NULL END AS active_sessions,
         CASE WHEN $5::boolean THEN (SELECT COUNT(*)::text FROM wcp_conflicts c
           WHERE c.tenant_id = $1 AND c.workspace_id = $2 AND c.project_id = $3
             AND ${readableProject(scope, 'c')}
             AND c.status = 'open' ${visibleConflicts(scope)}) ELSE NULL END AS open_conflicts
        FROM wcp_projects p WHERE p.tenant_id = $1 AND p.workspace_id = $2 AND p.id = $3
          AND p.deleted_at IS NULL ${scope.read_restricted ? '' : "AND p.classification <> 'restricted'"}`,
      [scope.tenant_id, scope.workspace_id, scope.project_id, authorized.audit, authorized.context],
    );
    if (!rows.length)
      throw new ContractError('NOT_FOUND', 'Project is not available in the readable scope', {
        trace_id,
      });
    try {
      if (rows.length !== 1) throw new TypeError();
      const row = rows[0]!;
      const readCount = (value: unknown, allowed: boolean): WorkbenchAdminCount => {
        if (!allowed) {
          if (value !== null) throw new TypeError();
          return { state: 'not-authorized', value: null };
        }
        // COUNT is returned as decimal text, avoiding PostgreSQL int overflow or silent rounding.
        if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(value))
          throw new TypeError();
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) throw new TypeError();
        return { state: 'available', value: parsed };
      };
      const counts = {
        audit_records: readCount(row.audit_count, authorized.audit),
        running_sessions: readCount(row.active_sessions, authorized.context),
        open_conflicts: readCount(row.open_conflicts, authorized.context),
      };
      return parseWorkbenchAdminEnvelope(
        {
          schema_version: 1,
          trace_id,
          scope: {
            tenant_id: scope.tenant_id,
            workspace_id: scope.workspace_id,
            project_id: scope.project_id,
          },
          source_refs: workbenchAdminSources(counts),
          data: {
            read_at: row.read_at,
            gateway_version: gatewayVersion,
            database: { state: 'read-succeeded', version: row.database_version },
            counts,
            checks: Object.fromEntries(WORKBENCH_ADMIN_CHECKS.map((key) => [key, 'not-checked'])),
          },
        },
        scope,
        trace_id,
      );
    } catch {
      throw new ContractError('WORKBENCH_ADMIN_INVALID', 'Administration snapshot is invalid', {
        trace_id,
      });
    }
  }

  private async query<T>(text: string, scopeOrParams: WorkbenchScope | unknown[]): Promise<T[]> {
    if (!this.db) throw new Error('unreachable');
    const params = Array.isArray(scopeOrParams)
      ? scopeOrParams
      : [scopeOrParams.tenant_id, scopeOrParams.workspace_id, scopeOrParams.project_id];
    try {
      return await this.db.query<T>(text, params);
    } catch {
      throw new ContractError(
        'WORKBENCH_DATABASE_UNAVAILABLE',
        'Workbench projection could not be read',
        {
          retryable: true,
        },
      );
    }
  }

  private ensureDb(trace_id: string): void {
    if (this.db) return;
    const error = new ContractError(
      'WORKBENCH_DATABASE_UNAVAILABLE',
      'WORKBENCH_DATABASE_UNAVAILABLE',
      { trace_id, retryable: true },
    );
    Object.assign(error, { trace_id });
    throw error;
  }
}
