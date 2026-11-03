/** Optional extension, explicitly enabled. The received-page schema remains version 1. */
export const SYNC_INBOX_APPLICATION_SCHEMA_V1 = `
CREATE TABLE sync_inbox_application_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version INTEGER NOT NULL CHECK (version = 1)
);
INSERT INTO sync_inbox_application_schema(singleton, version) VALUES (1, 1);
CREATE TABLE sync_inbox_application_steps (
  consumer_key TEXT NOT NULL CHECK (length(consumer_key) = 64),
  application_key TEXT NOT NULL CHECK (length(application_key) = 64),
  document_sha256 TEXT NOT NULL CHECK (length(document_sha256) = 64),
  previous_sha256 TEXT CHECK (previous_sha256 IS NULL OR length(previous_sha256) = 64),
  sequence INTEGER NOT NULL CHECK (typeof(sequence) = 'integer' AND sequence BETWEEN 1 AND 9007199254740991),
  next_cursor INTEGER NOT NULL CHECK (typeof(next_cursor) = 'integer' AND next_cursor BETWEEN 0 AND 9007199254740991),
  event_count INTEGER NOT NULL CHECK (typeof(event_count) = 'integer' AND event_count BETWEEN 0 AND 500),
  projection_json TEXT NOT NULL CHECK (length(CAST(projection_json AS BLOB)) <= 1048576),
  projection_sha256 TEXT NOT NULL CHECK (length(projection_sha256) = 64),
  trace_id TEXT NOT NULL CHECK (length(CAST(trace_id AS BLOB)) <= 4096),
  PRIMARY KEY (consumer_key, application_key, document_sha256),
  UNIQUE (consumer_key, application_key, sequence),
  UNIQUE (consumer_key, application_key, previous_sha256),
  FOREIGN KEY (consumer_key, document_sha256) REFERENCES sync_inbox_pages(consumer_key, document_sha256),
  FOREIGN KEY (consumer_key, application_key, previous_sha256) REFERENCES sync_inbox_application_steps(consumer_key, application_key, document_sha256)
);
CREATE UNIQUE INDEX idx_sync_inbox_application_root ON sync_inbox_application_steps(consumer_key, application_key) WHERE previous_sha256 IS NULL;
CREATE TABLE sync_inbox_applications (
  consumer_key TEXT NOT NULL CHECK (length(consumer_key) = 64),
  application_key TEXT NOT NULL CHECK (length(application_key) = 64),
  application_json TEXT NOT NULL CHECK (length(CAST(application_json AS BLOB)) <= 16384),
  head_sha256 TEXT NOT NULL CHECK (length(head_sha256) = 64),
  PRIMARY KEY (consumer_key, application_key),
  FOREIGN KEY (consumer_key, application_key, head_sha256) REFERENCES sync_inbox_application_steps(consumer_key, application_key, document_sha256)
);
CREATE TABLE sync_inbox_application_events (
  consumer_key TEXT NOT NULL CHECK (length(consumer_key) = 64),
  application_key TEXT NOT NULL CHECK (length(application_key) = 64),
  event_id TEXT NOT NULL,
  server_cursor INTEGER NOT NULL CHECK (typeof(server_cursor) = 'integer' AND server_cursor BETWEEN 1 AND 9007199254740991),
  document_sha256 TEXT NOT NULL CHECK (length(document_sha256) = 64),
  event_sha256 TEXT NOT NULL CHECK (length(event_sha256) = 64),
  PRIMARY KEY (consumer_key, application_key, event_id),
  UNIQUE (consumer_key, application_key, server_cursor),
  FOREIGN KEY (consumer_key, application_key, document_sha256) REFERENCES sync_inbox_application_steps(consumer_key, application_key, document_sha256)
);
CREATE INDEX idx_sync_inbox_application_page_events ON sync_inbox_application_events(consumer_key, application_key, document_sha256);
CREATE TRIGGER sync_inbox_application_steps_no_update BEFORE UPDATE ON sync_inbox_application_steps
BEGIN SELECT RAISE(ABORT, 'Application snapshots are immutable'); END;
CREATE TRIGGER sync_inbox_application_steps_no_delete BEFORE DELETE ON sync_inbox_application_steps
BEGIN SELECT RAISE(ABORT, 'Application snapshots are retained'); END;
CREATE TRIGGER sync_inbox_application_events_no_update BEFORE UPDATE ON sync_inbox_application_events
BEGIN SELECT RAISE(ABORT, 'Applied event bindings are immutable'); END;
CREATE TRIGGER sync_inbox_application_events_no_delete BEFORE DELETE ON sync_inbox_application_events
BEGIN SELECT RAISE(ABORT, 'Applied event bindings are retained'); END;
`;
