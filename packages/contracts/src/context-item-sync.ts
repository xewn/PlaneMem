import { assertUlid, isUlid } from './ids.js';
import { assertUtcTimestamp, validateSourceRef, type Classification } from './metadata.js';
import { isSyncIdentifier } from './sync.js';
import { SYNC_CHANGES_RESPONSE_BYTES, type SyncChange } from './sync-changes.js';
import { syncJsonSnapshot, type SyncUploadScope } from './sync-upload-receipt.js';

export const CONTEXT_ITEM_SYNC_TYPES = Object.freeze([
  'ContextItemCreated',
  'ContextItemUpdated',
  'ContextItemConfirmed',
  'ContextItemArchived',
  'ContextItemRestored',
] as const);
export type ContextItemSyncType = (typeof CONTEXT_ITEM_SYNC_TYPES)[number];
/** Historical lifecycle metadata only. The stream does not contain the item body. */
export interface ContextItemSyncChange extends SyncChange {
  event_type: ContextItemSyncType;
  schema_version: 1;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  aggregate_type: 'ContextItem';
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: string;
  sensitivity: Classification;
  payload: {
    item_id: string;
    version: number;
    status: 'proposed' | 'confirmed' | 'excluded';
    archived: boolean;
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
/** Matches the Gateway context-items producer, including its legacy aggregate-ID fallback. */
export function parseContextItemSyncChange(
  value: unknown,
  scope: SyncUploadScope,
): ContextItemSyncChange {
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
    !CONTEXT_ITEM_SYNC_TYPES.includes(event.event_type as ContextItemSyncType) ||
    event.schema_version !== 1 ||
    event.aggregate_type !== 'ContextItem' ||
    event.accepted !== true ||
    !positive(event.server_cursor) ||
    !positive(event.aggregate_version)
  )
    throw new TypeError('Invalid context item sync envelope');
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const) {
    assertUlid(event[key]);
    if (event[key] !== scope[key]) throw new TypeError('Context item sync scope differs');
  }
  assertUlid(event.event_id);
  assertUlid(event.aggregate_id);
  for (const key of ['actor_id', 'session_id', 'correlation_id', 'causation_id'])
    if (Object.hasOwn(event, key)) assertUlid(event[key]);
  if (Object.hasOwn(event, 'client_id') && !isSyncIdentifier(event.client_id))
    throw new TypeError('Invalid context item client');
  assertUtcTimestamp(event.occurred_at);
  if (
    typeof event.trace_id !== 'string' ||
    !event.trace_id.trim() ||
    event.trace_id.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(event.trace_id) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(event.sensitivity as string)
  )
    throw new TypeError('Invalid context item metadata');
  const payload = object(event.payload);
  if (
    Object.keys(payload).length !== 4 ||
    Object.keys(payload).some(
      (key) => !['item_id', 'version', 'status', 'archived'].includes(key),
    ) ||
    !isSyncIdentifier(payload.item_id) ||
    payload.item_id === '.' ||
    payload.item_id === '..' ||
    !positive(payload.version) ||
    payload.version !== event.aggregate_version ||
    !['proposed', 'confirmed', 'excluded'].includes(payload.status as string) ||
    typeof payload.archived !== 'boolean' ||
    event.aggregate_id !== (isUlid(payload.item_id) ? payload.item_id : event.event_id)
  )
    throw new TypeError('Invalid context item lifecycle payload');
  if (!Array.isArray(event.source_refs) || event.source_refs.length !== 1)
    throw new TypeError('Context item source binding is required');
  const ref = validateSourceRef(event.source_refs[0]);
  if (ref.type !== 'context-item' || ref.id !== payload.item_id || ref.revision !== payload.version)
    throw new TypeError('Context item source binding differs');
  const type = event.event_type as ContextItemSyncType;
  if (
    payload.archived !== (type === 'ContextItemArchived') ||
    (type === 'ContextItemCreated' &&
      (payload.version !== 1 || payload.status !== 'proposed' || !isUlid(payload.item_id))) ||
    (type !== 'ContextItemCreated' && payload.version < 2) ||
    (type === 'ContextItemConfirmed' && payload.status !== 'confirmed') ||
    (['ContextItemArchived', 'ContextItemRestored'].includes(type) &&
      payload.status !== 'excluded') ||
    (type === 'ContextItemUpdated' && !['proposed', 'excluded'].includes(payload.status as string))
  )
    throw new TypeError('Context item event contradicts its lifecycle state');
  return event as unknown as ContextItemSyncChange;
}
