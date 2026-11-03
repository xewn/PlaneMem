/** The conflict clause comes from visibleConflicts, never from request input. */
export function overviewQuery(readRestricted: boolean, conflictVisibility: string): string {
  return `WITH readable_project AS (
    SELECT p.id, p.tenant_id, p.workspace_id, p.name, p.external_id, p.updated_at
      FROM wcp_projects p
     WHERE p.tenant_id = $1 AND p.workspace_id = $2 AND p.id = $3 AND p.deleted_at IS NULL
       ${readRestricted ? '' : "AND p.classification <> 'restricted'"}
  ), visible_work AS (
    SELECT w.status, w.updated_at FROM wcp_work_items w JOIN readable_project p
      ON w.tenant_id = p.tenant_id AND w.workspace_id = p.workspace_id AND w.project_id = p.id
     WHERE w.deleted_at IS NULL ${readRestricted ? '' : "AND w.classification <> 'restricted'"}
  ), visible_context AS (
    SELECT c.id, c.title, c.item_type, c.layer, c.status, c.expires_at, c.confidence, c.priority, c.updated_at,
           (c.status = 'expired' OR COALESCE(c.expires_at <= statement_timestamp(), false)) AS has_expired
      FROM wcp_context_items c JOIN readable_project p
        ON c.tenant_id = p.tenant_id AND c.workspace_id = p.workspace_id AND c.project_id = p.id
     WHERE c.deleted_at IS NULL ${readRestricted ? '' : "AND c.classification <> 'restricted'"}
  ), running_sessions AS (
    SELECT s.session_id, s.client_id, s.status, s.started_at FROM wcp_sessions s JOIN readable_project p
      ON s.tenant_id = p.tenant_id AND s.workspace_id = p.workspace_id AND s.project_id = p.id
     WHERE s.status = 'running'
  ), open_visible_conflicts AS (
    SELECT c.conflict_id, c.entity_type, c.field, c.status FROM wcp_conflicts c JOIN readable_project p
      ON c.tenant_id = p.tenant_id AND c.workspace_id = p.workspace_id AND c.project_id = p.id
     WHERE c.status = 'open' ${conflictVisibility}
  ), work_counts AS (
    SELECT COUNT(*)::int AS total_work_items,
      COUNT(*) FILTER (WHERE status = 'todo')::int AS todo_work_items,
      COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_work_items,
      COUNT(*) FILTER (WHERE status = 'in_review')::int AS in_review_work_items,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_work_items,
      COUNT(*) FILTER (WHERE status NOT IN ('done', 'cancelled'))::int AS active_work_items,
      COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked_work_items,
      COUNT(*) FILTER (WHERE status = 'done')::int AS completed_work_items,
      MAX(updated_at) AS last_work_update
    FROM visible_work
  ), layer_counts AS (
    SELECT layers.layer, COUNT(c.id)::int AS count,
      COUNT(c.id) FILTER (WHERE c.status = 'proposed')::int AS proposed,
      COUNT(c.id) FILTER (WHERE c.has_expired)::int AS expired,
      AVG(c.confidence)::double precision AS average_confidence
    FROM (VALUES ('L0'), ('L1'), ('L2'), ('L3'), ('L4')) layers(layer)
    LEFT JOIN visible_context c ON c.layer = layers.layer GROUP BY layers.layer
  )
  SELECT p.id AS project_id, p.name AS project_name, p.external_id,
    w.total_work_items, w.todo_work_items, w.in_progress_work_items, w.in_review_work_items,
    w.cancelled_work_items, w.active_work_items, w.blocked_work_items, w.completed_work_items,
    (SELECT COUNT(*)::int FROM running_sessions) AS active_sessions,
    (SELECT COUNT(*)::int FROM open_visible_conflicts) AS open_conflicts,
    (SELECT COUNT(*)::int FROM visible_context) AS total_context_items,
    (SELECT COUNT(*)::int FROM visible_context WHERE status = 'proposed') AS proposed_context_items,
    (SELECT COUNT(*)::int FROM visible_context WHERE has_expired) AS expired_context_items,
    statement_timestamp() AS read_at,
    COALESCE(w.last_work_update, p.updated_at) AS last_activity_at,
    (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.layer) FROM layer_counts l) AS context_layers,
    (SELECT to_jsonb(brief) FROM (
      SELECT c.id, c.title, c.item_type, c.layer, c.status, c.expires_at, src.content
        FROM visible_context c JOIN wcp_context_items src ON src.id = c.id
         AND src.tenant_id = p.tenant_id AND src.workspace_id = p.workspace_id AND src.project_id = p.id
       WHERE c.layer = 'L0' AND c.status = 'confirmed' AND NOT c.has_expired
       ORDER BY CASE c.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, c.updated_at DESC, c.id
       LIMIT 1
    ) brief) AS project_brief,
    COALESCE((SELECT jsonb_agg(to_jsonb(preview) ORDER BY preview.updated_at DESC, preview.id) FROM (
      SELECT id, title, item_type, layer, status, expires_at, updated_at FROM visible_context
       WHERE status = 'proposed' ORDER BY updated_at DESC, id LIMIT 3
    ) preview), '[]'::jsonb) AS proposed_context_preview,
    COALESCE((SELECT jsonb_agg(to_jsonb(preview) ORDER BY preview.updated_at DESC, preview.id) FROM (
      SELECT id, title, item_type, layer, status, expires_at, updated_at FROM visible_context
       WHERE has_expired ORDER BY updated_at DESC, id LIMIT 2
    ) preview), '[]'::jsonb) AS expired_context_preview,
    COALESCE((SELECT jsonb_agg(to_jsonb(preview) ORDER BY preview.started_at DESC, preview.session_id) FROM (
      SELECT s.session_id, s.client_id, s.status, s.started_at,
        (SELECT COUNT(*)::int FROM wcp_agent_runs r WHERE r.session_id = s.session_id) AS run_count,
        (SELECT COUNT(*)::int FROM wcp_tool_calls t WHERE t.session_id = s.session_id) AS tool_call_count
      FROM (SELECT * FROM running_sessions ORDER BY started_at DESC, session_id LIMIT 4) s
    ) preview), '[]'::jsonb) AS active_session_preview,
    COALESCE((SELECT jsonb_agg(to_jsonb(preview) ORDER BY preview.conflict_id DESC) FROM (
      SELECT * FROM open_visible_conflicts ORDER BY conflict_id DESC LIMIT 3
    ) preview), '[]'::jsonb) AS open_conflict_preview
  FROM readable_project p CROSS JOIN work_counts w`;
}
