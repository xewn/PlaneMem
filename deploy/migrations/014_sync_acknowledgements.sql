CREATE TABLE IF NOT EXISTS wcp_sync_acknowledgements (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  server_cursor BIGINT NOT NULL CHECK (server_cursor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, project_id, actor_id, client_id)
);

INSERT INTO schema_migrations (version, checksum)
VALUES ('014_sync_acknowledgements', 'sha256:planemem-sync-014')
ON CONFLICT (version) DO NOTHING;
