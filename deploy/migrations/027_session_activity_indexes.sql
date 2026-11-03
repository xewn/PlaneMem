-- Development only; not executed. Match bytewise tool-call pagination with and without a run filter.
CREATE INDEX IF NOT EXISTS idx_wcp_tool_calls_session_page
  ON wcp_tool_calls (session_id, tool_call_id COLLATE "C" DESC);
CREATE INDEX IF NOT EXISTS idx_wcp_tool_calls_run_page
  ON wcp_tool_calls (session_id, run_id, tool_call_id COLLATE "C" DESC);
INSERT INTO schema_migrations (version, checksum)
VALUES ('027_session_activity_indexes', 'sha256:planemem-session-activity-indexes-027')
ON CONFLICT (version) DO NOTHING;
