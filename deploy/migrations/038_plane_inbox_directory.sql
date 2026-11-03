-- Development only; not executed. Scoped metadata lookup and keyset pagination.
CREATE INDEX IF NOT EXISTS idx_wcp_plane_inbox_scope_directory
  ON wcp_plane_event_inbox (tenant_id, workspace_id, project_id, event_id COLLATE "C" DESC);
CREATE INDEX IF NOT EXISTS idx_wcp_plane_inbox_status_directory
  ON wcp_plane_event_inbox (tenant_id, workspace_id, project_id, status, event_id COLLATE "C" DESC);
CREATE INDEX IF NOT EXISTS idx_wcp_plane_inbox_entity_directory
  ON wcp_plane_event_inbox (tenant_id, workspace_id, project_id, aggregate_id, event_id COLLATE "C" DESC);
INSERT INTO schema_migrations (version, checksum)
VALUES ('038_plane_inbox_directory', 'sha256:planemem-plane-inbox-directory-038')
ON CONFLICT (version) DO NOTHING;
