import { isUlid } from './ids.js';
import { validateIdempotencyKey } from './metadata.js';
import { proposalText } from './proposals.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import { parseProposalCommandIdentity, proposalReceiptJson } from './proposal-create-receipt.js';
import type { LegacyContextIdentity } from './legacy-context-lifecycle.js';

export const PROPOSAL_REVIEW_RECEIPT_REQUEST_BYTES = 32 * 1024;
export const PROPOSAL_REVIEW_RECEIPT_RESPONSE_BYTES = 64 * 1024;
export interface ProposalReviewReceiptQuery {
  identity: LegacyContextIdentity;
  request_key: string;
  proposal_id: string;
  decision: 'confirm' | 'reject';
  expected_revision: number;
  reason: string;
}
export interface ProposalReviewRecordedReceipt {
  proposal_id: string;
  status: 'verified' | 'rejected';
  revision: number;
  event_id: string;
  occurred_at: string;
  server_cursor: number;
  current_state: 'not-checked';
}
export interface ProposalReviewReceiptEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: Array<{ type: 'proposal'; id: string; revision: number }>;
  data: ProposalReviewReceiptQuery &
    ({ status: 'not-observed' } | { status: 'recorded'; receipt: ProposalReviewRecordedReceipt });
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError('Supply the complete original review receipt');
  return row;
}
export function parseProposalReviewReceiptQuery(value: unknown): ProposalReviewReceiptQuery {
  const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_REVIEW_RECEIPT_REQUEST_BYTES)), [
    'identity',
    'request_key',
    'proposal_id',
    'decision',
    'expected_revision',
    'reason',
  ]);
  const identity = parseProposalCommandIdentity(row.identity);
  const request_key = validateIdempotencyKey(row.request_key);
  if (
    proposalReceiptJson(identity) !== proposalReceiptJson(row.identity) ||
    !/^[\x21-\x7e]{1,255}$/.test(request_key) ||
    !isUlid(row.proposal_id) ||
    (row.decision !== 'confirm' && row.decision !== 'reject') ||
    typeof row.expected_revision !== 'number' ||
    !Number.isSafeInteger(row.expected_revision) ||
    row.expected_revision < 1 ||
    !Number.isSafeInteger(row.expected_revision + 1) ||
    row.reason !== proposalText(row.reason, 'reason', 2000)
  )
    throw new TypeError('Keep the complete normalized original review');
  return {
    identity,
    request_key,
    proposal_id: row.proposal_id,
    decision: row.decision,
    expected_revision: row.expected_revision,
    reason: row.reason as string,
  };
}
export function parseProposalReviewReceiptEnvelope(
  value: unknown,
  expected: ProposalReviewReceiptQuery,
  trace: string,
): ProposalReviewReceiptEnvelope {
  const original = parseProposalReviewReceiptQuery(expected);
  const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_REVIEW_RECEIPT_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'data',
  ]);
  if (
    row.schema_version !== 1 ||
    typeof trace !== 'string' ||
    !/^[\x21-\x7e]{1,255}$/.test(trace) ||
    row.trace_id !== trace ||
    !Array.isArray(row.source_refs)
  )
    throw new TypeError('Invalid original review envelope');
  const status = (row.data as Record<string, unknown> | null)?.status;
  const data = object(row.data, [
    'identity',
    'request_key',
    'proposal_id',
    'decision',
    'expected_revision',
    'reason',
    'status',
    ...(status === 'recorded' ? ['receipt'] : []),
  ]);
  const returned = parseProposalReviewReceiptQuery({
    identity: data.identity,
    request_key: data.request_key,
    proposal_id: data.proposal_id,
    decision: data.decision,
    expected_revision: data.expected_revision,
    reason: data.reason,
  });
  if (proposalReceiptJson(original) !== proposalReceiptJson(returned))
    throw new TypeError('Receipt query differs from original');
  if (data.status === 'not-observed') {
    if (row.source_refs.length) throw new TypeError('Unobserved query has sources');
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: { ...returned, status: 'not-observed' },
    };
  }
  if (data.status !== 'recorded') throw new TypeError('Invalid receipt state');
  const saved = object(data.receipt, [
    'proposal_id',
    'status',
    'revision',
    'event_id',
    'occurred_at',
    'server_cursor',
    'current_state',
  ]);
  const revision = original.expected_revision + 1;
  const outcome = original.decision === 'confirm' ? 'verified' : 'rejected';
  if (
    saved.proposal_id !== original.proposal_id ||
    saved.status !== outcome ||
    saved.revision !== revision ||
    !isUlid(saved.event_id) ||
    typeof saved.server_cursor !== 'number' ||
    !Number.isSafeInteger(saved.server_cursor) ||
    saved.server_cursor < 1 ||
    typeof saved.occurred_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(saved.occurred_at) ||
    !Number.isFinite(Date.parse(saved.occurred_at)) ||
    new Date(saved.occurred_at).toISOString() !== saved.occurred_at ||
    saved.current_state !== 'not-checked' ||
    row.source_refs.length !== 1
  )
    throw new TypeError('Invalid original review receipt');
  const source = object(row.source_refs[0], ['type', 'id', 'revision']);
  if (
    source.type !== 'proposal' ||
    source.id !== original.proposal_id ||
    source.revision !== revision
  )
    throw new TypeError('Receipt source differs');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [{ type: 'proposal', id: original.proposal_id, revision }],
    data: {
      ...returned,
      status: 'recorded',
      receipt: {
        proposal_id: original.proposal_id,
        status: outcome,
        revision,
        event_id: saved.event_id,
        occurred_at: saved.occurred_at,
        server_cursor: saved.server_cursor,
        current_state: 'not-checked',
      },
    },
  };
}
