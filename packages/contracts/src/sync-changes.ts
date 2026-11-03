import { validateSourceRef, type SourceRef } from './metadata.js';
import { isSyncIdentifier } from './sync.js';
import { syncJsonSnapshot, type SyncUploadScope } from './sync-upload-receipt.js';
import {
  parseSyncCommandIdentity,
  SYNC_COMMAND_CONTEXT_BYTES,
  type SyncCommandIdentity,
} from './sync-command-context.js';

export const SYNC_CHANGES_QUERY_BYTES = 4096;
export const SYNC_CHANGES_RESPONSE_BYTES = 4 * 1024 * 1024;
export interface SyncChangesQuery {
  cursor?: number;
  limit?: number;
}
export interface SyncChangesRequest extends SyncChangesQuery {
  expected_identity?: SyncCommandIdentity;
}
/** MCP arguments may pin a saved consumer; wire GET uses identity precondition headers. */
export function parseSyncChangesRequest(value: unknown): SyncChangesRequest {
  const input = object(JSON.parse(syncJsonSnapshot(value, SYNC_COMMAND_CONTEXT_BYTES)), [
    'cursor',
    'limit',
    'expected_identity',
  ]);
  const { expected_identity, ...query } = input;
  return {
    ...parseSyncChangesQuery(query),
    ...(Object.hasOwn(input, 'expected_identity')
      ? { expected_identity: parseSyncCommandIdentity(expected_identity) }
      : {}),
  };
}
/** Stream metadata only; payload and extra historical fields remain untrusted reference data. */
export interface SyncChange extends Record<string, unknown> {
  event_id: string;
  event_type: string;
  trace_id: string;
  source_refs: SourceRef[];
  accepted: true;
  server_cursor: number;
  payload: Record<string, unknown>;
}
export interface SyncChangesPage extends SyncUploadScope {
  changes: SyncChange[];
  next_cursor: number;
  has_more: boolean;
}
export interface SyncChangesEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  server_cursor: number;
  data: SyncChangesPage;
}
function object(value: unknown, fields?: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (fields && Object.keys(value).some((field) => !fields.includes(field)))
  )
    throw new TypeError('Invalid sync page fields');
  return value as Record<string, unknown>;
}
function cursor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('Invalid sync cursor');
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
export function parseSyncChangesQuery(value: unknown): SyncChangesQuery {
  const input = object(JSON.parse(syncJsonSnapshot(value, SYNC_CHANGES_QUERY_BYTES)), [
    'cursor',
    'limit',
  ]);
  const result: SyncChangesQuery = {};
  if (Object.hasOwn(input, 'cursor')) result.cursor = cursor(input.cursor);
  if (Object.hasOwn(input, 'limit')) {
    result.limit = cursor(input.limit);
    if (result.limit < 1 || result.limit > 500) throw new TypeError('Use a limit from 1 to 500');
  }
  return result;
}
/** Key order is not semantic; source order, duplicate references and extra fields are. */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    );
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  );
}
/** Validates a complete page, preserving event extras; never truncates a page or advances an ack. */
export function parseSyncChangesEnvelope(
  value: unknown,
  input: SyncChangesQuery,
  scope: SyncUploadScope,
  requestTrace: string,
): SyncChangesEnvelope {
  const query = parseSyncChangesQuery(input);
  const envelope = object(JSON.parse(syncJsonSnapshot(value, SYNC_CHANGES_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'server_cursor',
    'data',
  ]);
  if (envelope.schema_version !== 1 || trace(envelope.trace_id) !== trace(requestTrace))
    throw new TypeError('Invalid sync page envelope');
  const data = object(envelope.data, [
    'tenant_id',
    'workspace_id',
    'project_id',
    'changes',
    'next_cursor',
    'has_more',
  ]);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (
      !isSyncIdentifier(scope[field]) ||
      scope[field] === '.' ||
      scope[field] === '..' ||
      data[field] !== scope[field]
    )
      throw new TypeError('Sync page scope changed');
  const next = cursor(data.next_cursor);
  const limit = query.limit ?? 100;
  if (
    cursor(envelope.server_cursor) !== next ||
    next < (query.cursor ?? 0) ||
    typeof data.has_more !== 'boolean' ||
    !Array.isArray(data.changes) ||
    data.changes.length > limit ||
    !Array.isArray(envelope.source_refs)
  )
    throw new TypeError('Invalid sync page boundary');
  let previous = query.cursor ?? 0;
  const ids = new Set<string>();
  const sources: SourceRef[] = [];
  const changes = data.changes.map((raw): SyncChange => {
    const change = object(raw);
    const position = cursor(change.server_cursor);
    if (
      position <= previous ||
      position > next ||
      !isSyncIdentifier(change.event_id) ||
      ids.has(change.event_id) ||
      !isSyncIdentifier(change.event_type) ||
      change.accepted !== true ||
      !Array.isArray(change.source_refs)
    )
      throw new TypeError('Invalid sync stream entry');
    object(change.payload);
    trace(change.trace_id);
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (Object.hasOwn(change, field) && change[field] !== scope[field])
        throw new TypeError('Sync event scope changed');
    change.source_refs.forEach((ref) => sources.push(validateSourceRef(ref)));
    ids.add(change.event_id);
    previous = position;
    return change as SyncChange;
  });
  if (data.has_more && (changes.length !== limit || next !== previous))
    throw new TypeError('Invalid sync continuation');
  envelope.source_refs.forEach(validateSourceRef);
  if (!sameJson(envelope.source_refs, sources)) throw new TypeError('Sync page sources changed');
  return {
    schema_version: 1,
    trace_id: requestTrace,
    source_refs: envelope.source_refs as SourceRef[],
    server_cursor: next,
    data: {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
      changes,
      next_cursor: next,
      has_more: data.has_more,
    },
  };
}
