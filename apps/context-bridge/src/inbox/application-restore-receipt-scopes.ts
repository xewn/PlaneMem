import type { DatabaseSync } from 'node:sqlite';
import { isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import { applicationDigest, applicationFailure, applicationTrace } from './application-model.js';
import type { SyncInboxApplicationRestoreReceipt } from './application-restore-receipts.js';

export interface SyncInboxApplicationRestoreReceiptScopesQuery {
  limit: number;
  timeout_ms: number;
  after_consumer_key?: string;
  after_application_key?: string;
}

export function parseInboxApplicationRestoreReceiptScopesQuery(
  input: unknown,
  trace: string,
): SyncInboxApplicationRestoreReceiptScopesQuery {
  try {
    applicationTrace(trace);
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    const { limit = 20, timeout_ms = 30000, after_consumer_key, after_application_key } = row;
    if (
      Object.keys(row).some(
        (key) =>
          !['limit', 'timeout_ms', 'after_consumer_key', 'after_application_key'].includes(key),
      ) ||
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      typeof timeout_ms !== 'number' ||
      !Number.isSafeInteger(timeout_ms) ||
      timeout_ms < 1 ||
      timeout_ms > 90000 ||
      (after_consumer_key === undefined) !== (after_application_key === undefined)
    )
      throw new TypeError();
    return {
      limit,
      timeout_ms,
      ...(after_consumer_key === undefined
        ? {}
        : {
            after_consumer_key: applicationDigest(after_consumer_key),
            after_application_key: applicationDigest(after_application_key),
          }),
    };
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_RESTORE_RECEIPT_SCOPES_QUERY_INVALID',
      'Supply only limit (1–50), timeout_ms (1–90000) and an optional pair of after_consumer_key/after_application_key digests',
      trace,
    );
  }
}

/** Caller owns a read transaction and validates the extension and complete representative receipts. */
export function readInboxApplicationRestoreReceiptScopes(
  db: DatabaseSync,
  query: SyncInboxApplicationRestoreReceiptScopesQuery,
  read: (
    key: { consumer: string; application: string },
    requestId: string,
  ) => SyncInboxApplicationRestoreReceipt | undefined,
  trace: string,
  check: () => void,
) {
  const corrupt = () =>
    applicationFailure(
      'INBOX_APPLICATION_RESTORE_RECEIPT_SCOPES_CORRUPT',
      'A selected restore receipt scope, ordering or representative is inconsistent; preserve the inbox',
      trace,
    );
  check();
  // Group the raw keys before projecting bounded values, so malformed scopes are not silently skipped.
  // LIMIT bounds returned rows, not the database work needed to find distinct scopes.
  const statement = db.prepare(`WITH scopes AS (
    SELECT consumer_key, application_key FROM sync_inbox_application_restore_receipts
    ${query.after_consumer_key === undefined ? '' : 'WHERE (consumer_key COLLATE BINARY, application_key COLLATE BINARY) > (?, ?)'}
    GROUP BY consumer_key COLLATE BINARY, application_key COLLATE BINARY
    ORDER BY consumer_key COLLATE BINARY ASC, application_key COLLATE BINARY ASC LIMIT ?
  ) SELECT
    CASE WHEN typeof(s.consumer_key) = 'text' AND length(CAST(s.consumer_key AS BLOB)) = 64 THEN s.consumer_key END AS consumer_key,
    CASE WHEN typeof(s.application_key) = 'text' AND length(CAST(s.application_key AS BLOB)) = 64 THEN s.application_key END AS application_key,
    (SELECT CASE WHEN typeof(r.restore_request_id) = 'text' AND length(CAST(r.restore_request_id AS BLOB)) <= 1020 THEN r.restore_request_id END
      FROM sync_inbox_application_restore_receipts r
      WHERE r.consumer_key COLLATE BINARY = s.consumer_key AND r.application_key COLLATE BINARY = s.application_key
      ORDER BY r.restore_request_id COLLATE BINARY ASC LIMIT 1) AS representative_request_id
    FROM scopes s ORDER BY s.consumer_key COLLATE BINARY ASC, s.application_key COLLATE BINARY ASC`);
  const rows =
    query.after_consumer_key === undefined
      ? statement.all(query.limit + 1)
      : statement.all(query.after_consumer_key, query.after_application_key!, query.limit + 1);
  check();
  const items = [];
  let previousConsumer = query.after_consumer_key;
  let previousApplication = query.after_application_key;
  let selected_receipt_bytes = 0;
  for (const row of rows) {
    check();
    let consumer: string;
    let application: string;
    try {
      consumer = applicationDigest(row.consumer_key);
      application = applicationDigest(row.application_key);
    } catch {
      throw corrupt();
    }
    const id = row.representative_request_id;
    if (
      !isSyncIdentifier(id) ||
      (previousConsumer !== undefined &&
        (consumer < previousConsumer ||
          (consumer === previousConsumer && application <= previousApplication!)))
    )
      throw corrupt();
    // Hex keys have identical JavaScript and UTF-8 BINARY ordering.
    const receipt = read({ consumer, application }, id);
    if (!receipt || receipt.query.restore_request_id !== id) throw corrupt();
    selected_receipt_bytes += Buffer.byteLength(JSON.stringify(receipt), 'utf8');
    check();
    if (items.length < query.limit) {
      const selection = {
        expected_identity: receipt.query.expected_identity,
        application: receipt.query.application,
        timeout_ms: query.timeout_ms,
      };
      items.push({
        consumer_key: consumer,
        application_key: application,
        expected_identity: selection.expected_identity,
        application: selection.application,
        representative_request_id: id,
        receipt_list_query: { ...selection, limit: 20 },
        receipt_get_query: { ...selection, restore_request_id: id },
        receipt_audit_query: { ...selection },
      });
    }
    previousConsumer = consumer;
    previousApplication = application;
  }
  const has_more = rows.length > query.limit;
  const last = items.at(-1);
  check();
  return {
    kind: 'application-restore-receipt-scopes' as const,
    catalog_completed: true,
    items,
    limit: query.limit,
    after_consumer_key: query.after_consumer_key ?? null,
    after_application_key: query.after_application_key ?? null,
    has_more,
    next_query:
      has_more && last
        ? {
            ...query,
            after_consumer_key: last.consumer_key,
            after_application_key: last.application_key,
          }
        : null,
    checked_representative_receipts: rows.length,
    selected_receipt_bytes,
    catalog_coverage: 'representative-per-selected-scope-and-lookahead' as const,
    representative_selection: 'first-request-id-binary-ascending' as const,
    full_receipt_history_audit: 'not-performed' as const,
    order: 'consumer-key-application-key-binary-ascending' as const,
    consistency: 'keyset-current-state' as const,
    receipt_scope: 'historical-local-transaction' as const,
    current_state: 'not-read' as const,
    absence_proves_rollback: false,
    local_write_state: 'not-performed' as const,
  };
}
