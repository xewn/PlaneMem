-- Source only; not executed. Requires 010_session_continuity_persistence.
CREATE INDEX IF NOT EXISTS idx_wcp_checkpoints_registry_page
  ON wcp_session_checkpoints (tenant_id, workspace_id, project_id, created_at DESC, checkpoint_id COLLATE "C");

INSERT INTO schema_migrations (version, checksum)
VALUES ('048_checkpoint_registry_pagination', 'sha256:planemem-p3-048')
ON CONFLICT (version) DO NOTHING;
