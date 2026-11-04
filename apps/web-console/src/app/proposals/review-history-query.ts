import { isUlid, validateIdempotencyKey } from '@planemem/contracts';
import {
  matchesHistoryDateRange,
  parseHistoryDateRange,
  type HistoryDateRange,
} from './history-date-range';
import { reviewObservationStatus, type ReviewObservation } from './review-history-model';

export const REVIEW_HISTORY_PAGE_SIZE = 20;
export const REVIEW_HISTORY_SCAN_LIMIT = 100;
export interface ReviewHistoryQuery extends HistoryDateRange {
  proposal_id: string | null;
  request_key: string | null;
  status: 'verified' | 'rejected' | 'not-observed' | null;
  source: ReviewObservation['source'] | null;
  after: string | null;
}

/** A continuation carries the exact filters and last scanned digest, including empty pages. */
export function parseReviewHistoryQuery(value: unknown): ReviewHistoryQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  const fields = [
    'proposal_id',
    'request_key',
    'status',
    'source',
    'observed_from',
    'observed_through',
    'after',
  ];
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  )
    throw new TypeError();
  if (row.proposal_id !== null && !isUlid(row.proposal_id)) throw new TypeError();
  const request_key = row.request_key === null ? null : validateIdempotencyKey(row.request_key);
  if (
    row.status !== null &&
    row.status !== 'verified' &&
    row.status !== 'rejected' &&
    row.status !== 'not-observed'
  )
    throw new TypeError();
  if (row.source !== null && row.source !== 'submission' && row.source !== 'receipt-query')
    throw new TypeError();
  if (row.after !== null && (typeof row.after !== 'string' || !/^[a-f0-9]{64}$/.test(row.after)))
    throw new TypeError();
  return {
    ...parseHistoryDateRange(row.observed_from, row.observed_through),
    proposal_id: row.proposal_id,
    request_key,
    status: row.status,
    source: row.source,
    after: row.after,
  };
}

export function matchesReviewHistory(document: ReviewObservation, query: ReviewHistoryQuery) {
  return (
    (query.proposal_id === null || document.original.proposal_id === query.proposal_id) &&
    (query.request_key === null || document.original.request_key === query.request_key) &&
    (query.status === null || reviewObservationStatus(document) === query.status) &&
    (query.source === null || document.source === query.source) &&
    matchesHistoryDateRange(document.observed_at, query)
  );
}
