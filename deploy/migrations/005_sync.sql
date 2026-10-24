CREATE TABLE IF NOT EXISTS wcp_sync_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  server_cursor BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id, project_id, server_cursor)
);

CREATE TABLE IF NOT EXISTS wcp_conflicts (
  conflict_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  base_version BIGINT NOT NULL,
  local_version BIGINT NOT NULL,
  server_version BIGINT NOT NULL,
  local_value JSONB,
  server_value JSONB,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  resolution TEXT,
  actor_id TEXT,
  version BIGINT NOT NULL DEFAULT 1,
  trace_id TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_wcp_sync_events_scope_cursor ON wcp_sync_events (tenant_id, workspace_id, project_id, server_cursor);
CREATE INDEX IF NOT EXISTS idx_wcp_conflicts_scope_status ON wcp_conflicts (tenant_id, workspace_id, project_id, status);

INSERT INTO schema_migrations (version, checksum)
VALUES ('005_sync', 'sha256:planemem-p3-005')
ON CONFLICT (version) DO NOTHING;
