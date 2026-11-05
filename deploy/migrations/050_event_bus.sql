-- Source migration only. Outbox and each business change commit in the same database transaction.
CREATE TABLE IF NOT EXISTS wcp_event_bus_bindings (
  stream_name TEXT PRIMARY KEY,
  subject_prefix TEXT NOT NULL,
  stream_created TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wcp_event_bus_outbox (
  event_id TEXT PRIMARY KEY,
  ordinal BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  aggregate_key TEXT NOT NULL,
  event_body JSONB NOT NULL CHECK (jsonb_typeof(event_body) = 'object' AND event_body->>'event_id' = event_id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'published', 'rejected')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code TEXT,
  stream_name TEXT,
  stream_sequence BIGINT CHECK (stream_sequence > 0),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((state = 'published') = (published_at IS NOT NULL AND stream_name IS NOT NULL AND stream_sequence IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_event_bus_outbox_pending
  ON wcp_event_bus_outbox (next_attempt_at, ordinal) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_event_bus_outbox_aggregate
  ON wcp_event_bus_outbox (aggregate_key, ordinal) WHERE state <> 'published';

CREATE TABLE IF NOT EXISTS wcp_event_bus_consumptions (
  consumer_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  event_body JSONB NOT NULL,
  stream_name TEXT NOT NULL,
  stream_sequence BIGINT NOT NULL CHECK (stream_sequence > 0),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id)
);
CREATE INDEX IF NOT EXISTS idx_event_bus_consumptions_scope
  ON wcp_event_bus_consumptions (tenant_id, workspace_id, project_id, consumer_name);

-- Invalid messages are retained before terminating their redelivery. No event payload enters metrics.
CREATE TABLE IF NOT EXISTS wcp_event_bus_rejections (
  consumer_name TEXT NOT NULL,
  stream_name TEXT NOT NULL,
  stream_sequence BIGINT NOT NULL CHECK (stream_sequence > 0),
  subject TEXT NOT NULL,
  body BYTEA,
  body_sha256 TEXT NOT NULL,
  body_bytes BIGINT NOT NULL CHECK (body_bytes >= 0),
  reason TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, stream_name, stream_sequence)
);

INSERT INTO schema_migrations (version, checksum)
VALUES ('050_event_bus', 'sha256:planemem-p0-050')
ON CONFLICT (version) DO NOTHING;
