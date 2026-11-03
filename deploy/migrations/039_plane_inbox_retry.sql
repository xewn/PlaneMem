-- Development only; not executed. Queue CAS and durable administrator retry receipts.
ALTER TABLE wcp_plane_event_inbox
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE TABLE IF NOT EXISTS wcp_plane_inbox_retries (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES wcp_plane_event_inbox(event_id),
  request_fingerprint TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
  receipt JSONB NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, project_id, actor_id, client_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_wcp_plane_retry_event
  ON wcp_plane_inbox_retries (tenant_id, workspace_id, project_id, event_id, created_at);
INSERT INTO schema_migrations (version, checksum)
VALUES ('039_plane_inbox_retry', 'sha256:planemem-plane-inbox-retry-039')
ON CONFLICT (version) DO NOTHING;
