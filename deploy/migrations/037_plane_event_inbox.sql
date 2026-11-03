-- Development only; not executed. Verified deliveries survive gateway restarts.
CREATE TABLE IF NOT EXISTS wcp_plane_event_inbox (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('project', 'work_item')),
  aggregate_id TEXT NOT NULL,
  aggregate_version BIGINT NOT NULL CHECK (aggregate_version > 0 AND aggregate_version <= 9007199254740991),
  event_document JSONB NOT NULL CHECK (jsonb_typeof(event_document) = 'object'),
  event_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
  attempts BIGINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code TEXT,
  applied_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'applied') = (applied_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS wcp_plane_webhook_deliveries (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES wcp_plane_event_inbox(event_id),
  first_raw_hash TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, project_id, delivery_id)
);

CREATE INDEX IF NOT EXISTS idx_wcp_plane_inbox_due
  ON wcp_plane_event_inbox (next_attempt_at, received_at, event_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wcp_plane_inbox_aggregate
  ON wcp_plane_event_inbox (tenant_id, workspace_id, project_id, aggregate_type, aggregate_id, aggregate_version);
CREATE INDEX IF NOT EXISTS idx_wcp_plane_event_stream
  ON wcp_events (tenant_id, workspace_id, (COALESCE(project_id, aggregate_id)), aggregate_type, aggregate_id, aggregate_version DESC);

INSERT INTO schema_migrations (version, checksum)
VALUES ('037_plane_event_inbox', 'sha256:planemem-plane-event-inbox-037')
ON CONFLICT (version) DO NOTHING;
