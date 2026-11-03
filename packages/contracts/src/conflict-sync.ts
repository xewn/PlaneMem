import { assertUlid, isUlid } from './ids.js';
import { assertUtcTimestamp, validateSourceRef, type Classification } from './metadata.js';
import { isSyncIdentifier } from './sync.js';
import { SYNC_CHANGES_RESPONSE_BYTES, type SyncChange } from './sync-changes.js';
import { syncJsonSnapshot, type SyncUploadScope } from './sync-upload-receipt.js';

export const CONFLICT_SYNC_TYPES = Object.freeze(['ConflictDetected', 'ConflictResolved'] as const);
type Subject = {
  conflict_id: string;
  entity_type: string;
  entity_id: string;
  field: string;
  base_version: number;
  local_version: number;
  server_version: number;
  actor_id: string;
};
interface Envelope extends SyncChange {
  schema_version: 1;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  aggregate_type: 'Conflict';
  aggregate_id: string;
  aggregate_version: number;
  client_id: string;
  occurred_at: string;
  sensitivity: Classification;
}
export interface ConflictDetectedSyncChange extends Envelope {
  event_type: 'ConflictDetected';
  aggregate_version: 1;
  payload: Subject & { client_event_id: string };
}
export interface ConflictResolvedSyncChange extends Envelope {
  event_type: 'ConflictResolved';
  payload: Subject & { resolution: 'local' | 'server' | 'merge'; resolved_value: unknown };
}
export type ConflictSyncChange = ConflictDetectedSyncChange | ConflictResolvedSyncChange;

// Fixed current upload field policy, independent of future Gateway additions.
const fields: Record<string, readonly string[]> = {
  work_item: ['title', 'status', 'priority', 'owner', 'progress', 'description', 'due_at'],
  context_item: ['title', 'status', 'priority', 'content', 'layer', 'expires_at'],
  session: ['status', 'parent_session_id'],
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}
function version(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function binding(value: unknown, type: string, id: string) {
  const ref = object(value);
  if (Object.keys(ref).length !== 2 || ref.type !== type || ref.id !== id)
    throw new TypeError('Conflict source binding differs');
}
/** Historical stream data only; never a source mutation or original decision-key receipt. */
export function parseConflictSyncChange(
  value: unknown,
  scope: SyncUploadScope,
): ConflictSyncChange {
  const event = object(JSON.parse(syncJsonSnapshot(value, SYNC_CHANGES_RESPONSE_BYTES)));
  const envelopeFields = [
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
    Object.keys(event).some((key) => !envelopeFields.includes(key)) ||
    !CONFLICT_SYNC_TYPES.includes(event.event_type as ConflictSyncChange['event_type']) ||
    event.schema_version !== 1 ||
    event.aggregate_type !== 'Conflict' ||
    event.accepted !== true ||
    !version(event.server_cursor, 1) ||
    !version(event.aggregate_version, 1) ||
    !isSyncIdentifier(event.client_id)
  )
    throw new TypeError('Invalid conflict sync envelope');
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const) {
    assertUlid(event[key]);
    if (event[key] !== scope[key]) throw new TypeError('Conflict sync scope differs');
  }
  assertUlid(event.event_id);
  assertUlid(event.aggregate_id);
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
    throw new TypeError('Invalid conflict metadata');
  const payload = object(event.payload);
  const detected = event.event_type === 'ConflictDetected';
  const payloadFields = [
    'conflict_id',
    'entity_type',
    'entity_id',
    'field',
    'base_version',
    'local_version',
    'server_version',
    'actor_id',
    ...(detected ? ['client_event_id'] : ['resolution', 'resolved_value']),
  ];
  if (
    Object.keys(payload).length !== payloadFields.length ||
    Object.keys(payload).some((key) => !payloadFields.includes(key)) ||
    !['conflict_id', 'entity_type', 'entity_id', 'field', 'actor_id'].every((key) =>
      isSyncIdentifier(payload[key]),
    ) ||
    payload.conflict_id === '.' ||
    payload.conflict_id === '..' ||
    !version(payload.base_version) ||
    !version(payload.local_version) ||
    !version(payload.server_version) ||
    event.actor_id !== (isUlid(payload.actor_id) ? payload.actor_id : undefined) ||
    event.aggregate_id !== (isUlid(payload.conflict_id) ? payload.conflict_id : event.event_id)
  )
    throw new TypeError('Invalid conflict subject or actor binding');
  if (!Array.isArray(event.source_refs)) throw new TypeError('Conflict sources are required');
  event.source_refs.forEach(validateSourceRef);
  if (detected) {
    if (
      !isUlid(payload.conflict_id) ||
      event.aggregate_version !== 1 ||
      !isSyncIdentifier(payload.client_event_id) ||
      payload.base_version < 1 ||
      payload.base_version >= Number.MAX_SAFE_INTEGER ||
      payload.local_version !== payload.base_version + 1 ||
      payload.server_version <= payload.base_version ||
      typeof payload.entity_type !== 'string' ||
      !Object.hasOwn(fields, payload.entity_type) ||
      !fields[payload.entity_type]?.includes(payload.field as string) ||
      event.source_refs.length < 2
    )
      throw new TypeError('Invalid detected conflict');
    binding(event.source_refs.at(-2), 'client-event', payload.client_event_id);
    binding(event.source_refs.at(-1), payload.entity_type, payload.entity_id as string);
  } else {
    if (
      event.aggregate_version < 2 ||
      !['local', 'server', 'merge'].includes(payload.resolution as string) ||
      !Object.hasOwn(payload, 'resolved_value') ||
      event.source_refs.length < 1
    )
      throw new TypeError('Invalid resolved conflict');
    binding(event.source_refs[0], 'conflict', payload.conflict_id as string);
  }
  return event as unknown as ConflictSyncChange;
}
