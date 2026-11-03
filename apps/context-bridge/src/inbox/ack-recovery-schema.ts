/** Optional provenance extension. Existing core, ack and dispatch v1 tables stay unchanged. */
export const SYNC_INBOX_ACK_RECOVERY_SCHEMA_V1 = `
CREATE TABLE sync_inbox_ack_recovery_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version INTEGER NOT NULL CHECK (version = 1)
);
INSERT INTO sync_inbox_ack_recovery_schema(singleton, version) VALUES (1, 1);
CREATE TABLE sync_inbox_ack_recoveries (
  record_id TEXT PRIMARY KEY REFERENCES sync_inbox_acknowledgements(record_id),
  consumer_key TEXT NOT NULL CHECK (length(consumer_key) = 64),
  recovery_id TEXT NOT NULL UNIQUE CHECK (length(recovery_id) = 26),
  first_dispatch_id TEXT NOT NULL UNIQUE REFERENCES sync_inbox_ack_dispatches(dispatch_id),
  invocation_trace_id TEXT NOT NULL CHECK (length(CAST(invocation_trace_id AS BLOB)) BETWEEN 1 AND 4096),
  registered_at_ms INTEGER NOT NULL CHECK (typeof(registered_at_ms) = 'integer' AND registered_at_ms BETWEEN 0 AND 9007199254740991)
);
CREATE TRIGGER sync_inbox_ack_recovery_binding BEFORE INSERT ON sync_inbox_ack_recoveries
WHEN NOT EXISTS (
  SELECT 1 FROM sync_inbox_acknowledgements a JOIN sync_inbox_ack_dispatches d ON d.record_id = a.record_id
  WHERE a.record_id = NEW.record_id AND a.consumer_key = NEW.consumer_key AND a.state = 'unconfirmed'
    AND d.dispatch_id = NEW.first_dispatch_id AND d.consumer_key = NEW.consumer_key AND d.state = 'active'
    AND d.invocation_trace_id = NEW.invocation_trace_id AND d.started_at_ms = NEW.registered_at_ms
) OR EXISTS (
  SELECT 1 FROM sync_inbox_ack_dispatches WHERE record_id = NEW.record_id AND dispatch_id <> NEW.first_dispatch_id
)
BEGIN SELECT RAISE(ABORT, 'Recovery must bind the first locally recorded dispatch of the unresolved original target'); END;
CREATE TRIGGER sync_inbox_ack_recovery_no_update BEFORE UPDATE ON sync_inbox_ack_recoveries
BEGIN SELECT RAISE(ABORT, 'Recovery provenance is immutable'); END;
CREATE TRIGGER sync_inbox_ack_recovery_no_delete BEFORE DELETE ON sync_inbox_ack_recoveries
BEGIN SELECT RAISE(ABORT, 'Recovery provenance is retained'); END;
`;
