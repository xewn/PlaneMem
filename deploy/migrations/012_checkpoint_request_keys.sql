ALTER TABLE wcp_session_checkpoints
  ADD COLUMN IF NOT EXISTS request_key TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wcp_session_checkpoints_request
  ON wcp_session_checkpoints (session_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wcp_tool_calls_session ON wcp_tool_calls (session_id);

INSERT INTO schema_migrations (version, checksum)
VALUES ('012_checkpoint_request_keys', 'sha256:planemem-checkpoint-012')
ON CONFLICT (version) DO NOTHING;
