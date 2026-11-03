-- Existing unclassified legacy copies remain restricted. Re-indexing cannot downgrade them.
ALTER TABLE wcp_context_hits
  ADD COLUMN IF NOT EXISTS classification TEXT NOT NULL DEFAULT 'restricted'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_wcp_context_hits_fts
  ON wcp_context_hits USING GIN (to_tsvector('simple'::regconfig, title || ' ' || snippet))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS wcp_context_index_receipts (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, project_id, actor_id, client_id, request_key)
);
