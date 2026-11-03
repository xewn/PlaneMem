-- Development only; not executed. Persisted session and pack resource discovery.
CREATE INDEX IF NOT EXISTS idx_wcp_checkpoints_resource_directory
  ON wcp_session_checkpoints (tenant_id, workspace_id, project_id, session_id COLLATE "C", checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_wcp_session_handoffs_checkpoint_directory
  ON wcp_session_handoffs (tenant_id, workspace_id, project_id, checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_wcp_handoffs_resource_directory
  ON wcp_handoffs (tenant_id, workspace_id, project_id, session_id COLLATE "C", handoff_id);
CREATE INDEX IF NOT EXISTS idx_wcp_packs_resource_directory
  ON wcp_context_packs (tenant_id, workspace_id, project_id, pack_id COLLATE "C")
  WHERE pack_document IS NOT NULL;
INSERT INTO schema_migrations (version, checksum)
VALUES ('036_mcp_continuity_directory', 'sha256:planemem-mcp-continuity-directory-036')
ON CONFLICT (version) DO NOTHING;
