-- Lifecycle receipts contain metadata only; index content remains in wcp_context_hits.
CREATE TABLE IF NOT EXISTS wcp_context_index_mutations (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('delete', 'restore')),
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, project_id, actor_id, client_id, operation, request_key)
);

INSERT INTO schema_migrations (version, checksum)
VALUES ('033_legacy_context_lifecycle', 'sha256:planemem-legacy-context-lifecycle-033')
ON CONFLICT (version) DO NOTHING;
