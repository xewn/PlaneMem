import { isSyncIdentifier } from './sync.js';
import type { SyncUploadScope } from './sync-upload-receipt.js';

export const SYNC_COMMAND_CONTEXT_BYTES = 16 * 1024;
export interface SyncCommandIdentity extends SyncUploadScope {
  actor_id: string;
  client_id: string;
}
export interface SyncCommandContextEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: {
    identity: SyncCommandIdentity;
    expires_at: string;
    permissions: { upload_events: true };
  };
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid sync identity');
  const prototype: unknown = Object.getPrototypeOf(value);
  const keys = Object.keys(value);
  if (
    (prototype !== null && prototype !== Object.prototype) ||
    keys.length !== fields.length ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(
      (key) =>
        !fields.includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'),
    )
  )
    throw new TypeError('Invalid sync identity fields');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid sync identity text');
  return value;
}
export function parseSyncCommandIdentity(value: unknown): SyncCommandIdentity {
  const row = object(value, ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id']);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isSyncIdentifier(row[field]) || row[field] === '.' || row[field] === '..')
      throw new TypeError('Invalid sync scope');
  return {
    tenant_id: row.tenant_id as string,
    workspace_id: row.workspace_id as string,
    project_id: row.project_id as string,
    actor_id: text(row.actor_id),
    client_id: text(row.client_id),
  };
}
export function assertSyncIdentityScope(
  identity: SyncCommandIdentity,
  scope: SyncUploadScope,
): void {
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (identity[field] !== scope[field]) throw new TypeError('Original sync scope changed');
}
export function assertSyncCommandIdentity(
  identity: SyncCommandIdentity,
  expected: SyncCommandIdentity,
): void {
  assertSyncIdentityScope(identity, expected);
  if (identity.actor_id !== expected.actor_id || identity.client_id !== expected.client_id)
    throw new TypeError('Original sync sender changed');
}
/** Verified caller metadata only, not project visibility, upload permission persistence or delivery. */
export function parseSyncCommandContextEnvelope(
  value: unknown,
  scope: SyncUploadScope,
  trace: string,
  expected?: SyncCommandIdentity,
): SyncCommandContextEnvelope {
  const envelope = object(value, ['schema_version', 'trace_id', 'source_refs', 'data']);
  if (
    envelope.schema_version !== 1 ||
    text(envelope.trace_id) !== text(trace) ||
    !Array.isArray(envelope.source_refs) ||
    Object.getPrototypeOf(envelope.source_refs) !== Array.prototype ||
    envelope.source_refs.length ||
    Reflect.ownKeys(envelope.source_refs).length !== 1
  )
    throw new TypeError('Invalid sync identity envelope');
  const data = object(envelope.data, ['identity', 'expires_at', 'permissions']);
  const identity = parseSyncCommandIdentity(data.identity);
  assertSyncIdentityScope(identity, scope);
  if (expected) assertSyncCommandIdentity(identity, expected);
  const permissions = object(data.permissions, ['upload_events']);
  if (
    permissions.upload_events !== true ||
    typeof data.expires_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.expires_at) ||
    !Number.isFinite(Date.parse(data.expires_at)) ||
    new Date(data.expires_at).toISOString() !== data.expires_at
  )
    throw new TypeError('Invalid sync authority');
  const result: SyncCommandContextEnvelope = {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: { identity, expires_at: data.expires_at, permissions: { upload_events: true } },
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > SYNC_COMMAND_CONTEXT_BYTES)
    throw new TypeError('Sync identity is too large');
  return result;
}
