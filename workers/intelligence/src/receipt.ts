import { isUlid, type ProposalMutationReceipt } from '@planemem/contracts';

/** Keep only the historical create receipt, never proposal content from a response. */
export function parseSubmissionReceipt(input: unknown): ProposalMutationReceipt {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Expected a proposal submission receipt');
  const value = input as Record<string, unknown>;
  if (
    !isUlid(value.proposal_id) ||
    !isUlid(value.event_id) ||
    value.status !== 'proposed' ||
    value.revision !== 1 ||
    typeof value.replayed !== 'boolean' ||
    typeof value.occurred_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.occurred_at) ||
    !Number.isFinite(Date.parse(value.occurred_at)) ||
    new Date(value.occurred_at).toISOString() !== value.occurred_at
  )
    throw new TypeError('Invalid proposal submission receipt');
  return {
    proposal_id: value.proposal_id,
    status: 'proposed',
    revision: 1,
    event_id: value.event_id,
    occurred_at: value.occurred_at,
    replayed: value.replayed,
  };
}
