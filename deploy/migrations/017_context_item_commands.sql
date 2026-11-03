CREATE TABLE IF NOT EXISTS wcp_context_item_commands (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES wcp_context_items(id),
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'archive')),
  item_version BIGINT NOT NULL CHECK (item_version > 0),
  classification TEXT NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  event_id TEXT NOT NULL UNIQUE REFERENCES wcp_sync_events(event_id),
  server_cursor BIGINT NOT NULL CHECK (server_cursor > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, project_id, request_key)
);

CREATE INDEX IF NOT EXISTS idx_context_item_commands_item
  ON wcp_context_item_commands (tenant_id, workspace_id, project_id, item_id, item_version);

INSERT INTO schema_migrations (version, checksum)
VALUES ('017_context_item_commands', 'sha256:planemem-context-item-017')
ON CONFLICT (version) DO NOTHING;
