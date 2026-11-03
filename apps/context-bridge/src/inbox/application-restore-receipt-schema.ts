/** Optional extension. Only the explicit enable command executes this source. */
export const SYNC_INBOX_APPLICATION_RESTORE_RECEIPT_SCHEMA_V1 = `
CREATE TABLE sync_inbox_application_restore_receipt_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version INTEGER NOT NULL CHECK (version = 1)
) STRICT;
INSERT INTO sync_inbox_application_restore_receipt_schema VALUES (1, 1);
CREATE TABLE sync_inbox_application_restore_receipts (
  consumer_key TEXT NOT NULL CHECK (length(consumer_key) = 64 AND consumer_key NOT GLOB '*[^0-9a-f]*'),
  application_key TEXT NOT NULL CHECK (length(application_key) = 64 AND application_key NOT GLOB '*[^0-9a-f]*'),
  restore_request_id TEXT NOT NULL CHECK (length(CAST(restore_request_id AS BLOB)) BETWEEN 1 AND 1020),
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
  receipt_json TEXT NOT NULL CHECK (length(CAST(receipt_json AS BLOB)) BETWEEN 1 AND 65536),
  receipt_sha256 TEXT NOT NULL CHECK (length(receipt_sha256) = 64 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (consumer_key, application_key, restore_request_id)
) STRICT;
CREATE TRIGGER sync_inbox_application_restore_receipts_no_update
BEFORE UPDATE ON sync_inbox_application_restore_receipts BEGIN
  SELECT RAISE(ABORT, 'application restore receipts are immutable');
END;
CREATE TRIGGER sync_inbox_application_restore_receipts_no_delete
BEFORE DELETE ON sync_inbox_application_restore_receipts BEGIN
  SELECT RAISE(ABORT, 'application restore receipts are immutable');
END;
`;
