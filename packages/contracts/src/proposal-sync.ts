import { assertUlid } from './ids.js';
import { assertUtcTimestamp, validateSourceRef, type Classification } from './metadata.js';
import type { ProposalKind, ProposalStatus } from './proposals.js';
import { isSyncIdentifier } from './sync.js';
import { SYNC_CHANGES_RESPONSE_BYTES, type SyncChange } from './sync-changes.js';
import { syncJsonSnapshot, type SyncUploadScope } from './sync-upload-receipt.js';

export const PROPOSAL_SYNC_TYPES = Object.freeze([
  'ApprovalRequested',
  'ApprovalCompleted',
] as const);
export type ProposalSyncType = (typeof PROPOSAL_SYNC_TYPES)[number];
// Freeze the v1 consumption policy independently of future proposal creation capabilities.
const kinds = Object.freeze(['decision', 'risk', 'next_step', 'blocker', 'brief'] as const);
/** Historical metadata produced by Gateway proposals; no content, expiry or review authority. */
export interface ProposalSyncChange extends SyncChange {
  event_type: ProposalSyncType;
  schema_version: 1;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  aggregate_type: 'Proposal';
  aggregate_id: string;
  aggregate_version: 1 | 2;
  occurred_at: string;
  sensitivity: Classification;
  payload: {
    proposal_id: string;
    status: ProposalStatus;
    revision: 1 | 2;
    kind: ProposalKind;
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}

/** Validate the existing Proposal producer without accepting other approval aggregate types. */
export function parseProposalSyncChange(
  value: unknown,
  scope: SyncUploadScope,
): ProposalSyncChange {
  const event = object(JSON.parse(syncJsonSnapshot(value, SYNC_CHANGES_RESPONSE_BYTES)));
  const fields = [
    'event_id',
    'event_type',
    'schema_version',
    'tenant_id',
    'workspace_id',
    'project_id',
    'aggregate_type',
    'aggregate_id',
    'aggregate_version',
    'actor_id',
    'client_id',
    'session_id',
    'correlation_id',
    'causation_id',
    'occurred_at',
    'trace_id',
    'source_refs',
    'sensitivity',
    'payload',
    'accepted',
    'server_cursor',
  ];
  if (
    Object.keys(event).some((key) => !fields.includes(key)) ||
    !PROPOSAL_SYNC_TYPES.includes(event.event_type as ProposalSyncType) ||
    event.schema_version !== 1 ||
    event.aggregate_type !== 'Proposal' ||
    event.accepted !== true ||
    typeof event.server_cursor !== 'number' ||
    !Number.isSafeInteger(event.server_cursor) ||
    event.server_cursor < 1
  )
    throw new TypeError('Invalid proposal sync envelope');
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const) {
    assertUlid(event[key]);
    if (event[key] !== scope[key]) throw new TypeError('Proposal sync scope differs');
  }
  assertUlid(event.event_id);
  assertUlid(event.aggregate_id);
  for (const key of ['actor_id', 'session_id', 'correlation_id', 'causation_id'])
    if (Object.hasOwn(event, key)) assertUlid(event[key]);
  if (Object.hasOwn(event, 'client_id') && !isSyncIdentifier(event.client_id))
    throw new TypeError('Invalid proposal client');
  assertUtcTimestamp(event.occurred_at);
  if (
    typeof event.trace_id !== 'string' ||
    !event.trace_id.trim() ||
    event.trace_id.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(event.trace_id) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(event.sensitivity as string)
  )
    throw new TypeError('Invalid proposal metadata');
  const payload = object(event.payload);
  if (
    Object.keys(payload).length !== 4 ||
    Object.keys(payload).some(
      (key) => !['proposal_id', 'status', 'revision', 'kind'].includes(key),
    ) ||
    !kinds.includes(payload.kind as ProposalKind) ||
    payload.proposal_id !== event.aggregate_id ||
    payload.revision !== event.aggregate_version ||
    (event.event_type === 'ApprovalRequested'
      ? payload.revision !== 1 || payload.status !== 'proposed'
      : payload.revision !== 2 || !['verified', 'rejected'].includes(payload.status as string))
  )
    throw new TypeError('Invalid proposal lifecycle payload');
  if (!Array.isArray(event.source_refs) || event.source_refs.length !== 1)
    throw new TypeError('Proposal source binding is required');
  const ref = validateSourceRef(event.source_refs[0]);
  if (
    ref.type !== 'proposal' ||
    ref.id !== payload.proposal_id ||
    ref.revision !== payload.revision
  )
    throw new TypeError('Proposal source binding differs');
  return event as unknown as ProposalSyncChange;
}
