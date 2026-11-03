-- Source only; not executed. Requires 005_sync.
CREATE INDEX IF NOT EXISTS idx_wcp_conflicts_registry_page
  ON wcp_conflicts (tenant_id, workspace_id, project_id, conflict_id COLLATE "C");

CREATE INDEX IF NOT EXISTS idx_wcp_conflicts_registry_status_page
  ON wcp_conflicts (tenant_id, workspace_id, project_id, status, conflict_id COLLATE "C");

INSERT INTO schema_migrations (version, checksum)
VALUES ('049_conflict_registry_pagination', 'sha256:planemem-p3-049')
ON CONFLICT (version) DO NOTHING;
