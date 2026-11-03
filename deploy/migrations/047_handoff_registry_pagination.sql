-- Source only; not executed. Requires 008_workbench_projection and 010_session_continuity_persistence.
CREATE INDEX IF NOT EXISTS idx_wcp_session_handoffs_registry_page
  ON wcp_session_handoffs (tenant_id, workspace_id, project_id, updated_at DESC, handoff_id COLLATE "C");
CREATE INDEX IF NOT EXISTS idx_wcp_handoffs_registry_page
  ON wcp_handoffs (tenant_id, workspace_id, project_id, updated_at DESC, handoff_id COLLATE "C");

INSERT INTO schema_migrations (version, checksum)
VALUES ('047_handoff_registry_pagination', 'sha256:planemem-p3-047')
ON CONFLICT (version) DO NOTHING;
