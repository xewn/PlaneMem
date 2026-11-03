import {
  parseProposalReviewReceiptEnvelope,
  proposalReceiptJson,
  syncJsonSnapshot,
  type ProposalReviewReceiptEnvelope,
} from '@planemem/contracts';
import {
  parseReviewOriginal,
  parseReviewReceipt,
  reviewReceiptQuery,
  type ProposalReviewOriginal,
  type ProposalReviewReceipt,
} from './review-model';

export const REVIEW_HISTORY_BYTES = 128 * 1024;
export const REVIEW_HISTORY_FILE_BYTES = REVIEW_HISTORY_BYTES + 1024;
export type ReviewObservation = {
  schema_version: 1;
  kind: 'proposal-review-observation';
  original: ProposalReviewOriginal;
  observed_at: string;
} & (
  | { source: 'submission'; receipt: ProposalReviewReceipt }
  | { source: 'receipt-query'; receipt: ProposalReviewReceiptEnvelope }
);
export interface ReviewHistoryFile {
  document: ReviewObservation;
  document_sha256: string;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  )
    throw new TypeError();
  return row;
}
/** Validates internal consistency, not file authenticity or the proposal's current state. */
export function parseReviewObservation(value: unknown): ReviewObservation {
  const row = object(JSON.parse(syncJsonSnapshot(value, REVIEW_HISTORY_BYTES)), [
    'schema_version',
    'kind',
    'original',
    'observed_at',
    'source',
    'receipt',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-review-observation' ||
    typeof row.observed_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.observed_at) ||
    !Number.isFinite(Date.parse(row.observed_at)) ||
    new Date(row.observed_at).toISOString() !== row.observed_at
  )
    throw new TypeError();
  const original = parseReviewOriginal(row.original);
  const trace = (row.receipt as Record<string, unknown> | null)?.trace_id;
  if (typeof trace !== 'string') throw new TypeError();
  const base = {
    schema_version: 1 as const,
    kind: 'proposal-review-observation' as const,
    original,
    observed_at: row.observed_at,
  };
  let result: ReviewObservation;
  if (row.source === 'submission')
    result = {
      ...base,
      source: 'submission',
      receipt: parseReviewReceipt(row.receipt, original, trace),
    };
  else if (row.source === 'receipt-query')
    result = {
      ...base,
      source: 'receipt-query',
      receipt: parseProposalReviewReceiptEnvelope(row.receipt, reviewReceiptQuery(original), trace),
    };
  else throw new TypeError();
  // A validator must not silently discard or normalize fields from the archived response.
  if (
    proposalReceiptJson(result, REVIEW_HISTORY_BYTES) !==
    proposalReceiptJson(row, REVIEW_HISTORY_BYTES)
  )
    throw new TypeError();
  return result;
}
export function reviewObservationJson(value: unknown) {
  return proposalReceiptJson(parseReviewObservation(value), REVIEW_HISTORY_BYTES);
}
export function parseReviewHistoryFile(value: unknown): ReviewHistoryFile {
  const row = object(JSON.parse(syncJsonSnapshot(value, REVIEW_HISTORY_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
    throw new TypeError();
  return { document: parseReviewObservation(row.document), document_sha256: row.document_sha256 };
}
export function reviewHistoryFileJson(value: unknown) {
  return proposalReceiptJson(parseReviewHistoryFile(value), REVIEW_HISTORY_FILE_BYTES);
}
export function reviewObservationStatus(document: ReviewObservation) {
  if (document.source === 'submission') return document.receipt.data.status;
  return document.receipt.data.status === 'recorded'
    ? document.receipt.data.receipt.status
    : 'not-observed';
}
