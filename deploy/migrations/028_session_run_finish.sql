-- Development only; not executed. Keep existing command receipts valid while adding run completion.
ALTER TABLE wcp_session_commands DROP CONSTRAINT IF EXISTS wcp_session_commands_operation_check;
ALTER TABLE wcp_session_commands ADD CONSTRAINT wcp_session_commands_operation_check
  CHECK (operation IN ('run.start', 'run.finish', 'tool.call', 'end'));
INSERT INTO schema_migrations (version, checksum)
VALUES ('028_session_run_finish', 'sha256:planemem-session-run-finish-028')
ON CONFLICT (version) DO NOTHING;
