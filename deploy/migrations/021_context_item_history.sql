CREATE TABLE IF NOT EXISTS wcp_context_item_history (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES wcp_context_items(id),
  item_version BIGINT NOT NULL CHECK (item_version > 0),
  operation TEXT NOT NULL CHECK (operation IN ('baseline', 'create', 'update', 'archive', 'restore')),
  title TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'proposed', 'expired', 'excluded')),
  archived_at TIMESTAMPTZ,
  item_document JSONB NOT NULL CHECK (jsonb_typeof(item_document) = 'object'),
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  actor_id TEXT,
  client_id TEXT,
  event_id TEXT REFERENCES wcp_sync_events(event_id),
  recorded_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, project_id, item_id, item_version),
  CHECK ((operation = 'baseline' AND actor_id IS NULL AND client_id IS NULL AND event_id IS NULL)
    OR (operation <> 'baseline' AND actor_id IS NOT NULL AND client_id IS NOT NULL AND event_id IS NOT NULL)),
  CHECK ((operation = 'archive' AND archived_at IS NOT NULL)
    OR operation = 'baseline' OR (operation <> 'archive' AND archived_at IS NULL))
);

-- No invented snapshots or authors for versions predating this feature.
-- The gateway captures an existing row as a baseline on its next successful edit.
INSERT INTO schema_migrations (version, checksum)
VALUES ('021_context_item_history', 'sha256:planemem-context-history-021')
ON CONFLICT (version) DO NOTHING;
