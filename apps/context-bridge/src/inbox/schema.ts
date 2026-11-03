/** Explicit creation only. Existing files are never silently migrated. */
export const SYNC_INBOX_SCHEMA_VERSION = 1;
export const SYNC_INBOX_SCHEMA_V1 = `
CREATE TABLE sync_inbox_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version INTEGER NOT NULL CHECK (version = 1)
);
INSERT INTO sync_inbox_schema(singleton, version) VALUES (1, 1);
CREATE TABLE sync_inbox_pages (
  consumer_key TEXT NOT NULL CHECK (length(consumer_key) = 64),
  document_sha256 TEXT NOT NULL CHECK (length(document_sha256) = 64),
  sequence INTEGER NOT NULL CHECK (typeof(sequence) = 'integer' AND sequence BETWEEN 1 AND 9007199254740991),
  previous_sha256 TEXT CHECK (previous_sha256 IS NULL OR length(previous_sha256) = 64),
  from_cursor INTEGER NOT NULL CHECK (typeof(from_cursor) = 'integer' AND from_cursor BETWEEN 0 AND 9007199254740991),
  next_cursor INTEGER NOT NULL CHECK (typeof(next_cursor) = 'integer' AND next_cursor BETWEEN from_cursor AND 9007199254740991),
  page_limit INTEGER NOT NULL CHECK (typeof(page_limit) = 'integer' AND page_limit BETWEEN 1 AND 500),
  document_json TEXT NOT NULL CHECK (length(CAST(document_json AS BLOB)) <= 4227072),
  PRIMARY KEY (consumer_key, document_sha256),
  UNIQUE (consumer_key, sequence),
  UNIQUE (consumer_key, previous_sha256),
  FOREIGN KEY (consumer_key, previous_sha256) REFERENCES sync_inbox_pages(consumer_key, document_sha256)
);
CREATE UNIQUE INDEX idx_sync_inbox_root ON sync_inbox_pages(consumer_key) WHERE previous_sha256 IS NULL;
CREATE TABLE sync_inbox_consumers (
  consumer_key TEXT NOT NULL PRIMARY KEY CHECK (length(consumer_key) = 64),
  identity_json TEXT NOT NULL CHECK (length(CAST(identity_json AS BLOB)) <= 16384),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  head_sha256 TEXT NOT NULL CHECK (length(head_sha256) = 64),
  received_cursor INTEGER NOT NULL CHECK (typeof(received_cursor) = 'integer' AND received_cursor BETWEEN 0 AND 9007199254740991),
  page_count INTEGER NOT NULL CHECK (typeof(page_count) = 'integer' AND page_count BETWEEN 1 AND 9007199254740991),
  FOREIGN KEY (consumer_key, head_sha256) REFERENCES sync_inbox_pages(consumer_key, document_sha256),
  UNIQUE (tenant_id, workspace_id, project_id, actor_id, client_id)
);
CREATE INDEX idx_sync_inbox_scope ON sync_inbox_consumers(tenant_id, workspace_id, project_id);
CREATE TRIGGER sync_inbox_pages_no_update BEFORE UPDATE ON sync_inbox_pages
BEGIN SELECT RAISE(ABORT, 'Saved sync pages are immutable'); END;
CREATE TRIGGER sync_inbox_pages_no_delete BEFORE DELETE ON sync_inbox_pages
BEGIN SELECT RAISE(ABORT, 'Saved sync pages are retained'); END;
`;
