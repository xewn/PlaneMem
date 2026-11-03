-- Development only; not executed. Stable ID ordering for paginated metadata management.
CREATE INDEX IF NOT EXISTS idx_wcp_context_hits_directory
  ON wcp_context_hits (tenant_id, workspace_id, project_id, id COLLATE "C");
INSERT INTO schema_migrations (version, checksum)
VALUES ('034_legacy_context_directory', 'sha256:planemem-legacy-context-directory-034')
ON CONFLICT (version) DO NOTHING;
