CREATE TABLE IF NOT EXISTS wcp_audit_records (
  audit_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  session_id TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('allowed', 'denied', 'error')),
  classification TEXT NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wcp_audit_scope_time ON wcp_audit_records (tenant_id, workspace_id, project_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_wcp_audit_trace ON wcp_audit_records (trace_id);

INSERT INTO schema_migrations (version, checksum)
VALUES ('007_audit', 'sha256:planemem-p6-007')
ON CONFLICT (version) DO NOTHING;
