import { parseCreateContextItem } from './context-items.js';
import type { ContextScope } from './context.js';
import type { Classification, SourceRef } from './metadata.js';
import { isUlid } from './ids.js';

export const proposalKinds = ['decision', 'risk', 'next_step', 'blocker', 'brief'] as const;
export type ProposalKind = (typeof proposalKinds)[number];
export type ProposalStatus = 'proposed' | 'verified' | 'rejected';
export interface ProposalOrigin {
  proposal_id: string;
  revision: number;
}
export interface CreateProposalRequest {
  kind: ProposalKind;
  title: string;
  content: string;
  source_refs: SourceRef[];
  model_version: string;
  prompt_version: string;
  classification?: Classification;
  ttl_seconds?: number;
  /** Records derivation without modifying or inheriting the original review decision. */
  derived_from?: ProposalOrigin;
}
export type NormalizedCreateProposalRequest = Required<
  Omit<CreateProposalRequest, 'derived_from'>
> &
  Pick<CreateProposalRequest, 'derived_from'>;
export interface ProposalSummary {
  proposal_id: string;
  kind: ProposalKind;
  title: string;
  status: ProposalStatus;
  revision: number;
  classification: Classification;
  created_at: string;
  expires_at: string;
}
export interface ProposalDocument extends ProposalSummary, ContextScope {
  schema_version: 1;
  content: string;
  source_refs: SourceRef[];
  provenance: {
    model_version: string;
    prompt_version: string;
    warnings: string[];
    derived_from?: ProposalOrigin;
  };
  created_by: string;
  created_by_client: string;
  trace_id: string;
  reviewed_by: string | null;
  reviewed_by_client: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
}
export interface ProposalPage {
  proposals: ProposalSummary[];
  next_before?: string;
  review_allowed: boolean;
  /** Capability hints; submission still passes the gateway policy. */
  create_allowed?: boolean;
  restricted_read?: boolean;
}
export interface ProposalDetail {
  proposal: ProposalDocument;
  sources_current: boolean;
  review_allowed: boolean;
}
export interface ProposalMutationReceipt {
  proposal_id: string;
  status: ProposalStatus;
  revision: number;
  event_id: string;
  occurred_at: string;
  replayed: boolean;
}
export interface ProposalListQuery {
  status?: ProposalStatus;
  kind?: ProposalKind;
  before?: string;
  limit?: number;
  /** Direct children of this original proposal; does not include all descendants. */
  derived_from?: string;
}
export function parseProposalListQuery(raw: unknown): ProposalListQuery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TypeError('Expected proposal filters');
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !['status', 'kind', 'before', 'limit', 'derived_from'].includes(key),
    )
  )
    throw new TypeError('Unknown proposal filter');
  const parsed: ProposalListQuery = {};
  if (value.status !== undefined) {
    if (
      typeof value.status !== 'string' ||
      !['proposed', 'verified', 'rejected'].includes(value.status)
    )
      throw new TypeError('Invalid proposal status');
    parsed.status = value.status as ProposalStatus;
  }
  if (value.kind !== undefined) {
    if (!proposalKinds.includes(value.kind as ProposalKind))
      throw new TypeError('Invalid proposal kind');
    parsed.kind = value.kind as ProposalKind;
  }
  for (const field of ['before', 'derived_from'] as const) {
    const identifier = value[field];
    if (identifier === undefined) continue;
    if (!isUlid(identifier)) throw new TypeError(field + ' must be a proposal ULID');
    parsed[field] = identifier;
  }
  if (value.limit !== undefined) {
    if (
      typeof value.limit !== 'number' ||
      !Number.isSafeInteger(value.limit) ||
      value.limit < 1 ||
      value.limit > 100
    )
      throw new TypeError('limit must be an integer between 1 and 100');
    parsed.limit = value.limit;
  }
  return parsed;
}
export interface ProposalReviewOptions {
  expected_revision: number;
  idempotency_key: string;
}

export function parseCreateProposal(raw: unknown): NormalizedCreateProposalRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TypeError('Expected a proposal object');
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'kind',
          'title',
          'content',
          'source_refs',
          'model_version',
          'prompt_version',
          'classification',
          'ttl_seconds',
          'derived_from',
        ].includes(key),
    )
  )
    throw new TypeError('Unknown proposal field');
  if (!proposalKinds.includes(value.kind as ProposalKind))
    throw new TypeError('Invalid proposal kind');
  const item = parseCreateContextItem({
    title: value.title,
    content: value.content,
    source_refs: value.source_refs,
    ...(value.classification === undefined ? {} : { classification: value.classification }),
  });
  for (const ref of item.source_refs)
    if (ref.type === 'context-item' && (ref.revision === undefined || ref.revision < 1))
      throw new TypeError('Context item sources require a positive pinned revision');
  const ttl = value.ttl_seconds === undefined ? 604800 : value.ttl_seconds;
  if (typeof ttl !== 'number' || !Number.isSafeInteger(ttl) || ttl < 60 || ttl > 2592000)
    throw new TypeError('ttl_seconds must be between 60 and 2592000');
  return {
    kind: value.kind as ProposalKind,
    title: item.title,
    content: item.content,
    source_refs: item.source_refs,
    model_version: proposalText(value.model_version, 'model_version', 200),
    prompt_version: proposalText(value.prompt_version, 'prompt_version', 200),
    classification: item.classification,
    ttl_seconds: ttl,
    ...(value.derived_from === undefined
      ? {}
      : { derived_from: parseProposalOrigin(value.derived_from) }),
  };
}
export function parseProposalOrigin(raw: unknown): ProposalOrigin {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TypeError('derived_from must identify an original proposal and revision');
  const origin = raw as Record<string, unknown>;
  if (
    Object.keys(origin).some((key) => !['proposal_id', 'revision'].includes(key)) ||
    !isUlid(origin.proposal_id) ||
    typeof origin.revision !== 'number' ||
    !Number.isSafeInteger(origin.revision) ||
    origin.revision < 1
  )
    throw new TypeError('derived_from requires a proposal ULID and positive integer revision');
  return { proposal_id: origin.proposal_id, revision: origin.revision };
}
export function proposalText(value: unknown, name: string, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000\p{Cs}]/u.test(value)
  )
    throw new TypeError(name + ' must be non-empty text of at most ' + max + ' characters');
  return value.trim();
}
export function proposalWarnings(content: string): string[] {
  return /ignore\s+(?:all\s+)?policy|execute\s+(?:shell|command)|system\s+prompt/i.test(content)
    ? ['prompt_injection_suspected']
    : [];
}
