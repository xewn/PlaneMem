-- Development only; not executed. Extend the durable command ledger for tool results.
ALTER TABLE wcp_session_commands DROP CONSTRAINT IF EXISTS wcp_session_commands_operation_check;
ALTER TABLE wcp_session_commands ADD CONSTRAINT wcp_session_commands_operation_check
  CHECK (operation IN ('run.start', 'run.finish', 'tool.call', 'tool.finish', 'end'));
INSERT INTO schema_migrations (version, checksum)
VALUES ('029_session_tool_finish', 'sha256:planemem-session-tool-finish-029')
ON CONFLICT (version) DO NOTHING;
