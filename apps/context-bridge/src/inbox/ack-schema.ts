/** Optional, explicitly enabled extension. Core inbox schema v1 remains unchanged. */
export const SYNC_INBOX_ACK_SCHEMA_V1 = `
CREATE TABLE sync_inbox_ack_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version INTEGER NOT NULL CHECK (version = 1)
);
INSERT INTO sync_inbox_ack_schema(singleton, version) VALUES (1, 1);
CREATE TABLE sync_inbox_acknowledgements (
  consumer_key TEXT NOT NULL CHECK (length(consumer_key) = 64),
  attempt_sequence INTEGER NOT NULL CHECK (typeof(attempt_sequence) = 'integer' AND attempt_sequence BETWEEN 1 AND 9007199254740991),
  record_id TEXT NOT NULL UNIQUE CHECK (length(record_id) = 26),
  document_sha256 TEXT NOT NULL CHECK (length(document_sha256) = 64),
  cursor INTEGER NOT NULL CHECK (typeof(cursor) = 'integer' AND cursor BETWEEN 0 AND 9007199254740991),
  request_trace_id TEXT NOT NULL CHECK (length(CAST(request_trace_id AS BLOB)) <= 4096),
  state TEXT NOT NULL CHECK (state IN ('unconfirmed', 'confirmed', 'observed')),
  response_json TEXT CHECK (response_json IS NULL OR length(CAST(response_json AS BLOB)) <= 32768),
  observation_json TEXT CHECK (observation_json IS NULL OR length(CAST(observation_json AS BLOB)) <= 32768),
  PRIMARY KEY (consumer_key, attempt_sequence),
  FOREIGN KEY (consumer_key, document_sha256) REFERENCES sync_inbox_pages(consumer_key, document_sha256),
  CHECK ((state = 'unconfirmed' AND response_json IS NULL) OR (state = 'confirmed' AND response_json IS NOT NULL) OR (state = 'observed' AND observation_json IS NOT NULL AND response_json IS NULL))
);
CREATE UNIQUE INDEX idx_sync_inbox_ack_pending ON sync_inbox_acknowledgements(consumer_key) WHERE state = 'unconfirmed';
CREATE TRIGGER sync_inbox_ack_original BEFORE UPDATE ON sync_inbox_acknowledgements
WHEN NEW.consumer_key IS NOT OLD.consumer_key OR NEW.attempt_sequence IS NOT OLD.attempt_sequence
  OR NEW.record_id IS NOT OLD.record_id OR NEW.document_sha256 IS NOT OLD.document_sha256
  OR NEW.cursor IS NOT OLD.cursor OR NEW.request_trace_id IS NOT OLD.request_trace_id
  OR (OLD.response_json IS NOT NULL AND NEW.response_json IS NOT OLD.response_json)
  OR (OLD.state = 'confirmed' AND NEW.state <> 'confirmed')
  OR (OLD.state = 'observed' AND NEW.state = 'unconfirmed')
BEGIN SELECT RAISE(ABORT, 'Original acknowledgement records are retained'); END;
CREATE TRIGGER sync_inbox_ack_no_delete BEFORE DELETE ON sync_inbox_acknowledgements
BEGIN SELECT RAISE(ABORT, 'Acknowledgement history is retained'); END;
`;
