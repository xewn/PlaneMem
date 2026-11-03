import {
  isSyncIdentifier,
  MAX_SYNC_BATCH_BYTES,
  parseSyncUploadEvent,
  type AcceptedUpload,
  type RejectedUpload,
  type SyncUploadEvent,
  type SyncUploadResult,
} from './sync.js';

export const SYNC_UPLOAD_RESPONSE_BYTES = 256 * 1024;
export interface SyncUploadScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}
export interface SyncUploadEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: { type: 'sync-stream'; id: string }[];
  server_cursor: number;
  data: SyncUploadScope & SyncUploadResult;
}

function row(value: unknown, fields?: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (fields && Object.keys(value).some((key) => !fields.includes(key)))
  )
    throw new TypeError('Invalid sync fields');
  return value as Record<string, unknown>;
}
function cursor(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0))
    throw new TypeError('Invalid sync cursor');
  return value;
}
function identifier(value: unknown): string {
  if (!isSyncIdentifier(value)) throw new TypeError('Invalid sync identifier');
  return value;
}
function trace(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid sync trace');
  return value;
}

/** Detached finite JSON; rejects silent omission/coercion, accessors, cycles and excessive depth. */
export function syncJsonSnapshot(value: unknown, maximum: number): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  const copy = (item: unknown, depth: number): unknown => {
    if (++nodes > 100_000 || depth > 64) throw new TypeError('Sync JSON is too complex');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object' || ancestors.has(item))
      throw new TypeError('Use finite sync JSON');
    const array = Array.isArray(item);
    const prototype: unknown = Object.getPrototypeOf(item);
    if (
      array ? prototype !== Array.prototype : prototype !== null && prototype !== Object.prototype
    )
      throw new TypeError();
    const keys = Object.keys(item);
    if (
      Reflect.ownKeys(item).length !== keys.length + (array ? 1 : 0) ||
      keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(item, key)!, 'value'))
    )
      throw new TypeError('Use ordinary sync JSON fields');
    ancestors.add(item);
    let result: unknown;
    if (Array.isArray(item)) {
      if (keys.length !== item.length || keys.some((key, index) => key !== String(index)))
        throw new TypeError();
      result = item.map((child) => copy(child, depth + 1));
    } else {
      const object = item as Record<string, unknown>;
      result = Object.fromEntries(keys.map((key) => [key, copy(object[key], depth + 1)]));
    }
    ancestors.delete(item);
    return result;
  };
  const encoded = JSON.stringify(copy(value, 0));
  if (new TextEncoder().encode(encoded).byteLength > maximum)
    throw new TypeError('Sync JSON is too large');
  return encoded;
}

export function snapshotSyncUploadBatch(input: unknown): SyncUploadEvent[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100)
    throw new TypeError('Send 1..100 events');
  const snapshot = row(JSON.parse(syncJsonSnapshot({ events: input }, MAX_SYNC_BATCH_BYTES)));
  const events = snapshot.events as unknown[];
  const ids = new Set<string>();
  return events.map((value) => {
    const object = row(value);
    const parsed = parseSyncUploadEvent(object);
    if (!parsed || ids.has(parsed.event_id)) throw new TypeError('Invalid or duplicate sync event');
    ids.add(parsed.event_id);
    // Keep optional-field presence and all supplied fields; the server owns normalization/fingerprints.
    return object as unknown as SyncUploadEvent;
  });
}

export function parseSyncUploadResult(
  value: unknown,
  original: SyncUploadEvent[],
): SyncUploadResult {
  const events = snapshotSyncUploadBatch(original);
  const result = row(JSON.parse(syncJsonSnapshot(value, SYNC_UPLOAD_RESPONSE_BYTES)), [
    'accepted',
    'rejected',
    'next_cursor',
  ]);
  const next_cursor = cursor(result.next_cursor);
  if (
    !Array.isArray(result.accepted) ||
    !Array.isArray(result.rejected) ||
    result.accepted.length + result.rejected.length !== events.length
  )
    throw new TypeError('Incomplete sync receipt');
  const pending = new Map(events.map((event) => [event.event_id, event]));
  const serverIds = new Set<string>();
  const serverCursors = new Set<number>();
  const conflictIds = new Set<string>();
  const take = (id: unknown) => {
    const event_id = identifier(id);
    const event = pending.get(event_id);
    if (!event || !pending.delete(event_id)) throw new TypeError('Unexpected sync receipt event');
    return event;
  };
  const delivery = (item: Record<string, unknown>) => {
    const server_event_id = identifier(item.server_event_id);
    const server_cursor = cursor(item.server_cursor, true);
    if (
      server_cursor > next_cursor ||
      serverIds.has(server_event_id) ||
      serverCursors.has(server_cursor)
    )
      throw new TypeError('Invalid or duplicated sync delivery');
    serverIds.add(server_event_id);
    serverCursors.add(server_cursor);
    return { server_event_id, server_cursor };
  };
  const accepted = result.accepted.map<AcceptedUpload>((raw) => {
    const item = row(raw, ['event_id', 'accepted', 'server_event_id', 'server_cursor']);
    const event = take(item.event_id);
    if (item.accepted !== true) throw new TypeError('Invalid accepted sync event');
    return { event_id: event.event_id, accepted: true, ...delivery(item) };
  });
  const rejected = result.rejected.map<RejectedUpload>((raw) => {
    const item = row(raw);
    const event = take(item.event_id);
    if (item.accepted !== false) throw new TypeError('Invalid rejected sync event');
    const common = {
      event_id: event.event_id,
      accepted: false as const,
      trace_id: trace(item.trace_id),
    };
    const commonFields = ['event_id', 'accepted', 'code', 'trace_id'];
    if (item.code === 'VERSION_CONFLICT') {
      row(item, [...commonFields, 'conflict_id', 'server_event_id', 'server_cursor']);
      const conflict_id = identifier(item.conflict_id);
      if (conflictIds.has(conflict_id) || event.event_type !== 'FieldChangeProposed')
        throw new TypeError('Invalid conflict delivery');
      conflictIds.add(conflict_id);
      return { ...common, code: 'VERSION_CONFLICT', conflict_id, ...delivery(item) };
    }
    if (item.code === 'CURSOR_GAP') {
      row(item, [...commonFields, 'expected_cursor']);
      const expected_cursor = cursor(item.expected_cursor, true);
      if (event.client_cursor === undefined || event.client_cursor === expected_cursor)
        throw new TypeError('Invalid cursor gap');
      return { ...common, code: 'CURSOR_GAP', expected_cursor };
    }
    row(item, commonFields);
    if (
      item.code !== 'VALIDATION_ERROR' &&
      item.code !== 'EVENT_ID_REUSED' &&
      item.code !== 'SOURCE_UNAVAILABLE'
    )
      throw new TypeError('Unknown sync rejection');
    return { ...common, code: item.code };
  });
  if (pending.size) throw new TypeError('Incomplete sync receipt');
  return { accepted, rejected, next_cursor };
}

export function parseSyncUploadEnvelope(
  value: unknown,
  original: SyncUploadEvent[],
  scope: SyncUploadScope,
  requestTrace: string,
): SyncUploadEnvelope {
  const envelope = row(JSON.parse(syncJsonSnapshot(value, SYNC_UPLOAD_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'server_cursor',
    'data',
  ]);
  if (envelope.schema_version !== 1 || trace(envelope.trace_id) !== trace(requestTrace))
    throw new TypeError('Invalid sync envelope');
  const data = row(envelope.data, [
    'tenant_id',
    'workspace_id',
    'project_id',
    'accepted',
    'rejected',
    'next_cursor',
  ]);
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (identifier(data[key]) !== identifier(scope[key])) throw new TypeError('Sync scope differs');
  if (!Array.isArray(envelope.source_refs) || envelope.source_refs.length !== 1)
    throw new TypeError();
  const source = row(envelope.source_refs[0], ['type', 'id']);
  if (source.type !== 'sync-stream' || source.id !== scope.project_id)
    throw new TypeError('Sync source differs');
  const result = parseSyncUploadResult(
    { accepted: data.accepted, rejected: data.rejected, next_cursor: data.next_cursor },
    original,
  );
  if (cursor(envelope.server_cursor) !== result.next_cursor)
    throw new TypeError('Sync watermark differs');
  return {
    schema_version: 1,
    trace_id: requestTrace,
    source_refs: [{ type: 'sync-stream', id: scope.project_id }],
    server_cursor: result.next_cursor,
    data: {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
      ...result,
    },
  };
}
