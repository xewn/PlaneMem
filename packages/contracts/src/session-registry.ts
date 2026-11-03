import { isUlid } from './ids.js';
import {
  parseSessionClosureState,
  parseSessionCommandIdentity,
  type SessionClosureState,
  type SessionCommandIdentity,
} from './session-activity.js';
import { parseSessionResumeOrigin, type SessionResumeOrigin } from './session-resume.js';

export const SESSION_REGISTRY_STATUSES = [
  'running',
  'paused',
  'ended',
  'abandoned',
  'failed',
] as const;
export const SESSION_REGISTRY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const SESSION_REGISTRY_SOURCES = [
  'wcp_sessions',
  'wcp_agent_runs',
  'wcp_tool_calls',
  'wcp_session_checkpoints',
] as const;

export interface SessionRegistryQuery {
  query?: string;
  status?: SessionClosureState['status'];
  client_id?: string;
  limit?: number;
  cursor?: string;
}
export interface SessionRegistryScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}
export interface SessionRegistryPosition {
  started_at: string;
  session_id: string;
}
export interface SessionRegistryRecord extends SessionClosureState {
  client_id: string;
  actor_id: string;
  parent_session_id: string | null;
  resume_origin: SessionResumeOrigin | null;
  started_at: string;
  trace_id: string;
  run_count: number;
  tool_call_count: number;
  checkpoint_id: string | null;
  checkpoint_revision: number | null;
}
export interface SessionRegistryPage {
  data: SessionRegistryRecord[];
  has_more: boolean;
  next_cursor?: string;
}
export interface SessionRegistryEnvelope extends SessionRegistryPage {
  schema_version: 1;
  trace_id: string;
  scope: SessionRegistryScope;
  source_refs: Array<{ type: string; id: string }>;
  session_permissions: { write_sessions: boolean };
  session_identity?: SessionCommandIdentity;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected session registry object');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid session registry text');
  return value;
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    throw new TypeError('Invalid session registry integer');
  return value;
}
function only(row: Record<string, unknown>, keys: string[]) {
  if (Object.keys(row).some((key) => !keys.includes(key)))
    throw new TypeError('Unknown session registry field');
}

export function parseSessionRegistryQuery(value: unknown): SessionRegistryQuery {
  const row = object(value);
  only(row, ['query', 'status', 'client_id', 'limit', 'cursor']);
  const result: SessionRegistryQuery = {};
  if (row.query !== undefined) {
    if (
      typeof row.query !== 'string' ||
      row.query.length > 500 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.query)
    )
      throw new TypeError('Invalid session search');
    if (row.query.trim()) result.query = row.query.trim();
  }
  if (row.client_id !== undefined && row.client_id !== '')
    result.client_id = text(row.client_id, 1024);
  if (row.status !== undefined && row.status !== '') {
    if (!SESSION_REGISTRY_STATUSES.includes(row.status as SessionClosureState['status']))
      throw new TypeError('Invalid session status');
    result.status = row.status as SessionClosureState['status'];
  }
  if (row.limit !== undefined) {
    result.limit = integer(row.limit, 1);
    if (result.limit > 100) throw new TypeError('Session page limit exceeds 100');
  }
  if (row.cursor !== undefined) {
    parseSessionRegistryCursor(row.cursor);
    result.cursor = row.cursor as string;
  }
  return result;
}

/** PostgreSQL microseconds are preserved in both returned rows and cursor positions. */
export function parseSessionRegistryPosition(value: unknown): SessionRegistryPosition {
  const row = object(value);
  const started_at = text(row.started_at, 27);
  if (
    !isUlid(row.session_id) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(started_at) ||
    started_at.startsWith('0000')
  )
    throw new TypeError('Invalid session position');
  const milliseconds = started_at.slice(0, 23) + 'Z';
  if (new Date(milliseconds).toISOString() !== milliseconds)
    throw new TypeError('Invalid session time');
  return { started_at, session_id: row.session_id };
}

/** Query binding, not a signature or authorization credential. */
export function encodeSessionRegistryCursor(key: string, value: SessionRegistryPosition): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Invalid session cursor key');
  const position = parseSessionRegistryPosition(value);
  return btoa(JSON.stringify([1, key, position.started_at, position.session_id]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function parseSessionRegistryCursor(
  value: unknown,
): SessionRegistryPosition & { key: string } {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(value))
    throw new TypeError('Invalid session cursor');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const parsed: unknown = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 4 ||
    parsed[0] !== 1 ||
    typeof parsed[1] !== 'string'
  )
    throw new TypeError('Invalid session cursor');
  const key = parsed[1];
  const position = parseSessionRegistryPosition({ started_at: parsed[2], session_id: parsed[3] });
  if (encodeSessionRegistryCursor(key, position) !== value)
    throw new TypeError('Noncanonical session cursor');
  return { ...position, key };
}
function after(left: SessionRegistryPosition, right: SessionRegistryPosition): boolean {
  return (
    left.started_at < right.started_at ||
    (left.started_at === right.started_at && left.session_id > right.session_id)
  );
}

export function parseSessionRegistryRecord(value: unknown): SessionRegistryRecord {
  const row = object(value);
  only(row, [
    'session_id',
    'client_id',
    'actor_id',
    'parent_session_id',
    'resume_origin',
    'status',
    'started_at',
    'ended_at',
    'trace_id',
    'version',
    'run_count',
    'tool_call_count',
    'checkpoint_id',
    'checkpoint_revision',
  ]);
  const position = parseSessionRegistryPosition(row);
  const state = parseSessionClosureState(
    {
      session_id: row.session_id,
      status: row.status,
      version: row.version,
      ended_at: row.ended_at,
    },
    position.session_id,
  );
  if (
    row.parent_session_id !== null &&
    (!isUlid(row.parent_session_id) || row.parent_session_id === row.session_id)
  )
    throw new TypeError('Invalid session parent');
  const resume_origin =
    row.resume_origin === null ? null : parseSessionResumeOrigin(row.resume_origin);
  if (resume_origin && row.parent_session_id === null)
    throw new TypeError('Resume origin requires a parent');
  if (row.checkpoint_id !== null && !isUlid(row.checkpoint_id))
    throw new TypeError('Invalid latest checkpoint');
  const checkpoint_revision =
    row.checkpoint_revision === null ? null : integer(row.checkpoint_revision, 1);
  if ((row.checkpoint_id === null) !== (checkpoint_revision === null))
    throw new TypeError('Incomplete latest checkpoint');
  return {
    ...state,
    started_at: position.started_at,
    client_id: text(row.client_id, 1024),
    actor_id: text(row.actor_id, 1024),
    parent_session_id: row.parent_session_id as string | null,
    resume_origin,
    trace_id: text(row.trace_id, 512),
    run_count: integer(row.run_count),
    tool_call_count: integer(row.tool_call_count),
    checkpoint_id: row.checkpoint_id as string | null,
    checkpoint_revision,
  };
}

export function parseSessionRegistryPage(
  value: unknown,
  input: SessionRegistryQuery = {},
): SessionRegistryPage {
  const row = object(value);
  const query = parseSessionRegistryQuery(input);
  const limit = query.limit ?? 25;
  if (
    new TextEncoder().encode(JSON.stringify(row)).byteLength > SESSION_REGISTRY_RESPONSE_BYTES ||
    !Array.isArray(row.data) ||
    row.data.length > limit ||
    typeof row.has_more !== 'boolean'
  )
    throw new TypeError('Invalid session page');
  let previous: SessionRegistryPosition | undefined = query.cursor
    ? parseSessionRegistryCursor(query.cursor)
    : undefined;
  const ids = new Set<string>();
  const data = row.data.map((raw) => {
    const item = parseSessionRegistryRecord(raw);
    if (
      ids.has(item.session_id) ||
      (previous && !after(item, previous)) ||
      (query.status && item.status !== query.status) ||
      (query.client_id && item.client_id !== query.client_id)
    )
      throw new TypeError('Session page does not match query or order');
    ids.add(item.session_id);
    previous = item;
    return item;
  });
  if (!row.has_more) {
    if (row.next_cursor !== undefined) throw new TypeError('Unexpected session continuation');
    return { data, has_more: false };
  }
  const next = parseSessionRegistryCursor(row.next_cursor);
  const last = data[data.length - 1];
  if (
    !last ||
    data.length !== limit ||
    next.session_id !== last.session_id ||
    next.started_at !== last.started_at ||
    row.next_cursor === query.cursor ||
    (query.cursor && next.key !== parseSessionRegistryCursor(query.cursor).key)
  )
    throw new TypeError('Invalid session continuation');
  return { data, has_more: true, next_cursor: row.next_cursor as string };
}

export function parseSessionRegistryEnvelope(
  value: unknown,
  query: SessionRegistryQuery,
  scope: SessionRegistryScope,
  trace: string,
): SessionRegistryEnvelope {
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
    throw new TypeError('Invalid session envelope');
  const rawScope = object(row.scope);
  only(rawScope, ['tenant_id', 'workspace_id', 'project_id']);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (text(rawScope[field], 1024) !== scope[field]) throw new TypeError('Session scope mismatch');
  const source_refs = SESSION_REGISTRY_SOURCES.map((id) => ({ type: 'postgres', id }));
  if (
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== source_refs.length ||
    row.source_refs.some((raw, index) => {
      const ref = object(raw);
      only(ref, ['type', 'id']);
      return ref.type !== 'postgres' || ref.id !== source_refs[index]?.id;
    })
  )
    throw new TypeError('Invalid session sources');
  const permissions = object(row.session_permissions);
  only(permissions, ['write_sessions']);
  if (typeof permissions.write_sessions !== 'boolean')
    throw new TypeError('Invalid session permissions');
  const identity =
    row.session_identity === undefined
      ? undefined
      : parseSessionCommandIdentity(row.session_identity);
  if (identity) {
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (identity[field] !== scope[field]) throw new TypeError('Session identity scope mismatch');
  } else if (permissions.write_sessions)
    throw new TypeError('Writable session page requires identity');
  return {
    schema_version: 1,
    trace_id: trace,
    scope: {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
    },
    source_refs,
    ...parseSessionRegistryPage(row, query),
    session_permissions: { write_sessions: permissions.write_sessions },
    ...(identity ? { session_identity: identity } : {}),
  };
}
