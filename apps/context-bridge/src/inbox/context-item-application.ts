import { isDeepStrictEqual } from 'node:util';
import {
  CONTEXT_ITEM_SYNC_TYPES,
  parseContextItemSyncChange,
  syncJsonSnapshot,
  type ContextItemSyncChange,
  type SyncCommandIdentity,
  type SyncUploadScope,
} from '@planemem/contracts';
import {
  INBOX_APPLICATION_STATE_BYTES,
  applicationFailure,
  parseInboxApplicationApplyQuery,
  type SyncInboxApplication,
  type SyncInboxApplicationHandlers,
} from './application-model.js';
import { InboxApplicationRejection } from './application-rejection.js';

export const CONTEXT_ITEM_APPLICATION = Object.freeze({
  name: 'context-item-lifecycle',
  version: '1',
});
const MAX_ITEMS = 512;
// Fixed v1 policy. These events do not change a context item's lifecycle metadata.
const ignoredTypes = Object.freeze([
  'ClientEventRecorded',
  'ConflictDetected',
  'ConflictResolved',
  'ContextPackIssued',
  'ApprovalRequested',
  'ApprovalCompleted',
  'work_item.updated',
  'context.proposed',
  'handoff.offered',
] as const);
interface Item {
  item_id: string;
  created: ContextItemSyncChange;
  latest: ContextItemSyncChange;
}
export interface ContextItemLifecycleProjection {
  schema_version: 1;
  kind: 'context-item-lifecycle-metadata';
  scope: SyncUploadScope;
  items: Item[];
}
function scopeFor(identity: SyncCommandIdentity): SyncUploadScope {
  return {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  };
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
function transitionAllowed(before: ContextItemSyncChange, after: ContextItemSyncChange) {
  return (
    after.event_type !== 'ContextItemCreated' &&
    after.sensitivity === before.sensitivity &&
    (after.event_type === 'ContextItemRestored'
      ? before.payload.archived
      : !before.payload.archived) &&
    (after.event_type !== 'ContextItemConfirmed' || before.payload.status === 'proposed')
  );
}
function projectionFor(
  value: unknown,
  scope: SyncUploadScope,
): ContextItemLifecycleProjection | null {
  if (value === null) return null;
  try {
    const projection = record(JSON.parse(syncJsonSnapshot(value, INBOX_APPLICATION_STATE_BYTES)), [
      'schema_version',
      'kind',
      'scope',
      'items',
    ]);
    if (
      projection.schema_version !== 1 ||
      projection.kind !== 'context-item-lifecycle-metadata' ||
      !isDeepStrictEqual(projection.scope, scope) ||
      !Array.isArray(projection.items) ||
      projection.items.length === 0 ||
      projection.items.length > MAX_ITEMS
    )
      throw new TypeError();
    let previous: string | undefined;
    const events = new Set<string>();
    const cursors = new Set<number>();
    for (const raw of projection.items) {
      const item = record(raw, ['item_id', 'created', 'latest']);
      const created = parseContextItemSyncChange(item.created, scope);
      const latest = parseContextItemSyncChange(item.latest, scope);
      if (
        created.event_type !== 'ContextItemCreated' ||
        item.item_id !== created.payload.item_id ||
        item.item_id !== latest.payload.item_id ||
        latest.sensitivity !== created.sensitivity ||
        (latest.payload.version === 2 && !transitionAllowed(created, latest)) ||
        (previous !== undefined && previous >= created.payload.item_id) ||
        (latest.payload.version === 1
          ? !isDeepStrictEqual(created, latest)
          : latest.server_cursor <= created.server_cursor || latest.event_id === created.event_id)
      )
        throw new TypeError();
      for (const event of latest.payload.version === 1 ? [created] : [created, latest]) {
        if (events.has(event.event_id) || cursors.has(event.server_cursor)) throw new TypeError();
        events.add(event.event_id);
        cursors.add(event.server_cursor);
      }
      previous = created.payload.item_id;
    }
    return projection as unknown as ContextItemLifecycleProjection;
  } catch {
    throw new InboxApplicationRejection('PROJECTION_INVALID');
  }
}
export function contextItemApplicationAdapter(identity: SyncCommandIdentity) {
  const scope = scopeFor(identity);
  const handlers: SyncInboxApplicationHandlers = Object.create(
    null,
  ) as SyncInboxApplicationHandlers;
  for (const type of CONTEXT_ITEM_SYNC_TYPES) {
    handlers[type] = (input, change) => {
      const projection = projectionFor(input, scope);
      let event: ContextItemSyncChange;
      try {
        event = parseContextItemSyncChange(change, scope);
        if (event.event_type !== type) throw new TypeError();
      } catch {
        throw new InboxApplicationRejection('EVENT_INVALID');
      }
      const items = projection?.items ?? [];
      const index = items.findIndex((item) => item.item_id === event.payload.item_id);
      const existing = index < 0 ? undefined : items[index];
      if (!existing) {
        if (type !== 'ContextItemCreated') throw new InboxApplicationRejection('BASELINE_REQUIRED');
        if (items.length >= MAX_ITEMS) throw new InboxApplicationRejection('LIMIT_REACHED');
        items.push({ item_id: event.payload.item_id, created: event, latest: event });
        items.sort((a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));
      } else {
        const before = existing.latest;
        if (
          before.payload.version === Number.MAX_SAFE_INTEGER ||
          event.payload.version !== before.payload.version + 1 ||
          event.server_cursor <= before.server_cursor
        )
          throw new InboxApplicationRejection('VERSION_GAP');
        if (!transitionAllowed(before, event))
          throw new InboxApplicationRejection('TRANSITION_INVALID');
        existing.latest = event;
      }
      return { schema_version: 1, kind: 'context-item-lifecycle-metadata', scope, items };
    };
  }
  for (const type of ignoredTypes) handlers[type] = (projection) => projection;
  return {
    handlers,
    validateProjection: (projection: unknown, appliedCursor: number) => {
      const saved = projectionFor(projection, scope);
      if (saved?.items.some((item) => item.latest.server_cursor > appliedCursor))
        throw new InboxApplicationRejection('PROJECTION_INVALID');
    },
    descriptor: {
      application: { ...CONTEXT_ITEM_APPLICATION },
      projection_kind: 'context-item-lifecycle-metadata' as const,
      handled_event_types: [...CONTEXT_ITEM_SYNC_TYPES],
      ignored_event_types: [...ignoredTypes],
      unknown_event_types: 'reject-page' as const,
      max_items: MAX_ITEMS,
      item_content: 'not-included' as const,
    },
  };
}
export function requireBuiltInApplication(application: SyncInboxApplication, trace: string) {
  if (
    application.name !== CONTEXT_ITEM_APPLICATION.name ||
    application.version !== CONTEXT_ITEM_APPLICATION.version
  )
    throw applicationFailure(
      'INBOX_APPLICATION_ADAPTER_UNSUPPORTED',
      'Select the built-in context-item-lifecycle application at version 1',
      trace,
    );
}
/** Parse and select before opening storage; no module paths or executable input. */
export function parseInboxBuiltInApplicationApplyQuery(input: unknown, trace: string) {
  const query = parseInboxApplicationApplyQuery(input, trace);
  requireBuiltInApplication(query.application, trace);
  return query;
}
