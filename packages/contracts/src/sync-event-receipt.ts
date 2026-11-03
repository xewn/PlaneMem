import { MAX_SYNC_BATCH_BYTES, isSyncIdentifier, type SyncUploadEvent } from './sync.js';
import { syncJsonSnapshot, snapshotSyncUploadBatch } from './sync-upload-receipt.js';
import {
  parseSyncCommandIdentity,
  assertSyncCommandIdentity,
  SYNC_COMMAND_CONTEXT_BYTES,
  type SyncCommandIdentity,
} from './sync-command-context.js';

export const SYNC_EVENT_RECEIPT_REQUEST_BYTES = MAX_SYNC_BATCH_BYTES + SYNC_COMMAND_CONTEXT_BYTES;
export const SYNC_EVENT_RECEIPT_RESPONSE_BYTES = 2 * 1024 * 1024;
export interface SyncEventReceiptQuery {
  identity: SyncCommandIdentity;
  event: SyncUploadEvent;
}
export interface SyncRecordedEventReceipt {
  event_id: string;
  accepted: boolean;
  server_event_id: string;
  server_cursor: number;
  conflict_id?: string;
  original_trace_id: string;
  recorded_at: string;
  source_application: 'not-checked';
}
export type SyncEventReceiptView = SyncEventReceiptQuery &
  ({ status: 'not-observed' } | { status: 'recorded'; receipt: SyncRecordedEventReceipt });
export interface SyncEventReceiptEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: { type: 'sync-event'; id: string }[];
  data: SyncEventReceiptView;
}
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw new TypeError('Invalid sync receipt fields');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid receipt text');
  return value;
}
function id(value: unknown): string {
  if (!isSyncIdentifier(value)) throw new TypeError('Invalid receipt ID');
  return value;
}
function canonical(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sort(child)]),
      );
    return input;
  };
  return JSON.stringify(sort(value));
}
export function parseSyncEventReceiptQuery(value: unknown): SyncEventReceiptQuery {
  const row = object(JSON.parse(syncJsonSnapshot(value, SYNC_EVENT_RECEIPT_REQUEST_BYTES)), [
    'identity',
    'event',
  ]);
  const identity = parseSyncCommandIdentity(row.identity);
  const event = snapshotSyncUploadBatch([row.event])[0]!;
  // Match the legacy server's explicit outer identity preconditions before its normalization.
  const raw = event as unknown as Record<string, unknown>;
  for (const key of ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id'] as const)
    if (raw[key] !== undefined && raw[key] !== identity[key])
      throw new TypeError('Original event identity differs');
  return { identity, event };
}
export function parseSyncEventReceiptEnvelope(
  value: unknown,
  input: SyncEventReceiptQuery,
  trace: string,
): SyncEventReceiptEnvelope {
  const original = parseSyncEventReceiptQuery(input);
  const envelope = object(JSON.parse(syncJsonSnapshot(value, SYNC_EVENT_RECEIPT_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'data',
  ]);
  if (
    envelope.schema_version !== 1 ||
    text(envelope.trace_id) !== text(trace) ||
    !Array.isArray(envelope.source_refs)
  )
    throw new TypeError('Invalid receipt envelope');
  const data = object(envelope.data, ['identity', 'event', 'status', 'receipt']);
  const echoed = parseSyncEventReceiptQuery({ identity: data.identity, event: data.event });
  assertSyncCommandIdentity(echoed.identity, original.identity);
  if (canonical(echoed.event) !== canonical(original.event))
    throw new TypeError('Original event changed');
  if (data.status === 'not-observed') {
    if (Object.hasOwn(data, 'receipt') || envelope.source_refs.length)
      throw new TypeError('Unexpected unobserved receipt');
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: { ...original, status: 'not-observed' },
    };
  }
  if (data.status !== 'recorded') throw new TypeError('Unknown receipt state');
  const receipt = object(data.receipt, [
    'event_id',
    'accepted',
    'server_event_id',
    'server_cursor',
    'conflict_id',
    'original_trace_id',
    'recorded_at',
    'source_application',
  ]);
  if (
    receipt.event_id !== original.event.event_id ||
    typeof receipt.accepted !== 'boolean' ||
    typeof receipt.server_cursor !== 'number' ||
    !Number.isSafeInteger(receipt.server_cursor) ||
    receipt.server_cursor < 1 ||
    receipt.source_application !== 'not-checked' ||
    typeof receipt.recorded_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.recorded_at) ||
    !Number.isFinite(Date.parse(receipt.recorded_at)) ||
    new Date(receipt.recorded_at).toISOString() !== receipt.recorded_at
  )
    throw new TypeError('Invalid recorded delivery');
  const server_event_id = id(receipt.server_event_id);
  const conflict_id = receipt.accepted ? undefined : id(receipt.conflict_id);
  if (
    (receipt.accepted && Object.hasOwn(receipt, 'conflict_id')) ||
    (!receipt.accepted && original.event.event_type !== 'FieldChangeProposed') ||
    envelope.source_refs.length !== 1
  )
    throw new TypeError('Invalid conflict receipt');
  const source = object(envelope.source_refs[0], ['type', 'id']);
  if (source.type !== 'sync-event' || source.id !== server_event_id)
    throw new TypeError('Receipt source differs');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [{ type: 'sync-event', id: server_event_id }],
    data: {
      ...original,
      status: 'recorded',
      receipt: {
        event_id: original.event.event_id,
        accepted: receipt.accepted,
        server_event_id,
        server_cursor: receipt.server_cursor,
        ...(conflict_id === undefined ? {} : { conflict_id }),
        original_trace_id: text(receipt.original_trace_id),
        recorded_at: receipt.recorded_at,
        source_application: 'not-checked',
      },
    },
  };
}
