-- Development only; not executed. Successful command snapshots share the session transaction.
CREATE TABLE IF NOT EXISTS wcp_session_commands (
  session_id TEXT NOT NULL REFERENCES wcp_sessions(session_id),
  operation TEXT NOT NULL CHECK (operation IN ('run.start', 'tool.call', 'end')),
  request_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_document JSONB NOT NULL CHECK (jsonb_typeof(response_document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, operation, request_key)
);
INSERT INTO schema_migrations (version, checksum)
VALUES ('026_session_command_receipts', 'sha256:planemem-session-command-receipts-026')
ON CONFLICT (version) DO NOTHING;
