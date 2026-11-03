ALTER TABLE wcp_conflicts
  ADD COLUMN IF NOT EXISTS resolved_value JSONB,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by_client TEXT,
  ADD COLUMN IF NOT EXISTS resolution_request_key TEXT,
  ADD COLUMN IF NOT EXISTS resolution_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS resolution_event_id TEXT REFERENCES wcp_sync_events(event_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wcp_conflicts_resolution_event
  ON wcp_conflicts (resolution_event_id) WHERE resolution_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wcp_audit_scope_resource_time
  ON wcp_audit_records (tenant_id, workspace_id, project_id, resource, occurred_at DESC);

INSERT INTO schema_migrations (version, checksum)
VALUES ('013_conflict_decisions', 'sha256:planemem-conflict-013')
ON CONFLICT (version) DO NOTHING;
