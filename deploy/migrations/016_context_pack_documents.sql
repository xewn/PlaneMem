ALTER TABLE wcp_context_packs
  ADD COLUMN IF NOT EXISTS pack_document JSONB,
  ADD COLUMN IF NOT EXISTS source_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS read_restricted BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS request_key TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS server_cursor BIGINT;

ALTER TABLE wcp_context_packs DROP CONSTRAINT IF EXISTS wcp_context_packs_status_check;
ALTER TABLE wcp_context_packs ADD CONSTRAINT wcp_context_packs_status_check
  CHECK (status IN ('latest', 'expired', 'proposed', 'superseded'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_context_pack_request
  ON wcp_context_packs (tenant_id, workspace_id, project_id, request_key)
  WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_context_pack_documents_latest
  ON wcp_context_packs (tenant_id, workspace_id, project_id, read_restricted, version DESC)
  WHERE pack_document IS NOT NULL;

INSERT INTO schema_migrations (version, checksum)
VALUES ('016_context_pack_documents', 'sha256:planemem-context-pack-016')
ON CONFLICT (version) DO NOTHING;
