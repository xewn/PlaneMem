import { isUlid } from './ids.js';
import { isSyncIdentifier } from './sync.js';
import { parseSyncCommandIdentity, type SyncCommandIdentity } from './sync-command-context.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const CONTEXT_PACK_SAVE_CONTEXT_BYTES = 16 * 1024;
export type ContextPackSaveIdentity = SyncCommandIdentity;
export interface ContextPackSaveContextEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: {
    identity: ContextPackSaveIdentity;
    expires_at: string;
    permissions: { compile: true; read_restricted: boolean };
  };
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  return row;
}

/** Complete current authority metadata, never a reservation or proof of a saved request. */
export function parseContextPackSaveContextEnvelope(
  input: unknown,
  scope: Pick<ContextPackSaveIdentity, 'tenant_id' | 'workspace_id' | 'project_id'> &
    Partial<Pick<ContextPackSaveIdentity, 'actor_id' | 'client_id'>>,
  trace: string,
): ContextPackSaveContextEnvelope {
  const row = record(JSON.parse(syncJsonSnapshot(input, CONTEXT_PACK_SAVE_CONTEXT_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'data',
  ]);
  const data = record(row.data, ['identity', 'expires_at', 'permissions']);
  const identity = parseSyncCommandIdentity(data.identity);
  const permissions = record(data.permissions, ['compile', 'read_restricted']);
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !isSyncIdentifier(trace) ||
    /\u007f/.test(trace) ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== 0 ||
    ![identity.tenant_id, identity.workspace_id, identity.project_id, identity.actor_id].every(
      isUlid,
    ) ||
    !isSyncIdentifier(identity.client_id) ||
    /\u007f/.test(identity.client_id) ||
    identity.tenant_id !== scope.tenant_id ||
    identity.workspace_id !== scope.workspace_id ||
    identity.project_id !== scope.project_id ||
    (scope.actor_id !== undefined && identity.actor_id !== scope.actor_id) ||
    (scope.client_id !== undefined && identity.client_id !== scope.client_id) ||
    permissions.compile !== true ||
    typeof permissions.read_restricted !== 'boolean' ||
    typeof data.expires_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.expires_at) ||
    data.expires_at.startsWith('0000') ||
    !Number.isFinite(Date.parse(data.expires_at)) ||
    new Date(data.expires_at).toISOString() !== data.expires_at
  )
    throw new TypeError('Invalid context pack save identity');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: {
      identity,
      expires_at: data.expires_at,
      permissions: { compile: true, read_restricted: permissions.read_restricted },
    },
  };
}
