import { isUlid, validateIdempotencyKey } from '@planemem/contracts';
import {
  creationObservationStatus,
  creationRecordedReceipt,
  type CreationObservation,
} from './creation-history-model';

// Creation observations can contain two copies of a large draft; retain the existing read bound.
export const CREATION_HISTORY_SCAN_LIMIT = 5;
export interface CreationHistoryQuery {
  proposal_id: string | null;
  request_key: string | null;
  status: 'recorded' | 'not-observed' | null;
  source: CreationObservation['source'] | null;
  after: string | null;
}

/** A continuation retains exact filters and the last scanned digest, even without matches. */
export function parseCreationHistoryQuery(value: unknown): CreationHistoryQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  const fields = ['proposal_id', 'request_key', 'status', 'source', 'after'];
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  )
    throw new TypeError();
  if (row.proposal_id !== null && !isUlid(row.proposal_id)) throw new TypeError();
  const request_key = row.request_key === null ? null : validateIdempotencyKey(row.request_key);
  if (row.status !== null && row.status !== 'recorded' && row.status !== 'not-observed')
    throw new TypeError();
  if (row.source !== null && row.source !== 'submission' && row.source !== 'receipt-query')
    throw new TypeError();
  if (row.after !== null && (typeof row.after !== 'string' || !/^[a-f0-9]{64}$/.test(row.after)))
    throw new TypeError();
  return {
    proposal_id: row.proposal_id,
    request_key,
    status: row.status,
    source: row.source,
    after: row.after,
  };
}

export function matchesCreationHistory(document: CreationObservation, query: CreationHistoryQuery) {
  return (
    (query.proposal_id === null ||
      creationRecordedReceipt(document)?.proposal_id === query.proposal_id) &&
    (query.request_key === null || document.original.request_key === query.request_key) &&
    (query.status === null || creationObservationStatus(document) === query.status) &&
    (query.source === null || document.source === query.source)
  );
}
