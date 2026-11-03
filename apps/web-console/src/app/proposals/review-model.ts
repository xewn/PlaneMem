import {
  buildEtag,
  isUlid,
  proposalReceiptJson,
  proposalText,
  syncJsonSnapshot,
  validateIdempotencyKey,
  type ProposalMutationReceipt,
} from '@planemem/contracts';
import { parseProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';

export const REVIEW_ORIGINAL_BYTES = 32 * 1024;
export const REVIEW_RECEIPT_BYTES = 64 * 1024;
export interface ProposalReviewOriginal {
  schema_version: 1;
  kind: 'proposal-review-submission';
  binding: ProposalSubmissionBinding;
  request_key: string;
  proposal_id: string;
  expected_revision: number;
  decision: 'confirm' | 'reject';
  reason: string;
}
export interface ProposalReviewReceipt {
  schema_version: 1;
  trace_id: string;
  data: ProposalMutationReceipt;
  source_refs: Array<{ type: 'proposal'; id: string; revision: number }>;
  revision: number;
  etag: string;
  server_cursor: number;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError('Use the complete original review');
  return row;
}
export function parseReviewOriginal(value: unknown): ProposalReviewOriginal {
  const row = object(JSON.parse(syncJsonSnapshot(value, REVIEW_ORIGINAL_BYTES)), [
    'schema_version',
    'kind',
    'binding',
    'request_key',
    'proposal_id',
    'expected_revision',
    'decision',
    'reason',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-review-submission' ||
    !isUlid(row.proposal_id) ||
    typeof row.decision !== 'string' ||
    !['confirm', 'reject'].includes(row.decision) ||
    typeof row.expected_revision !== 'number' ||
    !Number.isSafeInteger(row.expected_revision) ||
    row.expected_revision < 1 ||
    !Number.isSafeInteger(row.expected_revision + 1)
  )
    throw new TypeError();
  const binding = parseProposalSubmissionBinding(row.binding);
  if (proposalReceiptJson(binding) !== proposalReceiptJson(row.binding)) throw new TypeError();
  const key = validateIdempotencyKey(row.request_key);
  if (!/^[\x21-\x7e]{1,255}$/.test(key) || row.reason !== proposalText(row.reason, 'reason', 2000))
    throw new TypeError('Keep the original normalized reason and key');
  if (new TextEncoder().encode(JSON.stringify(row, null, 2)).byteLength > REVIEW_ORIGINAL_BYTES)
    throw new TypeError();
  return row as unknown as ProposalReviewOriginal;
}
export function encodeReviewOriginal(value: unknown) {
  return proposalReceiptJson(parseReviewOriginal(value), REVIEW_ORIGINAL_BYTES);
}
export function decodeReviewOriginal(raw: unknown) {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > REVIEW_ORIGINAL_BYTES ||
    new TextEncoder().encode(raw).byteLength > REVIEW_ORIGINAL_BYTES
  )
    throw new TypeError();
  return parseReviewOriginal(JSON.parse(raw.replace(/^\uFEFF/, '')));
}
export function parseReviewReceipt(
  value: unknown,
  request: ProposalReviewOriginal,
  trace: string,
): ProposalReviewReceipt {
  const original = parseReviewOriginal(request);
  const row = object(JSON.parse(syncJsonSnapshot(value, REVIEW_RECEIPT_BYTES)), [
    'schema_version',
    'trace_id',
    'data',
    'source_refs',
    'revision',
    'etag',
    'server_cursor',
  ]);
  const revision = original.expected_revision + 1;
  const data = object(row.data, [
    'proposal_id',
    'status',
    'revision',
    'event_id',
    'occurred_at',
    'replayed',
  ]);
  if (
    row.schema_version !== 1 ||
    typeof trace !== 'string' ||
    !/^[\x21-\x7e]{1,255}$/.test(trace) ||
    row.trace_id !== trace ||
    row.revision !== revision ||
    row.etag !== buildEtag(revision) ||
    typeof row.server_cursor !== 'number' ||
    !Number.isSafeInteger(row.server_cursor) ||
    row.server_cursor < 1 ||
    data.proposal_id !== original.proposal_id ||
    data.revision !== revision ||
    data.status !== (original.decision === 'confirm' ? 'verified' : 'rejected') ||
    !isUlid(data.event_id) ||
    typeof data.replayed !== 'boolean' ||
    typeof data.occurred_at !== 'string' ||
    !Number.isFinite(Date.parse(data.occurred_at)) ||
    new Date(data.occurred_at).toISOString() !== data.occurred_at ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== 1
  )
    throw new TypeError();
  const source = object(row.source_refs[0], ['type', 'id', 'revision']);
  if (
    source.type !== 'proposal' ||
    source.id !== original.proposal_id ||
    source.revision !== revision
  )
    throw new TypeError();
  return row as unknown as ProposalReviewReceipt;
}
