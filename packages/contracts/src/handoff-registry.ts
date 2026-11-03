import { isUlid } from './ids.js';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from './session-activity.js';

export const HANDOFF_REGISTRY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const HANDOFF_REGISTRY_SUMMARY_BYTES = 8 * 1024;
export const HANDOFF_REGISTRY_SOURCES = [
  'wcp_handoffs',
  'wcp_session_handoffs',
  'wcp_session_checkpoints',
] as const;
export interface HandoffRegistryQuery {
  query?: string;
  status?: 'open' | 'closed';
  session_id?: string;
  origin?: 'session' | 'projection';
  limit?: number;
  cursor?: string;
}
export interface HandoffRegistryScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}
export interface HandoffRegistryPosition {
  updated_at: string;
  handoff_id: string;
}
export interface HandoffRegistryRecord extends HandoffRegistryPosition {
  session_id: string;
  checkpoint_id: string;
  status: 'open' | 'claimed' | 'expired' | 'offered' | 'accepted' | 'rejected';
  origin: 'session' | 'projection';
  from_client: string | null;
  offered_to: string | null;
  claimed_by: string | null;
  claimed_by_actor: string | null;
  version: number | null;
  created_at: string;
  summary: string | null;
  summary_state: 'available' | 'missing' | 'too-large';
}
export interface HandoffRegistryPage {
  data: HandoffRegistryRecord[];
  has_more: boolean;
  next_cursor?: string;
}
export interface HandoffRegistryEnvelope extends Omit<HandoffRegistryPage, 'data'> {
  schema_version: 1;
  trace_id: string;
  scope: HandoffRegistryScope;
  source_refs: Array<{ type: string; id: string }>;
  data: Array<HandoffRegistryRecord & { recipient_matches: boolean; claimed_here: boolean }>;
  session_permissions: { write_sessions: boolean };
  handoff_permissions: { write_sessions: boolean; claim: boolean };
  session_identity?: SessionCommandIdentity;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected handoff registry object');
  return value as Record<string, unknown>;
}
function only(row: Record<string, unknown>, fields: string[]) {
  if (Object.keys(row).some((key) => !fields.includes(key)))
    throw new TypeError('Unknown handoff registry field');
}
function text(value: unknown, max = 1024): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid handoff registry text');
  return value;
}
function time(value: unknown): string {
  const valueText = text(value, 27);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(valueText) ||
    valueText.startsWith('0000')
  )
    throw new TypeError('Invalid handoff time');
  const milliseconds = valueText.slice(0, 23) + 'Z';
  if (new Date(milliseconds).toISOString() !== milliseconds)
    throw new TypeError('Invalid handoff time');
  return valueText;
}

export function parseHandoffRegistryQuery(value: unknown): HandoffRegistryQuery {
  const row = object(value);
  only(row, ['query', 'status', 'session_id', 'origin', 'limit', 'cursor']);
  const result: HandoffRegistryQuery = {};
  if (row.query !== undefined) {
    if (
      typeof row.query !== 'string' ||
      row.query.length > 500 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.query)
    )
      throw new TypeError('Invalid handoff search');
    if (row.query.trim()) result.query = row.query.trim();
  }
  if (row.status !== undefined && row.status !== '') {
    if (row.status !== 'open' && row.status !== 'closed')
      throw new TypeError('Invalid handoff status filter');
    result.status = row.status;
  }
  if (row.origin !== undefined && row.origin !== '') {
    if (row.origin !== 'session' && row.origin !== 'projection')
      throw new TypeError('Invalid handoff origin');
    result.origin = row.origin;
  }
  if (row.session_id !== undefined) {
    if (!isUlid(row.session_id)) throw new TypeError('Invalid handoff session');
    result.session_id = row.session_id;
  }
  if (row.limit !== undefined) {
    if (
      typeof row.limit !== 'number' ||
      !Number.isSafeInteger(row.limit) ||
      row.limit < 1 ||
      row.limit > 100
    )
      throw new TypeError('Handoff limit must be 1..100');
    result.limit = row.limit;
  }
  if (row.cursor !== undefined) {
    parseHandoffRegistryCursor(row.cursor);
    result.cursor = row.cursor as string;
  }
  return result;
}

export function parseHandoffRegistryPosition(value: unknown): HandoffRegistryPosition {
  const row = object(value);
  if (!isUlid(row.handoff_id)) throw new TypeError('Invalid handoff ID');
  return { handoff_id: row.handoff_id, updated_at: time(row.updated_at) };
}
/** An explicit page position and query binding, never an authorization credential. */
export function encodeHandoffRegistryCursor(key: string, value: HandoffRegistryPosition): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Invalid handoff cursor key');
  const position = parseHandoffRegistryPosition(value);
  return btoa(JSON.stringify([1, key, position.updated_at, position.handoff_id]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function parseHandoffRegistryCursor(
  value: unknown,
): HandoffRegistryPosition & { key: string } {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(value))
    throw new TypeError('Invalid handoff cursor');
  const raw = value.replace(/-/g, '+').replace(/_/g, '/');
  const parsed: unknown = JSON.parse(atob(raw + '='.repeat((4 - (raw.length % 4)) % 4)));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 4 ||
    parsed[0] !== 1 ||
    typeof parsed[1] !== 'string'
  )
    throw new TypeError('Invalid handoff cursor');
  const position = parseHandoffRegistryPosition({ updated_at: parsed[2], handoff_id: parsed[3] });
  if (encodeHandoffRegistryCursor(parsed[1], position) !== value)
    throw new TypeError('Noncanonical handoff cursor');
  return { ...position, key: parsed[1] };
}
export function handoffRegistryPending(row: Pick<HandoffRegistryRecord, 'status'>): boolean {
  return row.status === 'open' || row.status === 'offered';
}

export function parseHandoffRegistryRecord(value: unknown): HandoffRegistryRecord {
  const row = object(value);
  only(row, [
    'handoff_id',
    'session_id',
    'checkpoint_id',
    'status',
    'origin',
    'from_client',
    'offered_to',
    'claimed_by',
    'claimed_by_actor',
    'version',
    'created_at',
    'updated_at',
    'summary',
    'summary_state',
    'recipient_matches',
    'claimed_here',
  ]);
  const position = parseHandoffRegistryPosition(row);
  if (typeof row.status !== 'string') throw new TypeError('Invalid handoff status');
  if (!isUlid(row.session_id) || !isUlid(row.checkpoint_id))
    throw new TypeError('Invalid handoff references');
  const from_client = row.from_client === null ? null : text(row.from_client);
  const offered_to = row.offered_to === null ? null : text(row.offered_to);
  const claimed_by = row.claimed_by === null ? null : text(row.claimed_by);
  const claimed_by_actor = row.claimed_by_actor === null ? null : text(row.claimed_by_actor);
  if (row.origin === 'session') {
    if (
      !from_client ||
      !['open', 'claimed', 'expired'].includes(String(row.status)) ||
      typeof row.version !== 'number' ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1 ||
      (row.status === 'open' &&
        (row.version !== 1 || claimed_by !== null || claimed_by_actor !== null)) ||
      (row.status !== 'open' && row.version < 2) ||
      (row.status === 'claimed' && claimed_by === null) ||
      (claimed_by_actor !== null && claimed_by === null) ||
      (offered_to !== null && claimed_by !== null && offered_to !== claimed_by)
    )
      throw new TypeError('Invalid current handoff ownership');
  } else if (row.origin === 'projection') {
    if (
      !['offered', 'accepted', 'expired', 'rejected'].includes(String(row.status)) ||
      row.version !== null ||
      from_client !== null ||
      claimed_by !== null ||
      claimed_by_actor !== null
    )
      throw new TypeError('Invalid historical handoff projection');
  } else throw new TypeError('Invalid handoff origin');
  let summary: string | null = null;
  if (row.summary_state === 'available') {
    if (
      typeof row.summary !== 'string' ||
      /[\u0000\p{Cs}]/u.test(row.summary) ||
      new TextEncoder().encode(row.summary).byteLength > HANDOFF_REGISTRY_SUMMARY_BYTES
    )
      throw new TypeError('Invalid handoff summary');
    summary = row.summary;
  } else if (
    (row.summary_state !== 'missing' && row.summary_state !== 'too-large') ||
    row.summary !== null
  )
    throw new TypeError('Invalid summary availability');
  return {
    ...position,
    session_id: row.session_id,
    checkpoint_id: row.checkpoint_id,
    origin: row.origin,
    status: row.status as HandoffRegistryRecord['status'],
    from_client,
    offered_to,
    claimed_by,
    claimed_by_actor,
    version: row.version as number | null,
    created_at: time(row.created_at),
    summary,
    summary_state: row.summary_state as HandoffRegistryRecord['summary_state'],
  };
}

export function parseHandoffRegistryPage(
  value: unknown,
  input: HandoffRegistryQuery = {},
): HandoffRegistryPage {
  const row = object(value);
  const query = parseHandoffRegistryQuery(input);
  const limit = query.limit ?? 25;
  if (
    new TextEncoder().encode(JSON.stringify(row)).byteLength > HANDOFF_REGISTRY_RESPONSE_BYTES ||
    !Array.isArray(row.data) ||
    row.data.length > limit ||
    typeof row.has_more !== 'boolean'
  )
    throw new TypeError('Invalid handoff page');
  let previous: HandoffRegistryPosition | undefined = query.cursor
    ? parseHandoffRegistryCursor(query.cursor)
    : undefined;
  const ids = new Set<string>();
  const data = row.data.map((raw) => {
    const item = parseHandoffRegistryRecord(raw);
    if (
      ids.has(item.handoff_id) ||
      (previous &&
        !(
          item.updated_at < previous.updated_at ||
          (item.updated_at === previous.updated_at && item.handoff_id > previous.handoff_id)
        )) ||
      (query.session_id && item.session_id !== query.session_id) ||
      (query.origin && item.origin !== query.origin) ||
      (query.status && handoffRegistryPending(item) !== (query.status === 'open'))
    )
      throw new TypeError('Handoff page does not match the requested order or filters');
    ids.add(item.handoff_id);
    previous = item;
    return item;
  });
  if (!row.has_more) {
    if (row.next_cursor !== undefined) throw new TypeError('Unexpected handoff continuation');
    return { data, has_more: false };
  }
  const next = parseHandoffRegistryCursor(row.next_cursor);
  const last = data[data.length - 1];
  if (
    !last ||
    data.length !== limit ||
    last.handoff_id !== next.handoff_id ||
    last.updated_at !== next.updated_at ||
    row.next_cursor === query.cursor ||
    (query.cursor && next.key !== parseHandoffRegistryCursor(query.cursor).key)
  )
    throw new TypeError('Invalid handoff continuation');
  return { data, has_more: true, next_cursor: row.next_cursor as string };
}

export function parseHandoffRegistryEnvelope(
  value: unknown,
  query: HandoffRegistryQuery,
  scope: HandoffRegistryScope,
  trace: string,
): HandoffRegistryEnvelope {
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
    'handoff_permissions',
    'session_identity',
  ]);
  if (row.schema_version !== 1 || text(row.trace_id, 512) !== trace)
    throw new TypeError('Invalid handoff envelope');
  const returned = object(row.scope);
  only(returned, ['tenant_id', 'workspace_id', 'project_id']);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (text(returned[field]) !== scope[field]) throw new TypeError('Handoff scope mismatch');
  const source_refs = HANDOFF_REGISTRY_SOURCES.map((id) => ({ type: 'postgres', id }));
  if (
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== source_refs.length ||
    row.source_refs.some((raw, index) => {
      const ref = object(raw);
      only(ref, ['type', 'id']);
      return ref.type !== 'postgres' || ref.id !== source_refs[index]?.id;
    })
  )
    throw new TypeError('Invalid handoff sources');
  const identity =
    row.session_identity === undefined
      ? undefined
      : parseSessionCommandIdentity(row.session_identity);
  if (identity)
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (identity[field] !== scope[field]) throw new TypeError('Handoff reader scope mismatch');
  const session = object(row.session_permissions);
  const handoff = object(row.handoff_permissions);
  only(session, ['write_sessions']);
  only(handoff, ['write_sessions', 'claim']);
  if (
    typeof session.write_sessions !== 'boolean' ||
    handoff.write_sessions !== session.write_sessions ||
    typeof handoff.claim !== 'boolean' ||
    (session.write_sessions && !handoff.claim) ||
    ((session.write_sessions || handoff.claim) && !identity)
  )
    throw new TypeError('Invalid handoff permissions');
  const page = parseHandoffRegistryPage(row, query);
  const data = page.data.map((item, index) => {
    const raw = object((row.data as unknown[])[index]);
    const recipient_matches =
      !!identity &&
      item.origin === 'session' &&
      (item.offered_to === null || item.offered_to === identity.client_id);
    const claimed_here =
      !!identity &&
      item.origin === 'session' &&
      item.claimed_by === identity.client_id &&
      item.claimed_by_actor === identity.actor_id;
    if (raw.recipient_matches !== recipient_matches || raw.claimed_here !== claimed_here)
      throw new TypeError('Handoff ownership hints do not match reader');
    return { ...item, recipient_matches, claimed_here };
  });
  return {
    schema_version: 1,
    trace_id: trace,
    scope: {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
    },
    source_refs,
    ...page,
    data,
    session_permissions: { write_sessions: session.write_sessions },
    handoff_permissions: { write_sessions: session.write_sessions, claim: handoff.claim },
    ...(identity ? { session_identity: identity } : {}),
  };
}
