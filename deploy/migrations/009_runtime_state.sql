CREATE TABLE IF NOT EXISTS wcp_projection_states (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  authority TEXT NOT NULL,
  plane_version BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  source_event_id TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT,
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, project_id, entity_kind, external_id)
);

CREATE TABLE IF NOT EXISTS wcp_context_hits (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  revision BIGINT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  rank_source TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, project_id, id)
);

CREATE INDEX IF NOT EXISTS idx_wcp_projection_scope
  ON wcp_projection_states (tenant_id, workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_wcp_context_hits_scope
  ON wcp_context_hits (tenant_id, workspace_id, project_id);

INSERT INTO schema_migrations (version, checksum)
VALUES ('009_runtime_state', 'sha256:planemem-p8-009')
ON CONFLICT (version) DO NOTHING;
