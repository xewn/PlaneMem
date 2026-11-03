-- Development only; not executed. A session and its ordinary start receipt commit together.
CREATE TABLE IF NOT EXISTS wcp_session_start_commands (
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  request_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES wcp_sessions(session_id),
  response_document JSONB NOT NULL CHECK (jsonb_typeof(response_document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, project_id, request_key),
  CHECK (request_key ~ '^[a-f0-9]{64}$'),
  CHECK (request_fingerprint ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_wcp_session_start_commands_session
  ON wcp_session_start_commands (tenant_id, workspace_id, project_id, session_id);

INSERT INTO schema_migrations (version, checksum)
VALUES ('044_session_start_receipts', 'sha256:planemem-session-start-receipts-044')
ON CONFLICT (version) DO NOTHING;
