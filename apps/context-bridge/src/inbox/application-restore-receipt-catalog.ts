import type { DatabaseSync } from 'node:sqlite';
import { isSyncIdentifier, syncJsonSnapshot } from '@planemem/contracts';
import {
  applicationFailure,
  parseInboxApplicationQuery,
  type SyncInboxApplicationQuery,
} from './application-model.js';
import type {
  SyncInboxApplicationRestoreReceipt,
  SyncInboxApplicationRestoreReceiptSelection,
} from './application-restore-receipts.js';

export interface SyncInboxApplicationRestoreReceiptCatalogQuery extends SyncInboxApplicationQuery {
  limit: number;
  after_request_id?: string;
}
export function parseInboxApplicationRestoreReceiptCatalogQuery(
  input: unknown,
  trace: string,
): SyncInboxApplicationRestoreReceiptCatalogQuery {
  try {
    const value: unknown = JSON.parse(syncJsonSnapshot(input, 16384));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const { limit = 20, after_request_id, ...base } = value as Record<string, unknown>;
    if (
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (after_request_id !== undefined && !isSyncIdentifier(after_request_id))
    )
      throw new TypeError();
    return {
      ...parseInboxApplicationQuery(base, trace),
      limit,
      ...(after_request_id === undefined ? {} : { after_request_id: after_request_id as string }),
    };
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_RESTORE_RECEIPT_CATALOG_QUERY_INVALID',
      'Supply original identity/application with optional limit (1–50), timeout_ms and after_request_id',
      trace,
    );
  }
}

/** Caller owns one read transaction, requires the extension and supplies complete receipt validation. */
export function readInboxApplicationRestoreReceiptCatalog(
  db: DatabaseSync,
  key: { consumer: string; application: string },
  query: SyncInboxApplicationRestoreReceiptCatalogQuery,
  read: (
    selection: SyncInboxApplicationRestoreReceiptSelection,
  ) => SyncInboxApplicationRestoreReceipt | undefined,
  trace: string,
  check: () => void,
) {
  const corrupt = () =>
    applicationFailure(
      'INBOX_APPLICATION_RESTORE_RECEIPT_CATALOG_CORRUPT',
      'A selected restore receipt ID, ordering or record is inconsistent; preserve the inbox',
      trace,
    );
  check();
  const statement = db.prepare(`SELECT
    CASE WHEN typeof(restore_request_id) = 'text' AND length(CAST(restore_request_id AS BLOB)) <= 1020 THEN restore_request_id ELSE NULL END AS restore_request_id
    FROM sync_inbox_application_restore_receipts
    WHERE consumer_key = ? AND application_key = ?
    ${query.after_request_id === undefined ? '' : 'AND restore_request_id COLLATE BINARY > ?'}
    ORDER BY restore_request_id COLLATE BINARY ASC LIMIT ?`);
  // No synthetic lower bound on the first page: invalid empty/null IDs must be diagnosed.
  const rows =
    query.after_request_id === undefined
      ? statement.all(key.consumer, key.application, query.limit + 1)
      : statement.all(key.consumer, key.application, query.after_request_id, query.limit + 1);
  check();
  const items: {
    restore_request_id: string;
    request_sha256: string;
    archive_document_sha256: string;
    restore_trace_id: string;
    target_bound: boolean;
    outcome: SyncInboxApplicationRestoreReceipt['outcome'];
    receipt_get_query: SyncInboxApplicationRestoreReceiptSelection;
  }[] = [];
  let previous = query.after_request_id;
  let selected_receipt_bytes = 0;
  for (const row of rows) {
    check();
    const id = row.restore_request_id;
    if (!isSyncIdentifier(id)) throw corrupt();
    // Compare UTF-8 bytes, not JavaScript UTF-16 ordering, to match the BINARY keyset.
    if (
      previous !== undefined &&
      Buffer.compare(Buffer.from(id, 'utf8'), Buffer.from(previous, 'utf8')) <= 0
    )
      throw corrupt();
    const selection = {
      expected_identity: query.expected_identity,
      application: query.application,
      timeout_ms: query.timeout_ms,
      restore_request_id: id,
    };
    // The extra lookahead is fully verified too; malformed entries are never skipped.
    const receipt = read(selection);
    if (!receipt || receipt.query.restore_request_id !== id) throw corrupt();
    selected_receipt_bytes += Buffer.byteLength(JSON.stringify(receipt), 'utf8');
    check();
    if (items.length < query.limit)
      items.push({
        restore_request_id: id,
        request_sha256: receipt.request_sha256,
        archive_document_sha256: receipt.query.archive_document_sha256,
        restore_trace_id: receipt.restore_trace_id,
        target_bound: receipt.query.expected_target !== undefined,
        outcome: receipt.outcome,
        receipt_get_query: selection,
      });
    previous = id;
  }
  const has_more = rows.length > query.limit;
  const last = items.at(-1);
  check();
  return {
    kind: 'application-restore-receipt-catalog' as const,
    catalog_completed: true,
    items,
    limit: query.limit,
    after_request_id: query.after_request_id ?? null,
    has_more,
    next_query: has_more && last ? { ...query, after_request_id: last.restore_request_id } : null,
    checked_receipts: rows.length,
    selected_receipt_bytes,
    catalog_coverage: 'selected-page-and-lookahead' as const,
    order: 'request-id-binary-ascending' as const,
    consistency: 'keyset-current-state' as const,
    receipt_scope: 'historical-local-transaction' as const,
    current_state: 'not-read' as const,
    absence_proves_rollback: false,
    local_write_state: 'not-performed' as const,
  };
}
