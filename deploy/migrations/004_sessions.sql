CREATE TABLE IF NOT EXISTS wcp_sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  client_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  parent_session_id TEXT REFERENCES wcp_sessions(session_id),
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'ended', 'abandoned', 'failed')),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  trace_id TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wcp_agent_runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES wcp_sessions(session_id),
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  version BIGINT NOT NULL DEFAULT 1,
  trace_id TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (session_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS wcp_tool_calls (
  tool_call_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES wcp_sessions(session_id),
  run_id TEXT NOT NULL REFERENCES wcp_agent_runs(run_id),
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  version BIGINT NOT NULL DEFAULT 1,
  trace_id TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_wcp_sessions_scope ON wcp_sessions (tenant_id, workspace_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_wcp_agent_runs_session ON wcp_agent_runs (session_id, sequence_no);

INSERT INTO schema_migrations (version, checksum)
VALUES ('004_sessions', 'sha256:planemem-p3-004')
ON CONFLICT (version) DO NOTHING;
