import { assertUlid, isUlid } from './ids.js';
import { assertUtcTimestamp, validateSourceRef, type Classification } from './metadata.js';
import { isSyncIdentifier, parseSyncUploadEvent } from './sync.js';
import { SYNC_CHANGES_RESPONSE_BYTES, type SyncChange } from './sync-changes.js';
import { syncJsonSnapshot, type SyncUploadScope } from './sync-upload-receipt.js';

export const CLIENT_EVENT_SYNC_TYPES = Object.freeze(['ClientEventRecorded'] as const);
export interface ClientEventSyncChange extends SyncChange {
  schema_version: 1;
  event_type: 'ClientEventRecorded';
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  aggregate_type: 'ClientEvent';
  aggregate_id: string;
  aggregate_version: 1;
  client_id: string;
  occurred_at: string;
  sensitivity: Classification;
  payload: {
    event_type: string;
    content: Record<string, unknown>;
    client_event_id: string;
    actor_id: string;
    observed_version?: number;
  };
}
// Fixed v1 producer policy; accepting a recorded proposal does not apply its value to a source entity.
const fields: Record<string, readonly string[]> = {
  work_item: ['title', 'status', 'priority', 'owner', 'progress', 'description', 'due_at'],
  context_item: ['title', 'status', 'priority', 'content', 'layer', 'expires_at'],
  session: ['status', 'parent_session_id'],
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}
function version(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function binding(value: unknown, type: string, id: string) {
  const ref = object(value);
  if (Object.keys(ref).length !== 2 || ref.type !== type || ref.id !== id)
    throw new TypeError('Client event source binding differs');
}
/** Complete recorded content, not an original upload command, delivery settlement or source mutation. */
export function parseClientEventSyncChange(
  value: unknown,
  scope: SyncUploadScope,
): ClientEventSyncChange {
  const event = object(JSON.parse(syncJsonSnapshot(value, SYNC_CHANGES_RESPONSE_BYTES)));
  const envelopeFields = [
    'schema_version',
    'event_id',
    'event_type',
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
    Object.keys(event).some((key) => !envelopeFields.includes(key)) ||
    event.schema_version !== 1 ||
    event.event_type !== 'ClientEventRecorded' ||
    event.aggregate_type !== 'ClientEvent' ||
    event.aggregate_id !== event.event_id ||
    event.aggregate_version !== 1 ||
    event.accepted !== true ||
    !version(event.server_cursor) ||
    !isSyncIdentifier(event.client_id)
  )
    throw new TypeError('Invalid recorded client event envelope');
  assertUlid(event.event_id);
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const) {
    assertUlid(event[key]);
    if (event[key] !== scope[key]) throw new TypeError('Client event scope differs');
  }
  for (const key of ['actor_id', 'session_id', 'correlation_id', 'causation_id'])
    if (Object.hasOwn(event, key)) assertUlid(event[key]);
  assertUtcTimestamp(event.occurred_at);
  if (
    typeof event.trace_id !== 'string' ||
    !event.trace_id.trim() ||
    event.trace_id.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(event.trace_id) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(event.sensitivity as string)
  )
    throw new TypeError('Invalid recorded client event metadata');
  const payload = object(event.payload);
  const fieldChange = payload.event_type === 'FieldChangeProposed';
  const payloadFields = [
    'event_type',
    'content',
    'client_event_id',
    'actor_id',
    ...(fieldChange ? ['observed_version'] : []),
  ];
  if (
    Object.keys(payload).length !== payloadFields.length ||
    Object.keys(payload).some((key) => !payloadFields.includes(key)) ||
    !isSyncIdentifier(payload.event_type) ||
    !isSyncIdentifier(payload.client_event_id) ||
    !isSyncIdentifier(payload.actor_id) ||
    event.actor_id !== (isUlid(payload.actor_id) ? payload.actor_id : undefined)
  )
    throw new TypeError('Invalid original client event identity');
  const content = object(payload.content);
  if (!Array.isArray(event.source_refs)) throw new TypeError('Client event sources are required');
  event.source_refs.forEach(validateSourceRef);
  const appended = fieldChange ? 2 : 1;
  if (event.source_refs.length < appended) throw new TypeError('Missing client event sources');
  binding(event.source_refs.at(-appended), 'client-event', payload.client_event_id);
  if (fieldChange) {
    if (
      typeof content.entity_type !== 'string' ||
      !Object.hasOwn(fields, content.entity_type) ||
      !isSyncIdentifier(content.entity_id) ||
      typeof content.field !== 'string' ||
      !fields[content.entity_type]?.includes(content.field) ||
      !Object.hasOwn(content, 'value') ||
      !version(content.base_version) ||
      content.base_version >= Number.MAX_SAFE_INTEGER ||
      !version(payload.observed_version) ||
      payload.observed_version < content.base_version
    )
      throw new TypeError('Invalid recorded field proposal');
    binding(event.source_refs.at(-1), content.entity_type, content.entity_id);
  }
  // Validate content/source JSON using the producer's upload rules, without claiming the omitted
  // original client_cursor, request key or pre-escalation sensitivity can be recovered from the stream.
  if (
    !parseSyncUploadEvent({
      event_id: payload.client_event_id,
      event_type: payload.event_type,
      payload: content,
      source_refs: event.source_refs.slice(0, -appended),
      sensitivity: event.sensitivity,
    })
  )
    throw new TypeError('Invalid recorded client content');
  return event as unknown as ClientEventSyncChange;
}
