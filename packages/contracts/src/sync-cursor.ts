import { syncJsonSnapshot, type SyncUploadScope } from './sync-upload-receipt.js';
import {
  parseSyncCommandIdentity,
  assertSyncCommandIdentity,
  assertSyncIdentityScope,
  type SyncCommandIdentity,
} from './sync-command-context.js';

export const SYNC_CURSOR_REQUEST_BYTES = 16 * 1024;
export const SYNC_CURSOR_RESPONSE_BYTES = 32 * 1024;
export interface SyncAcknowledgement {
  expected_identity: SyncCommandIdentity;
  cursor: number;
}
export interface SyncCursorQuery {
  expected_identity?: SyncCommandIdentity;
}
export interface SyncCursorEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: { type: 'sync-cursor'; id: string }[];
  server_cursor: number;
  data: {
    identity: SyncCommandIdentity;
    cursor: number;
    recorded: boolean;
    expires_at: string;
    permissions: { acknowledge_sync: true };
  };
}
export interface SyncAcknowledgementEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: { type: 'sync-cursor'; id: string }[];
  server_cursor: number;
  data: { identity: SyncCommandIdentity; client_id: string; cursor: number };
}
function row(value: unknown, fields: string[], exact = true): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const keys = Object.keys(value);
  if ((exact && keys.length !== fields.length) || keys.some((key) => !fields.includes(key)))
    throw new TypeError();
  return value as Record<string, unknown>;
}
export function parseSyncCursorNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('Use a non-negative safe cursor');
  return value;
}
function trace(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError();
  return value;
}
export function parseSyncCursorQuery(value: unknown): SyncCursorQuery {
  const input = row(
    JSON.parse(syncJsonSnapshot(value, SYNC_CURSOR_REQUEST_BYTES)),
    ['expected_identity'],
    false,
  );
  return Object.hasOwn(input, 'expected_identity')
    ? { expected_identity: parseSyncCommandIdentity(input.expected_identity) }
    : {};
}
export function parseSyncAcknowledgement(value: unknown): SyncAcknowledgement {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_CURSOR_REQUEST_BYTES)), [
    'expected_identity',
    'cursor',
  ]);
  return {
    expected_identity: parseSyncCommandIdentity(input.expected_identity),
    cursor: parseSyncCursorNumber(input.cursor),
  };
}
function envelope(value: unknown, requestTrace: string) {
  const input = row(JSON.parse(syncJsonSnapshot(value, SYNC_CURSOR_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'server_cursor',
    'data',
  ]);
  if (input.schema_version !== 1 || trace(input.trace_id) !== trace(requestTrace))
    throw new TypeError();
  return input;
}
function sources(value: unknown, identity: SyncCommandIdentity, cursor: number, recorded: boolean) {
  if (!Array.isArray(value) || value.length !== (recorded ? 1 : 0)) throw new TypeError();
  if (recorded) {
    const source = row(value[0], ['type', 'id']);
    if (source.type !== 'sync-cursor' || source.id !== identity.client_id + ':' + cursor)
      throw new TypeError();
  }
  return value as { type: 'sync-cursor'; id: string }[];
}
/** Current acknowledgement state, not an original request receipt or evidence of local persistence. */
export function parseSyncCursorEnvelope(
  value: unknown,
  scope: SyncUploadScope,
  requestTrace: string,
  expected?: SyncCommandIdentity,
): SyncCursorEnvelope {
  const input = envelope(value, requestTrace);
  const data = row(input.data, ['identity', 'cursor', 'recorded', 'expires_at', 'permissions']);
  const identity = parseSyncCommandIdentity(data.identity);
  assertSyncIdentityScope(identity, scope);
  if (expected) assertSyncCommandIdentity(identity, expected);
  const cursor = parseSyncCursorNumber(data.cursor);
  const permissions = row(data.permissions, ['acknowledge_sync']);
  if (
    input.server_cursor !== cursor ||
    typeof data.recorded !== 'boolean' ||
    (!data.recorded && cursor !== 0) ||
    permissions.acknowledge_sync !== true ||
    typeof data.expires_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.expires_at) ||
    !Number.isFinite(Date.parse(data.expires_at)) ||
    new Date(data.expires_at).toISOString() !== data.expires_at
  )
    throw new TypeError();
  return {
    schema_version: 1,
    trace_id: requestTrace,
    source_refs: sources(input.source_refs, identity, cursor, data.recorded),
    server_cursor: cursor,
    data: {
      identity,
      cursor,
      recorded: data.recorded,
      expires_at: data.expires_at,
      permissions: { acknowledge_sync: true },
    },
  };
}
export function parseSyncAcknowledgementEnvelope(
  value: unknown,
  original: SyncAcknowledgement,
  requestTrace: string,
): SyncAcknowledgementEnvelope {
  const command = parseSyncAcknowledgement(original);
  const input = envelope(value, requestTrace);
  const data = row(input.data, ['identity', 'client_id', 'cursor']);
  const identity = parseSyncCommandIdentity(data.identity);
  assertSyncCommandIdentity(identity, command.expected_identity);
  if (
    data.cursor !== command.cursor ||
    input.server_cursor !== command.cursor ||
    data.client_id !== identity.client_id
  )
    throw new TypeError();
  return {
    schema_version: 1,
    trace_id: requestTrace,
    source_refs: sources(input.source_refs, identity, command.cursor, true),
    server_cursor: command.cursor,
    data: { identity, client_id: identity.client_id, cursor: command.cursor },
  };
}
