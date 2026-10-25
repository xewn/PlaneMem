ALTER TABLE wcp_sessions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wcp_sessions_idempotency
  ON wcp_sessions (tenant_id, workspace_id, project_id, actor_id, client_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS wcp_session_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  session_id TEXT NOT NULL REFERENCES wcp_sessions(session_id),
  revision BIGINT NOT NULL CHECK (revision > 0),
  completed JSONB NOT NULL DEFAULT '[]'::jsonb,
  in_progress JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  state_hash TEXT NOT NULL,
  context_pack_hash TEXT,
  memory_ref JSONB,
  trace_id TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, revision)
);

CREATE TABLE IF NOT EXISTS wcp_session_handoffs (
  handoff_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  checkpoint_id TEXT NOT NULL REFERENCES wcp_session_checkpoints(checkpoint_id),
  from_client TEXT NOT NULL,
  target_client TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'expired')),
  claimed_by TEXT,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  trace_id TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wcp_session_handoffs_idempotency
  ON wcp_session_handoffs (tenant_id, workspace_id, project_id, from_client, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wcp_session_checkpoints_session
  ON wcp_session_checkpoints (tenant_id, workspace_id, project_id, session_id, revision);
CREATE INDEX IF NOT EXISTS idx_wcp_session_handoffs_scope
  ON wcp_session_handoffs (tenant_id, workspace_id, project_id, status);

INSERT INTO schema_migrations (version, checksum)
VALUES ('010_session_continuity_persistence', 'sha256:planemem-p9-010')
ON CONFLICT (version) DO NOTHING;
