CREATE TABLE IF NOT EXISTS wcp_local_outbox (
  event_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempt INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wcp_local_outbox_due ON wcp_local_outbox (status, next_retry_at);

INSERT INTO schema_migrations (version, checksum)
VALUES ('006_outbox', 'sha256:planemem-p3-006')
ON CONFLICT (version) DO NOTHING;
