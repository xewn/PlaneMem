-- Source only, not executed. Requires 004_sessions.
-- Match the keyset order, including the deterministic ID tie breaker.
CREATE INDEX IF NOT EXISTS idx_wcp_sessions_registry_page
  ON wcp_sessions (tenant_id, workspace_id, project_id, started_at DESC, session_id COLLATE "C");

INSERT INTO schema_migrations (version, checksum)
VALUES ('046_session_registry_pagination', 'sha256:planemem-p3-046')
ON CONFLICT (version) DO NOTHING;
