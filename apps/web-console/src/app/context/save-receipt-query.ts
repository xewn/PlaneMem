import {
  isSyncIdentifier,
  syncJsonSnapshot,
  validateIdempotencyKey,
  type ContextPackSaveReceiptDocument,
} from '@planemem/contracts';
import {
  matchesHistoryDateRange,
  parseHistoryDateRange,
  type HistoryDateRange,
} from '../proposals/history-date-range';

export const PACK_RECEIPT_HISTORY_PAGE_SIZE = 20;
export const PACK_RECEIPT_HISTORY_SCAN_LIMIT = 100;
export interface PackReceiptHistoryQuery extends HistoryDateRange {
  request_key: string | null;
  status: 'recorded' | 'not-observed' | null;
  after: string | null;
}

/** A continuation retains the exact filters and last scanned slot; storage checks its binding. */
export function parsePackReceiptHistoryQuery(input: unknown): PackReceiptHistoryQuery {
  const value: unknown = JSON.parse(syncJsonSnapshot(input, 24 * 1024));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  const fields = ['request_key', 'status', 'observed_from', 'observed_through', 'after'];
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  const request_key = row.request_key === null ? null : validateIdempotencyKey(row.request_key);
  if (request_key !== null && (!isSyncIdentifier(request_key) || /\u007f/.test(request_key)))
    throw new TypeError();
  if (row.status !== null && row.status !== 'recorded' && row.status !== 'not-observed')
    throw new TypeError();
  if (
    row.after !== null &&
    (typeof row.after !== 'string' || new TextEncoder().encode(row.after).byteLength > 16384)
  )
    throw new TypeError();
  return {
    request_key,
    status: row.status,
    ...parseHistoryDateRange(row.observed_from, row.observed_through),
    after: row.after,
  };
}

/** Only use after complete document validation; filtering never replaces the digest check. */
export function matchesPackReceiptHistory(
  document: ContextPackSaveReceiptDocument,
  query: PackReceiptHistoryQuery,
) {
  return (
    (query.request_key === null || document.original.request_key === query.request_key) &&
    (query.status === null || document.receipt.data.status === query.status) &&
    matchesHistoryDateRange(document.observed_at, query)
  );
}
