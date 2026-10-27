-- Commit the frozen command before any MCP mutation; query never creates this row.
CREATE TABLE IF NOT EXISTS wcp_memory_operations (
  operation_key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  record JSONB NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((record->>'operation_key' = operation_key) IS TRUE),
  CHECK ((record->>'fingerprint' = fingerprint) IS TRUE)
);
INSERT INTO schema_migrations (version, checksum)
VALUES ('012_memory_original_commands', 'sha256:planemem-p02-012')
ON CONFLICT (version) DO NOTHING;
