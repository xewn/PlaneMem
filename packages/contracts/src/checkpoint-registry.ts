import { isUlid } from './ids.js';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from './session-activity.js';

export const CHECKPOINT_REGISTRY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const CHECKPOINT_REGISTRY_SUMMARY_BYTES = 8 * 1024;
export const CHECKPOINT_REGISTRY_SOURCE = 'wcp_session_checkpoints';
export interface CheckpointRegistryQuery {
  query?: string;
  checkpoint_id?: string;
  limit?: number;
  cursor?: string;
}
export interface CheckpointRegistryScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}
export interface CheckpointRegistryPosition {
  created_at: string;
  checkpoint_id: string;
}
export interface CheckpointRegistryRecord extends CheckpointRegistryPosition {
  session_id: string;
  revision: number;
  summary: string | null;
  summary_state: 'available' | 'missing' | 'too-large';
}
export interface CheckpointRegistryPage {
  data: CheckpointRegistryRecord[];
  has_more: boolean;
  next_cursor?: string;
}
export interface CheckpointRegistryEnvelope extends CheckpointRegistryPage {
  schema_version: 1;
  trace_id: string;
  scope: CheckpointRegistryScope;
  source_refs: Array<{ type: string; id: string }>;
  session_permissions: { write_sessions: boolean };
  session_identity?: SessionCommandIdentity;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected checkpoint registry object');
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new TypeError('Unknown checkpoint registry field');
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid checkpoint registry text');
  return value;
}
export function parseCheckpointRegistryQuery(value: unknown): CheckpointRegistryQuery {
  const row = object(value);
  only(row, ['query', 'checkpoint_id', 'limit', 'cursor']);
  const result: CheckpointRegistryQuery = {};
  if (row.query !== undefined) {
    if (
      typeof row.query !== 'string' ||
      row.query.length > 500 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.query)
    )
      throw new TypeError('Invalid checkpoint search');
    if (row.query.trim()) result.query = row.query.trim();
  }
  if (row.checkpoint_id !== undefined) {
    if (!isUlid(row.checkpoint_id)) throw new TypeError('Invalid checkpoint filter');
    result.checkpoint_id = row.checkpoint_id;
  }
  if (row.limit !== undefined) {
    if (
      typeof row.limit !== 'number' ||
      !Number.isSafeInteger(row.limit) ||
      row.limit < 1 ||
      row.limit > 100
    )
      throw new TypeError('Checkpoint page limit must be 1..100');
    result.limit = row.limit;
  }
  if (row.cursor !== undefined) {
    parseCheckpointRegistryCursor(row.cursor);
    result.cursor = row.cursor as string;
  }
  return result;
}
export function parseCheckpointRegistryPosition(value: unknown): CheckpointRegistryPosition {
  const row = object(value);
  const created_at = text(row.created_at, 27);
  if (
    !isUlid(row.checkpoint_id) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(created_at) ||
    created_at.startsWith('0000')
  )
    throw new TypeError('Invalid checkpoint position');
  const milliseconds = created_at.slice(0, 23) + 'Z';
  if (new Date(milliseconds).toISOString() !== milliseconds)
    throw new TypeError('Invalid checkpoint time');
  return { created_at, checkpoint_id: row.checkpoint_id };
}
/** Query binding and position, never an authorization credential or signature. */
export function encodeCheckpointRegistryCursor(key: string, value: CheckpointRegistryPosition) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Invalid checkpoint cursor key');
  const position = parseCheckpointRegistryPosition(value);
  return btoa(JSON.stringify([1, key, position.created_at, position.checkpoint_id]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function parseCheckpointRegistryCursor(
  value: unknown,
): CheckpointRegistryPosition & { key: string } {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(value))
    throw new TypeError('Invalid checkpoint cursor');
  const raw = value.replace(/-/g, '+').replace(/_/g, '/');
  const parsed: unknown = JSON.parse(atob(raw + '='.repeat((4 - (raw.length % 4)) % 4)));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 4 ||
    parsed[0] !== 1 ||
    typeof parsed[1] !== 'string'
  )
    throw new TypeError('Invalid checkpoint cursor');
  const position = parseCheckpointRegistryPosition({
    created_at: parsed[2],
    checkpoint_id: parsed[3],
  });
  if (encodeCheckpointRegistryCursor(parsed[1], position) !== value)
    throw new TypeError('Noncanonical checkpoint cursor');
  return { ...position, key: parsed[1] };
}
export function parseCheckpointRegistryRecord(value: unknown): CheckpointRegistryRecord {
  const row = object(value);
  only(row, ['checkpoint_id', 'session_id', 'revision', 'created_at', 'summary', 'summary_state']);
  const position = parseCheckpointRegistryPosition(row);
  if (
    !isUlid(row.session_id) ||
    typeof row.revision !== 'number' ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  )
    throw new TypeError('Invalid checkpoint revision or session');
  let summary: string | null = null;
  if (row.summary_state === 'available') {
    if (
      typeof row.summary !== 'string' ||
      /[\u0000\p{Cs}]/u.test(row.summary) ||
      new TextEncoder().encode(row.summary).byteLength > CHECKPOINT_REGISTRY_SUMMARY_BYTES
    )
      throw new TypeError('Invalid checkpoint summary');
    summary = row.summary;
  } else if (
    (row.summary_state !== 'missing' && row.summary_state !== 'too-large') ||
    row.summary !== null
  )
    throw new TypeError('Invalid checkpoint summary availability');
  return {
    ...position,
    session_id: row.session_id,
    revision: row.revision,
    summary,
    summary_state: row.summary_state as CheckpointRegistryRecord['summary_state'],
  };
}
export function parseCheckpointRegistryPage(
  value: unknown,
  input: CheckpointRegistryQuery = {},
): CheckpointRegistryPage {
  const row = object(value);
  const query = parseCheckpointRegistryQuery(input);
  const limit = query.limit ?? 25;
  if (
    new TextEncoder().encode(JSON.stringify(row)).byteLength > CHECKPOINT_REGISTRY_RESPONSE_BYTES ||
    !Array.isArray(row.data) ||
    row.data.length > limit ||
    Object.keys(row.data).length !== row.data.length ||
    typeof row.has_more !== 'boolean' ||
    (query.checkpoint_id !== undefined && row.has_more)
  )
    throw new TypeError('Invalid checkpoint page');
  let previous: CheckpointRegistryPosition | undefined = query.cursor
    ? parseCheckpointRegistryCursor(query.cursor)
    : undefined;
  const ids = new Set<string>();
  const revisions = new Set<string>();
  const data = Array.from(row.data, (raw: unknown) => {
    const item = parseCheckpointRegistryRecord(raw);
    const revisionKey = item.session_id + ':' + item.revision;
    if (
      ids.has(item.checkpoint_id) ||
      revisions.has(revisionKey) ||
      (query.checkpoint_id && item.checkpoint_id !== query.checkpoint_id) ||
      (previous &&
        !(
          item.created_at < previous.created_at ||
          (item.created_at === previous.created_at && item.checkpoint_id > previous.checkpoint_id)
        ))
    )
      throw new TypeError('Checkpoint page differs from requested order or filter');
    ids.add(item.checkpoint_id);
    revisions.add(revisionKey);
    previous = item;
    return item;
  });
  if (!row.has_more) {
    if (row.next_cursor !== undefined) throw new TypeError('Unexpected checkpoint continuation');
    return { data, has_more: false };
  }
  const next = parseCheckpointRegistryCursor(row.next_cursor);
  const last = data.at(-1);
  if (
    !last ||
    data.length !== limit ||
    next.checkpoint_id !== last.checkpoint_id ||
    next.created_at !== last.created_at ||
    row.next_cursor === query.cursor ||
    (query.cursor && next.key !== parseCheckpointRegistryCursor(query.cursor).key)
  )
    throw new TypeError('Invalid checkpoint continuation');
  return { data, has_more: true, next_cursor: row.next_cursor as string };
}
export function parseCheckpointRegistryEnvelope(
  value: unknown,
  query: CheckpointRegistryQuery,
  scope: CheckpointRegistryScope,
  trace: string,
): CheckpointRegistryEnvelope {
  const row = object(value);
  only(row, [
    'schema_version',
    'trace_id',
    'scope',
    'source_refs',
    'data',
    'has_more',
    'next_cursor',
    'session_permissions',
    'session_identity',
  ]);
  if (row.schema_version !== 1 || text(row.trace_id, 512) !== trace)
    throw new TypeError('Invalid checkpoint envelope');
  const returned = object(row.scope);
  only(returned, ['tenant_id', 'workspace_id', 'project_id']);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (text(returned[field], 1024) !== scope[field])
      throw new TypeError('Checkpoint scope mismatch');
  if (!Array.isArray(row.source_refs) || row.source_refs.length !== 1)
    throw new TypeError('Invalid checkpoint sources');
  const source = object(row.source_refs[0]);
  only(source, ['type', 'id']);
  if (source.type !== 'postgres' || source.id !== CHECKPOINT_REGISTRY_SOURCE)
    throw new TypeError('Invalid checkpoint source');
  const permissions = object(row.session_permissions);
  only(permissions, ['write_sessions']);
  const identity =
    row.session_identity === undefined
      ? undefined
      : parseSessionCommandIdentity(row.session_identity);
  if (typeof permissions.write_sessions !== 'boolean' || (permissions.write_sessions && !identity))
    throw new TypeError('Invalid checkpoint permissions');
  if (identity)
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (identity[field] !== scope[field]) throw new TypeError('Checkpoint reader scope mismatch');
  return {
    schema_version: 1,
    trace_id: trace,
    scope: {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
    },
    source_refs: [{ type: 'postgres', id: CHECKPOINT_REGISTRY_SOURCE }],
    ...parseCheckpointRegistryPage(row, query),
    session_permissions: { write_sessions: permissions.write_sessions },
    ...(identity ? { session_identity: identity } : {}),
  };
}
