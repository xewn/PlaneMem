ALTER TABLE wcp_conflicts ADD COLUMN IF NOT EXISTS sensitivity TEXT
  CHECK (sensitivity IN ('public', 'internal', 'confidential', 'restricted'));

CREATE TABLE IF NOT EXISTS wcp_sync_uploads (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_event_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  client_cursor BIGINT CHECK (client_cursor > 0),
  server_event_id TEXT NOT NULL UNIQUE REFERENCES wcp_sync_events (event_id),
  conflict_id TEXT REFERENCES wcp_conflicts (conflict_id),
  entity_type TEXT,
  entity_id TEXT,
  PRIMARY KEY (tenant_id, workspace_id, project_id, actor_id, client_id, client_event_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wcp_sync_upload_cursor
  ON wcp_sync_uploads (tenant_id, workspace_id, project_id, actor_id, client_id, client_cursor)
  WHERE client_cursor IS NOT NULL;

CREATE TABLE IF NOT EXISTS wcp_sync_batch_receipts (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result JSONB NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, project_id, request_key)
);

INSERT INTO schema_migrations (version, checksum)
VALUES ('015_sync_uploads', 'sha256:planemem-sync-015')
ON CONFLICT (version) DO NOTHING;
