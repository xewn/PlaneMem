import { ContractError } from '@planemem/contracts';

export interface WorkbenchScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
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

const source = (id: string): Array<{ type: string; id: string }> => [{ type: 'postgres', id }];

/**
 * Reads the scoped workbench projection from PostgreSQL and preserves the
 * trace/source envelope required by the public gateway contract.
 */
export class WorkbenchRepository {
  constructor(private readonly db: WorkbenchDatabase | undefined) {}

  async listOverview(
    scope: WorkbenchScope,
    trace_id: string,
  ): Promise<WorkbenchEnvelope<Record<string, unknown>>> {
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `SELECT
         p.id AS project_id,
         p.name AS project_name,
         p.external_id,
         COUNT(DISTINCT w.id) FILTER (WHERE w.status NOT IN ('done', 'cancelled'))::int AS active_work_items,
         COUNT(DISTINCT w.id) FILTER (WHERE w.status = 'blocked')::int AS blocked_work_items,
         COUNT(DISTINCT w.id) FILTER (WHERE w.status = 'done')::int AS completed_work_items,
         COUNT(DISTINCT s.session_id) FILTER (WHERE s.status = 'running')::int AS active_sessions,
         COUNT(DISTINCT c.conflict_id) FILTER (WHERE c.status = 'open')::int AS open_conflicts,
         COALESCE(MAX(w.updated_at), p.updated_at) AS last_activity_at
       FROM wcp_projects p
       LEFT JOIN wcp_work_items w
         ON w.tenant_id = p.tenant_id AND w.workspace_id = p.workspace_id AND w.project_id = p.id
        AND w.deleted_at IS NULL
       LEFT JOIN wcp_sessions s
         ON s.tenant_id = p.tenant_id AND s.workspace_id = p.workspace_id AND s.project_id = p.id
       LEFT JOIN wcp_conflicts c
         ON c.tenant_id = p.tenant_id AND c.workspace_id = p.workspace_id AND c.project_id = p.id
       WHERE p.tenant_id = $1 AND p.workspace_id = $2 AND p.id = $3 AND p.deleted_at IS NULL
       GROUP BY p.id, p.name, p.external_id, p.updated_at`,
      scope,
    );
    const row = rows[0] ?? {
      project_id: scope.project_id,
      project_name: null,
      active_work_items: 0,
      blocked_work_items: 0,
      completed_work_items: 0,
      active_sessions: 0,
      open_conflicts: 0,
      last_activity_at: null,
    };
    return { schema_version: 1, data: row, trace_id, source_refs: source('workbench_overview') };
  }

  async listWorkItems(
    scope: WorkbenchScope,
    trace_id: string,
    status?: string,
  ): Promise<WorkbenchEnvelope<Record<string, unknown>[]>> {
    this.ensureDb(trace_id);
    const params: unknown[] = [scope.tenant_id, scope.workspace_id, scope.project_id];
    const statusFilter = status ? ` AND w.status = $4` : '';
    if (status) params.push(status);
    const rows = await this.query<Record<string, unknown>>(
      `SELECT w.id, w.external_id, w.title, w.status, w.priority, w.owner,
              w.progress, w.description, w.due_at, w.classification, w.source_refs,
              w.trace_id, w.updated_at
         FROM wcp_work_items w
        WHERE w.tenant_id = $1 AND w.workspace_id = $2 AND w.project_id = $3
          AND w.deleted_at IS NULL${statusFilter}
        ORDER BY w.updated_at DESC, w.id`,
      params,
    );
    return { schema_version: 1, data: rows, trace_id, source_refs: source('wcp_work_items') };
  }

  async listContext(
    scope: WorkbenchScope,
    trace_id: string,
  ): Promise<WorkbenchEnvelope<Record<string, unknown>[]>> {
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `SELECT c.id, c.title, c.item_type, c.layer, c.classification, c.status,
              c.source_ref, c.expires_at, c.confidence, c.priority, c.content,
              c.source_refs, c.trace_id, c.updated_at
         FROM wcp_context_items c
        WHERE c.tenant_id = $1 AND c.workspace_id = $2 AND c.project_id = $3
          AND c.deleted_at IS NULL
        ORDER BY c.priority DESC, c.updated_at DESC, c.id`,
      scope,
    );
    return { schema_version: 1, data: rows, trace_id, source_refs: source('wcp_context_items') };
  }

  async listSessions(
    scope: WorkbenchScope,
    trace_id: string,
  ): Promise<WorkbenchEnvelope<Record<string, unknown>[]>> {
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `SELECT s.session_id, s.client_id, s.actor_id, s.parent_session_id, s.status,
              s.started_at, s.ended_at, s.trace_id,
              COUNT(DISTINCT r.run_id)::int AS run_count,
              COUNT(DISTINCT t.tool_call_id)::int AS tool_call_count
         FROM wcp_sessions s
         LEFT JOIN wcp_agent_runs r ON r.session_id = s.session_id
         LEFT JOIN wcp_tool_calls t ON t.session_id = s.session_id
        WHERE s.tenant_id = $1 AND s.workspace_id = $2 AND s.project_id = $3
        GROUP BY s.session_id
        ORDER BY s.started_at DESC`,
      scope,
    );
    return { schema_version: 1, data: rows, trace_id, source_refs: source('wcp_sessions') };
  }

  async listHandoffs(
    scope: WorkbenchScope,
    trace_id: string,
  ): Promise<WorkbenchEnvelope<Record<string, unknown>[]>> {
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `SELECT h.handoff_id, h.session_id, h.checkpoint_id, h.status, h.offered_to,
              h.summary, h.created_at, h.updated_at
         FROM wcp_handoffs h
        WHERE h.tenant_id = $1 AND h.workspace_id = $2 AND h.project_id = $3
        ORDER BY h.updated_at DESC, h.handoff_id`,
      scope,
    );
    return { schema_version: 1, data: rows, trace_id, source_refs: source('wcp_handoffs') };
  }

  async listConflicts(
    scope: WorkbenchScope,
    trace_id: string,
  ): Promise<WorkbenchEnvelope<Record<string, unknown>[]>> {
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `SELECT conflict_id, entity_type, entity_id, field, base_version,
              local_version, server_version, local_value, server_value, status,
              resolution, actor_id, version, trace_id, source_refs
         FROM wcp_conflicts
        WHERE tenant_id = $1 AND workspace_id = $2 AND project_id = $3
        ORDER BY status ASC, conflict_id`,
      scope,
    );
    return { schema_version: 1, data: rows, trace_id, source_refs: source('wcp_conflicts') };
  }

  async listAudit(
    scope: WorkbenchScope,
    trace_id: string,
  ): Promise<WorkbenchEnvelope<Record<string, unknown>[]>> {
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `SELECT audit_id, actor_id, client_id, session_id, action, resource, result,
              classification, details, trace_id, source_refs, occurred_at
         FROM wcp_audit_records
        WHERE tenant_id = $1 AND workspace_id = $2 AND project_id = $3
        ORDER BY occurred_at DESC, audit_id DESC
        LIMIT 200`,
      scope,
    );
    return { schema_version: 1, data: rows, trace_id, source_refs: source('wcp_audit_records') };
  }

  async adminHealth(
    scope: WorkbenchScope,
    trace_id: string,
    release: string,
  ): Promise<WorkbenchEnvelope<Record<string, unknown>>> {
    this.ensureDb(trace_id);
    const rows = await this.query<Record<string, unknown>>(
      `SELECT
         (SELECT COUNT(*)::int FROM wcp_audit_records a
           WHERE a.tenant_id = $1 AND a.workspace_id = $2 AND a.project_id = $3) AS audit_count,
         (SELECT COUNT(*)::int FROM wcp_sessions s
           WHERE s.tenant_id = $1 AND s.workspace_id = $2 AND s.project_id = $3
             AND s.status = 'running') AS active_sessions,
         (SELECT COUNT(*)::int FROM wcp_conflicts c
           WHERE c.tenant_id = $1 AND c.workspace_id = $2 AND c.project_id = $3
             AND c.status = 'open') AS open_conflicts`,
      scope,
    );
    return {
      schema_version: 1,
      data: {
        release,
        services: [{ name: 'postgres', status: 'ok', version: '16' }],
        ...(rows[0] ?? {}),
      },
      trace_id,
      source_refs: source('workbench_health'),
    };
  }

  private async query<T>(text: string, scopeOrParams: WorkbenchScope | unknown[]): Promise<T[]> {
    if (!this.db) throw new Error('unreachable');
    const params = Array.isArray(scopeOrParams)
      ? scopeOrParams
      : [scopeOrParams.tenant_id, scopeOrParams.workspace_id, scopeOrParams.project_id];
    return this.db.query<T>(text, params);
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
