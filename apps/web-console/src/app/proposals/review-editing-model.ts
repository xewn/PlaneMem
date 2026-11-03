import {
  isUlid,
  proposalReceiptJson,
  syncJsonSnapshot,
  validateIdempotencyKey,
} from '@planemem/contracts';
import { parseProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';

export const REVIEW_EDITING_BYTES = 32 * 1024;
export interface ReviewEditingDraft {
  schema_version: 1;
  kind: 'proposal-review-editing-draft';
  binding: ProposalSubmissionBinding;
  request_key: string;
  saved_at: string;
  proposal_id: string;
  expected_revision: number;
  decision: '' | 'confirm' | 'reject';
  reason: string;
}
/** Editing copies preserve raw incomplete input; they are never review commands. */
export function parseReviewEditingDraft(value: unknown): ReviewEditingDraft {
  const row = JSON.parse(syncJsonSnapshot(value, REVIEW_EDITING_BYTES)) as Record<string, unknown>;
  const fields = [
    'schema_version',
    'kind',
    'binding',
    'request_key',
    'saved_at',
    'proposal_id',
    'expected_revision',
    'decision',
    'reason',
  ];
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field)) ||
    row.schema_version !== 1 ||
    row.kind !== 'proposal-review-editing-draft' ||
    !isUlid(row.proposal_id) ||
    typeof row.expected_revision !== 'number' ||
    !Number.isSafeInteger(row.expected_revision) ||
    row.expected_revision < 1 ||
    !Number.isSafeInteger(row.expected_revision + 1) ||
    !['', 'confirm', 'reject'].includes(row.decision as string) ||
    typeof row.reason !== 'string' ||
    row.reason.length > 2000 ||
    /[\u0000\p{Cs}]/u.test(row.reason) ||
    typeof row.saved_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.saved_at) ||
    !Number.isFinite(Date.parse(row.saved_at)) ||
    new Date(row.saved_at).toISOString() !== row.saved_at
  )
    throw new TypeError();
  const binding = parseProposalSubmissionBinding(row.binding);
  if (proposalReceiptJson(binding) !== proposalReceiptJson(row.binding)) throw new TypeError();
  const key = validateIdempotencyKey(row.request_key);
  if (
    !/^[\x21-\x7e]{1,255}$/.test(key) ||
    new TextEncoder().encode(JSON.stringify(row, null, 2)).byteLength > REVIEW_EDITING_BYTES
  )
    throw new TypeError();
  return row as unknown as ReviewEditingDraft;
}
export function encodeReviewEditingDraft(value: unknown) {
  return proposalReceiptJson(parseReviewEditingDraft(value), REVIEW_EDITING_BYTES);
}
export function decodeReviewEditingDraft(raw: unknown) {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > REVIEW_EDITING_BYTES ||
    new TextEncoder().encode(raw).byteLength > REVIEW_EDITING_BYTES
  )
    throw new TypeError();
  return parseReviewEditingDraft(JSON.parse(raw.replace(/^\uFEFF/, '')));
}
