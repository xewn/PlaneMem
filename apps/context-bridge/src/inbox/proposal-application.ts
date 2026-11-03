import { isDeepStrictEqual } from 'node:util';
import {
  PROPOSAL_SYNC_TYPES,
  parseProposalSyncChange,
  syncJsonSnapshot,
  type ProposalSyncChange,
  type SyncCommandIdentity,
  type SyncUploadScope,
} from '@planemem/contracts';
import {
  INBOX_APPLICATION_STATE_BYTES,
  type SyncInboxApplicationHandlers,
} from './application-model.js';
import { InboxApplicationRejection } from './application-rejection.js';

export const PROPOSAL_APPLICATION = Object.freeze({ name: 'proposal-lifecycle', version: '1' });
const MAX_PROPOSALS = 512;
// Fixed v1 policy: these events do not change Proposal lifecycle metadata.
const ignoredTypes = Object.freeze([
  'ClientEventRecorded',
  'ConflictDetected',
  'ConflictResolved',
  'ContextPackIssued',
  'ContextItemCreated',
  'ContextItemUpdated',
  'ContextItemConfirmed',
  'ContextItemArchived',
  'ContextItemRestored',
  'work_item.updated',
  'context.proposed',
  'handoff.offered',
] as const);
interface Proposal {
  proposal_id: string;
  requested: ProposalSyncChange;
  latest: ProposalSyncChange;
}
export interface ProposalLifecycleProjection {
  schema_version: 1;
  kind: 'proposal-lifecycle-metadata';
  scope: SyncUploadScope;
  proposals: Proposal[];
}
function reject(reason: ConstructorParameters<typeof InboxApplicationRejection>[0]) {
  return new InboxApplicationRejection(reason, 'proposal');
}
function record(input: unknown, fields: string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new TypeError();
  return value;
}
function transitionAllowed(before: ProposalSyncChange, after: ProposalSyncChange) {
  return (
    before.event_type === 'ApprovalRequested' &&
    after.event_type === 'ApprovalCompleted' &&
    before.payload.kind === after.payload.kind &&
    before.sensitivity === after.sensitivity
  );
}
function projectionFor(value: unknown, scope: SyncUploadScope): ProposalLifecycleProjection | null {
  if (value === null) return null;
  try {
    const projection = record(JSON.parse(syncJsonSnapshot(value, INBOX_APPLICATION_STATE_BYTES)), [
      'schema_version',
      'kind',
      'scope',
      'proposals',
    ]);
    if (
      projection.schema_version !== 1 ||
      projection.kind !== 'proposal-lifecycle-metadata' ||
      !isDeepStrictEqual(projection.scope, scope) ||
      !Array.isArray(projection.proposals) ||
      projection.proposals.length === 0 ||
      projection.proposals.length > MAX_PROPOSALS
    )
      throw new TypeError();
    let previous: string | undefined;
    const events = new Set<string>();
    const cursors = new Set<number>();
    for (const raw of projection.proposals) {
      const item = record(raw, ['proposal_id', 'requested', 'latest']);
      const requested = parseProposalSyncChange(item.requested, scope);
      const latest = parseProposalSyncChange(item.latest, scope);
      if (
        requested.event_type !== 'ApprovalRequested' ||
        item.proposal_id !== requested.payload.proposal_id ||
        item.proposal_id !== latest.payload.proposal_id ||
        (previous !== undefined && previous >= requested.payload.proposal_id) ||
        (latest.payload.revision === 1
          ? !isDeepStrictEqual(requested, latest)
          : !transitionAllowed(requested, latest) ||
            latest.server_cursor <= requested.server_cursor ||
            latest.event_id === requested.event_id)
      )
        throw new TypeError();
      for (const event of latest.payload.revision === 1 ? [requested] : [requested, latest]) {
        if (events.has(event.event_id) || cursors.has(event.server_cursor)) throw new TypeError();
        events.add(event.event_id);
        cursors.add(event.server_cursor);
      }
      previous = requested.payload.proposal_id;
    }
    return projection as unknown as ProposalLifecycleProjection;
  } catch {
    throw reject('PROJECTION_INVALID');
  }
}

export function proposalApplicationAdapter(identity: SyncCommandIdentity) {
  const scope: SyncUploadScope = {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  };
  const handlers: SyncInboxApplicationHandlers = Object.create(
    null,
  ) as SyncInboxApplicationHandlers;
  for (const type of PROPOSAL_SYNC_TYPES) {
    handlers[type] = (input, change) => {
      const projection = projectionFor(input, scope);
      let event: ProposalSyncChange;
      try {
        event = parseProposalSyncChange(change, scope);
        if (event.event_type !== type) throw new TypeError();
      } catch {
        throw reject('EVENT_INVALID');
      }
      const proposals = projection?.proposals ?? [];
      const existing = proposals.find((item) => item.proposal_id === event.payload.proposal_id);
      if (!existing) {
        if (type !== 'ApprovalRequested') throw reject('BASELINE_REQUIRED');
        if (proposals.length >= MAX_PROPOSALS) throw reject('LIMIT_REACHED');
        proposals.push({ proposal_id: event.payload.proposal_id, requested: event, latest: event });
        proposals.sort((a, b) =>
          a.proposal_id < b.proposal_id ? -1 : a.proposal_id > b.proposal_id ? 1 : 0,
        );
      } else {
        const before = existing.latest;
        if (
          event.payload.revision !== before.payload.revision + 1 ||
          event.server_cursor <= before.server_cursor
        )
          throw reject('VERSION_GAP');
        if (!transitionAllowed(before, event)) throw reject('TRANSITION_INVALID');
        existing.latest = event;
      }
      return { schema_version: 1, kind: 'proposal-lifecycle-metadata', scope, proposals };
    };
  }
  for (const type of ignoredTypes) handlers[type] = (projection) => projection;
  return {
    handlers,
    validateProjection: (projection: unknown, appliedCursor: number) => {
      const saved = projectionFor(projection, scope);
      if (saved?.proposals.some((item) => item.latest.server_cursor > appliedCursor))
        throw reject('PROJECTION_INVALID');
    },
    descriptor: {
      application: { ...PROPOSAL_APPLICATION },
      projection_kind: 'proposal-lifecycle-metadata' as const,
      handled_event_types: [...PROPOSAL_SYNC_TYPES],
      ignored_event_types: [...ignoredTypes],
      unknown_event_types: 'reject-page' as const,
      max_proposals: MAX_PROPOSALS,
      proposal_content: 'not-included' as const,
      source_validity: 'not-verified' as const,
      current_review_authority: 'not-verified' as const,
    },
  };
}
