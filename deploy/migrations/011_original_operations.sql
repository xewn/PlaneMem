-- Receipts are append-only protocol history, never a projection of current session state.
CREATE TABLE IF NOT EXISTS wcp_continuity_operations (
  operation_key TEXT NOT NULL,
  dispatch_attempt INTEGER NOT NULL CHECK (dispatch_attempt > 0),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_key, dispatch_attempt),
  CHECK (jsonb_typeof(record) = 'object'),
  CHECK ((record->>'operation_key' = operation_key) IS TRUE),
  CHECK (((record->>'dispatch_attempt')::integer = dispatch_attempt) IS TRUE),
  CHECK ((record->>'fingerprint' = fingerprint) IS TRUE)
);

CREATE TABLE IF NOT EXISTS wcp_legacy_session_commands (
  command_key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version, checksum)
VALUES ('011_original_operations', 'sha256:planemem-p02-011')
ON CONFLICT (version) DO NOTHING;
