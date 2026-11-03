-- Development only; not executed. Keyset ordering for the persisted MCP directory.
CREATE INDEX IF NOT EXISTS idx_wcp_context_items_resource_directory
  ON wcp_context_items (tenant_id, workspace_id, project_id, id COLLATE "C")
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wcp_work_items_resource_directory
  ON wcp_work_items (tenant_id, workspace_id, project_id, id COLLATE "C")
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wcp_proposals_resource_directory
  ON wcp_proposals (tenant_id, workspace_id, project_id, proposal_id COLLATE "C");
INSERT INTO schema_migrations (version, checksum)
VALUES ('035_mcp_resource_directory', 'sha256:planemem-mcp-resource-directory-035')
ON CONFLICT (version) DO NOTHING;
