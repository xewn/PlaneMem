import { isDeepStrictEqual } from 'node:util';
import {
  CONFLICT_SYNC_TYPES,
  parseConflictSyncChange,
  syncJsonSnapshot,
  type ConflictDetectedSyncChange,
  type ConflictSyncChange,
  type SyncCommandIdentity,
  type SyncUploadScope,
} from '@planemem/contracts';
import {
  INBOX_APPLICATION_STATE_BYTES,
  type SyncInboxApplicationHandlers,
} from './application-model.js';
import { InboxApplicationRejection } from './application-rejection.js';

export const CONFLICT_APPLICATION = Object.freeze({ name: 'conflict-lifecycle', version: '1' });
const MAX_CONFLICTS = 512;
const classifications = ['public', 'internal', 'confidential', 'restricted'] as const;
// Fixed v1 policy. Other applications own these event types.
const ignoredTypes = Object.freeze([
  'ClientEventRecorded',
  'ContextPackIssued',
  'ApprovalRequested',
  'ApprovalCompleted',
  'ContextItemCreated',
  'ContextItemUpdated',
  'ContextItemConfirmed',
  'ContextItemArchived',
  'ContextItemRestored',
  'work_item.updated',
  'context.proposed',
  'handoff.offered',
] as const);
interface Conflict {
  conflict_id: string;
  status: 'open' | 'resolved';
  detected: ConflictDetectedSyncChange;
  latest: ConflictSyncChange;
}
export interface ConflictLifecycleProjection {
  schema_version: 1;
  kind: 'conflict-lifecycle-history';
  scope: SyncUploadScope;
  conflicts: Conflict[];
}
function reject(reason: ConstructorParameters<typeof InboxApplicationRejection>[0]) {
  return new InboxApplicationRejection(reason, 'conflict');
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
function transitionAllowed(before: ConflictSyncChange, after: ConflictSyncChange) {
  return (
    before.event_type === 'ConflictDetected' &&
    after.event_type === 'ConflictResolved' &&
    after.aggregate_version === 2 &&
    classifications.indexOf(after.sensitivity) >= classifications.indexOf(before.sensitivity) &&
    (
      [
        'conflict_id',
        'entity_type',
        'entity_id',
        'field',
        'base_version',
        'local_version',
        'server_version',
      ] as const
    ).every((field) => before.payload[field] === after.payload[field]) &&
    isDeepStrictEqual(after.source_refs.slice(1), before.source_refs)
  );
}
function projectionFor(value: unknown, scope: SyncUploadScope): ConflictLifecycleProjection | null {
  if (value === null) return null;
  try {
    const projection = record(JSON.parse(syncJsonSnapshot(value, INBOX_APPLICATION_STATE_BYTES)), [
      'schema_version',
      'kind',
      'scope',
      'conflicts',
    ]);
    if (
      projection.schema_version !== 1 ||
      projection.kind !== 'conflict-lifecycle-history' ||
      !isDeepStrictEqual(projection.scope, scope) ||
      !Array.isArray(projection.conflicts) ||
      projection.conflicts.length === 0 ||
      projection.conflicts.length > MAX_CONFLICTS
    )
      throw new TypeError();
    let previous: string | undefined;
    const events = new Set<string>();
    const cursors = new Set<number>();
    for (const raw of projection.conflicts) {
      const item = record(raw, ['conflict_id', 'status', 'detected', 'latest']);
      const detected = parseConflictSyncChange(item.detected, scope);
      const latest = parseConflictSyncChange(item.latest, scope);
      if (
        detected.event_type !== 'ConflictDetected' ||
        item.conflict_id !== detected.payload.conflict_id ||
        item.conflict_id !== latest.payload.conflict_id ||
        item.status !== (latest.event_type === 'ConflictDetected' ? 'open' : 'resolved') ||
        (previous !== undefined && previous >= detected.payload.conflict_id) ||
        (latest.event_type === 'ConflictDetected'
          ? !isDeepStrictEqual(detected, latest)
          : !transitionAllowed(detected, latest) ||
            latest.server_cursor <= detected.server_cursor ||
            latest.event_id === detected.event_id)
      )
        throw new TypeError();
      for (const event of latest.event_type === 'ConflictDetected'
        ? [detected]
        : [detected, latest]) {
        if (events.has(event.event_id) || cursors.has(event.server_cursor)) throw new TypeError();
        events.add(event.event_id);
        cursors.add(event.server_cursor);
      }
      previous = detected.payload.conflict_id;
    }
    return projection as unknown as ConflictLifecycleProjection;
  } catch {
    throw reject('PROJECTION_INVALID');
  }
}
export function conflictApplicationAdapter(identity: SyncCommandIdentity) {
  const scope: SyncUploadScope = {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  };
  const handlers: SyncInboxApplicationHandlers = Object.create(
    null,
  ) as SyncInboxApplicationHandlers;
  for (const type of CONFLICT_SYNC_TYPES) {
    handlers[type] = (input, change) => {
      const projection = projectionFor(input, scope);
      let event: ConflictSyncChange;
      try {
        event = parseConflictSyncChange(change, scope);
        if (event.event_type !== type) throw new TypeError();
      } catch {
        throw reject('EVENT_INVALID');
      }
      const conflicts = projection?.conflicts ?? [];
      const existing = conflicts.find((item) => item.conflict_id === event.payload.conflict_id);
      if (!existing) {
        if (event.event_type !== 'ConflictDetected') throw reject('BASELINE_REQUIRED');
        if (conflicts.length >= MAX_CONFLICTS) throw reject('LIMIT_REACHED');
        conflicts.push({
          conflict_id: event.payload.conflict_id,
          status: 'open',
          detected: event,
          latest: event,
        });
        conflicts.sort((a, b) =>
          a.conflict_id < b.conflict_id ? -1 : a.conflict_id > b.conflict_id ? 1 : 0,
        );
      } else {
        const before = existing.latest;
        if (
          before.aggregate_version >= Number.MAX_SAFE_INTEGER ||
          event.aggregate_version !== before.aggregate_version + 1 ||
          event.server_cursor <= before.server_cursor
        )
          throw reject('VERSION_GAP');
        if (!transitionAllowed(before, event)) throw reject('TRANSITION_INVALID');
        existing.latest = event;
        existing.status = 'resolved';
      }
      return { schema_version: 1, kind: 'conflict-lifecycle-history', scope, conflicts };
    };
  }
  for (const type of ignoredTypes) handlers[type] = (projection) => projection;
  return {
    handlers,
    validateProjection: (projection: unknown, appliedCursor: number) => {
      const saved = projectionFor(projection, scope);
      if (saved?.conflicts.some((item) => item.latest.server_cursor > appliedCursor))
        throw reject('PROJECTION_INVALID');
    },
    descriptor: {
      application: { ...CONFLICT_APPLICATION },
      projection_kind: 'conflict-lifecycle-history' as const,
      handled_event_types: [...CONFLICT_SYNC_TYPES],
      ignored_event_types: [...ignoredTypes],
      unknown_event_types: 'reject-page' as const,
      max_conflicts: MAX_CONFLICTS,
      conflict_values: 'recorded-resolved-value-only' as const,
      source_application: 'not-verified' as const,
      current_resolution_authority: 'not-verified' as const,
      original_request_binding: 'not-included' as const,
    },
  };
}
