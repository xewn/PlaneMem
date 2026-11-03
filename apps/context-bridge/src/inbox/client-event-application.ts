import { isDeepStrictEqual } from 'node:util';
import {
  CLIENT_EVENT_SYNC_TYPES,
  parseClientEventSyncChange,
  syncJsonSnapshot,
  type ClientEventSyncChange,
  type SyncCommandIdentity,
  type SyncUploadScope,
} from '@planemem/contracts';
import {
  INBOX_APPLICATION_STATE_BYTES,
  type SyncInboxApplicationHandlers,
} from './application-model.js';
import { InboxApplicationRejection } from './application-rejection.js';

export const CLIENT_EVENT_APPLICATION = Object.freeze({
  name: 'client-event-history',
  version: '1',
});
const MAX_EVENTS = 512;
// Fixed v1 policy. Rejected conflicts and other domains are retained in original pages, not this view.
const ignoredTypes = Object.freeze([
  'ConflictDetected',
  'ConflictResolved',
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
interface RecordedClientEvent {
  actor_id: string;
  client_id: string;
  client_event_id: string;
  event: ClientEventSyncChange;
}
export interface ClientEventHistoryProjection {
  schema_version: 1;
  kind: 'recorded-client-event-history';
  scope: SyncUploadScope;
  entries: RecordedClientEvent[];
}
function reject(reason: ConstructorParameters<typeof InboxApplicationRejection>[0]) {
  return new InboxApplicationRejection(reason, 'client-event');
}
function record(input: unknown, fields: string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
  const row = input as Record<string, unknown>;
  if (
    Object.keys(row).length !== fields.length ||
    Object.keys(row).some((key) => !fields.includes(key))
  )
    throw new TypeError();
  return row;
}
function origin(event: ClientEventSyncChange) {
  return {
    actor_id: event.payload.actor_id,
    client_id: event.client_id,
    client_event_id: event.payload.client_event_id,
  };
}
function compare(left: ReturnType<typeof origin>, right: ReturnType<typeof origin>) {
  for (const key of ['actor_id', 'client_id', 'client_event_id'] as const) {
    const order = Buffer.compare(Buffer.from(left[key]), Buffer.from(right[key]));
    if (order !== 0) return order;
  }
  return 0;
}
function projectionFor(
  value: unknown,
  scope: SyncUploadScope,
): ClientEventHistoryProjection | null {
  if (value === null) return null;
  try {
    const projection = record(JSON.parse(syncJsonSnapshot(value, INBOX_APPLICATION_STATE_BYTES)), [
      'schema_version',
      'kind',
      'scope',
      'entries',
    ]);
    if (
      projection.schema_version !== 1 ||
      projection.kind !== 'recorded-client-event-history' ||
      !isDeepStrictEqual(projection.scope, scope) ||
      !Array.isArray(projection.entries) ||
      projection.entries.length < 1 ||
      projection.entries.length > MAX_EVENTS
    )
      throw new TypeError();
    let previous: ReturnType<typeof origin> | undefined;
    const ids = new Set<string>();
    const cursors = new Set<number>();
    for (const raw of projection.entries) {
      const entry = record(raw, ['actor_id', 'client_id', 'client_event_id', 'event']);
      const event = parseClientEventSyncChange(entry.event, scope);
      const key = origin(event);
      if (
        entry.actor_id !== key.actor_id ||
        entry.client_id !== key.client_id ||
        entry.client_event_id !== key.client_event_id ||
        (previous !== undefined && compare(previous, key) >= 0) ||
        ids.has(event.event_id) ||
        cursors.has(event.server_cursor)
      )
        throw new TypeError();
      previous = key;
      ids.add(event.event_id);
      cursors.add(event.server_cursor);
    }
    return projection as unknown as ClientEventHistoryProjection;
  } catch {
    throw reject('PROJECTION_INVALID');
  }
}
export function clientEventApplicationAdapter(identity: SyncCommandIdentity) {
  const scope: SyncUploadScope = {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  };
  const handlers: SyncInboxApplicationHandlers = Object.create(
    null,
  ) as SyncInboxApplicationHandlers;
  handlers.ClientEventRecorded = (input, change) => {
    const projection = projectionFor(input, scope);
    let event: ClientEventSyncChange;
    try {
      event = parseClientEventSyncChange(change, scope);
    } catch {
      throw reject('EVENT_INVALID');
    }
    const entries = projection?.entries ?? [];
    const key = origin(event);
    if (
      entries.some((entry) => compare(entry, key) === 0 || entry.event.event_id === event.event_id)
    )
      throw reject('TRANSITION_INVALID');
    if (entries.some((entry) => entry.event.server_cursor >= event.server_cursor))
      throw reject('VERSION_GAP');
    if (entries.length >= MAX_EVENTS) throw reject('LIMIT_REACHED');
    entries.push({ ...key, event });
    entries.sort(compare);
    return { schema_version: 1, kind: 'recorded-client-event-history', scope, entries };
  };
  for (const type of ignoredTypes) handlers[type] = (projection) => projection;
  return {
    handlers,
    validateProjection: (projection: unknown, appliedCursor: number) => {
      const saved = projectionFor(projection, scope);
      if (saved?.entries.some((entry) => entry.event.server_cursor > appliedCursor))
        throw reject('PROJECTION_INVALID');
    },
    descriptor: {
      application: { ...CLIENT_EVENT_APPLICATION },
      projection_kind: 'recorded-client-event-history' as const,
      handled_event_types: [...CLIENT_EVENT_SYNC_TYPES],
      ignored_event_types: [...ignoredTypes],
      unknown_event_types: 'reject-page' as const,
      max_events: MAX_EVENTS,
      recorded_content: 'complete' as const,
      source_application: 'not-verified' as const,
      current_source_state: 'not-verified' as const,
      source_authenticity: 'not-proven' as const,
      original_upload_command: 'not-reconstructed' as const,
      upload_receipt_binding: 'not-included' as const,
      producer_identity: 'recorded-event-actor-and-client' as const,
    },
  };
}
