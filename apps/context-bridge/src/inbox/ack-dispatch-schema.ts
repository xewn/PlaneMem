/** Separate, explicitly enabled extension; core and acknowledgement v1 are unchanged. */
export const SYNC_INBOX_ACK_DISPATCH_SCHEMA_V1 = `
CREATE TABLE sync_inbox_ack_dispatch_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version INTEGER NOT NULL CHECK (version = 1)
);
INSERT INTO sync_inbox_ack_dispatch_schema(singleton, version) VALUES (1, 1);
CREATE TABLE sync_inbox_ack_dispatches (
  dispatch_id TEXT PRIMARY KEY CHECK (length(dispatch_id) = 26),
  consumer_key TEXT NOT NULL CHECK (length(consumer_key) = 64),
  record_id TEXT NOT NULL REFERENCES sync_inbox_acknowledgements(record_id),
  dispatch_sequence INTEGER NOT NULL CHECK (typeof(dispatch_sequence) = 'integer' AND dispatch_sequence BETWEEN 1 AND 9007199254740991),
  invocation_trace_id TEXT NOT NULL CHECK (length(CAST(invocation_trace_id AS BLOB)) BETWEEN 1 AND 4096),
  started_at_ms INTEGER NOT NULL CHECK (typeof(started_at_ms) = 'integer' AND started_at_ms BETWEEN 0 AND 9007199254740991),
  lease_until_ms INTEGER NOT NULL CHECK (typeof(lease_until_ms) = 'integer' AND lease_until_ms > started_at_ms AND lease_until_ms <= 9007199254740991),
  state TEXT NOT NULL CHECK (state IN ('active', 'unknown', 'expired', 'confirmed')),
  response_json TEXT CHECK (response_json IS NULL OR length(CAST(response_json AS BLOB)) <= 32768),
  UNIQUE (consumer_key, dispatch_sequence),
  CHECK ((state = 'confirmed') = (response_json IS NOT NULL))
);
CREATE UNIQUE INDEX idx_sync_inbox_ack_dispatch_active ON sync_inbox_ack_dispatches(consumer_key) WHERE state = 'active';
CREATE TRIGGER sync_inbox_ack_dispatch_identity BEFORE INSERT ON sync_inbox_ack_dispatches
WHEN NOT EXISTS (SELECT 1 FROM sync_inbox_acknowledgements
  WHERE record_id = NEW.record_id AND consumer_key = NEW.consumer_key)
BEGIN SELECT RAISE(ABORT, 'Dispatch identity must match the original acknowledgement'); END;
CREATE TRIGGER sync_inbox_ack_dispatch_original BEFORE UPDATE ON sync_inbox_ack_dispatches
WHEN NEW.dispatch_id IS NOT OLD.dispatch_id OR NEW.consumer_key IS NOT OLD.consumer_key
  OR NEW.record_id IS NOT OLD.record_id OR NEW.dispatch_sequence IS NOT OLD.dispatch_sequence
  OR NEW.invocation_trace_id IS NOT OLD.invocation_trace_id OR NEW.started_at_ms IS NOT OLD.started_at_ms
  OR NEW.lease_until_ms IS NOT OLD.lease_until_ms
  OR (OLD.response_json IS NOT NULL AND NEW.response_json IS NOT OLD.response_json)
  OR (OLD.state <> 'active' AND NEW.state = 'active')
  OR (OLD.state = 'confirmed' AND NEW.state <> 'confirmed')
BEGIN SELECT RAISE(ABORT, 'Original dispatch records are retained'); END;
CREATE TRIGGER sync_inbox_ack_dispatch_no_delete BEFORE DELETE ON sync_inbox_ack_dispatches
BEGIN SELECT RAISE(ABORT, 'Dispatch history is retained'); END;
`;
