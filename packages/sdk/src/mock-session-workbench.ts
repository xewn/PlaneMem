import {
  CHECKPOINT_REGISTRY_SOURCE,
  CHECKPOINT_REGISTRY_SUMMARY_BYTES,
  HANDOFF_REGISTRY_SOURCES,
  HANDOFF_REGISTRY_SUMMARY_BYTES,
  SESSION_REGISTRY_SOURCES,
  encodeCheckpointRegistryCursor,
  encodeHandoffRegistryCursor,
  encodeSessionRegistryCursor,
  parseCheckpointHistoryQuery,
  parseCheckpointHistoryWorkbenchEnvelope,
  parseCheckpointRegistryCursor,
  parseCheckpointRegistryEnvelope,
  parseCheckpointRegistryQuery,
  parseHandoffRegistryCursor,
  parseHandoffRegistryEnvelope,
  parseHandoffRegistryQuery,
  parseSessionRegistryCursor,
  parseSessionRegistryEnvelope,
  parseSessionRegistryQuery,
  parseSessionStateEnvelope,
  parseSessionStateQuery,
  type CheckpointSavedRecord,
  type CheckpointRegistryRecord,
  type HandoffRegistryRecord,
  type SessionRegistryRecord,
  type SessionMutationScope,
  type SessionMutationSession,
} from '@planemem/contracts';
import type { WcpRequest } from './client.js';
import type { MockSessionAccess, MockSessionStored } from './mock-sessions.js';
import { readMockCheckpointHistory } from './mock-session-continuity.js';
import { envelope, fail, fingerprint, object } from './mock-session-json.js';

interface Context {
  request: WcpRequest;
  store_id: string;
  scope: SessionMutationScope;
  access: MockSessionAccess;
  trace: string;
  session(id: string): SessionMutationSession;
  values(): IterableIterator<MockSessionStored>;
  visibility(): 'all' | string[];
  output(value: unknown): unknown;
  check(): void;
}
type CheckpointRow = Extract<MockSessionStored, { kind: 'checkpoint' }>;
type Position = { time: string; id: string };
type PageQuery = { limit?: number; cursor?: string };

/** Select only our operations without evaluating a caller-supplied operation getter. */
export function isMockSessionWorkbenchRequest(request: WcpRequest): boolean {
  if (
    typeof request.path !== 'string' ||
    request.path.split('?')[0] !== '/v1/workbench/query' ||
    !request.body ||
    typeof request.body !== 'object' ||
    Array.isArray(request.body)
  )
    return false;
  const property = Object.getOwnPropertyDescriptor(request.body, 'operation');
  return (
    !!property &&
    'value' in property &&
    ['sessions', 'session', 'handoffs', 'checkpoints'].includes(property.value)
  );
}

function metadata(c: Context) {
  return {
    session_identity: c.access.identity,
    session_permissions: { write_sessions: c.access.permissions.write_sessions },
  };
}
function micros(value: string): string {
  // Stored Mock writes have millisecond precision. Padding adds no invented precision.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError();
  return value.slice(0, -1) + '000Z';
}
function firstNote(checkpoint: CheckpointSavedRecord): string | null {
  // Match COALESCE(next_actions[0], in_progress[0], completed[0]); empty text is retained.
  return checkpoint.next_actions[0] ?? checkpoint.in_progress[0] ?? checkpoint.completed[0] ?? null;
}
function summary(value: string | null, maximum: number) {
  if (value === null) return { summary: null, summary_state: 'missing' as const };
  if (new TextEncoder().encode(value).byteLength > maximum)
    return { summary: null, summary_state: 'too-large' as const };
  return { summary: value, summary_state: 'available' as const };
}
function matches(query: string | undefined, fields: Array<string | number | null>): boolean {
  // Literal substring search, not tokenization or wildcard matching. No database collation claim.
  return (
    !query ||
    fields
      .filter((field) => field !== null)
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase())
  );
}
function compare(a: Position, b: Position): number {
  return a.time !== b.time ? (a.time > b.time ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function page<T>(
  rows: T[],
  query: PageQuery,
  key: string,
  position: (row: T) => Position,
  decode: (cursor: string) => Position & { key: string },
  encode: (key: string, last: T) => string,
) {
  const before = query.cursor === undefined ? undefined : decode(query.cursor);
  if (before && before.key !== key) throw new TypeError();
  const limit = query.limit ?? 25;
  const selected = rows.filter((row) => !before || compare(position(row), before) > 0);
  selected.sort((a, b) => compare(position(a), position(b)));
  const data = selected.slice(0, limit);
  const has_more = selected.length > limit;
  return { data, has_more, ...(has_more ? { next_cursor: encode(key, data.at(-1)!) } : {}) };
}

async function cursorKey(
  c: Context,
  operation: string,
  query: PageQuery,
  visibility: 'all' | string[],
) {
  const { cursor: _cursor, ...filters } = query;
  const binding = fingerprint({
    format: 'mock-session-workbench-v1',
    store: c.store_id,
    scope: c.scope,
    identity: c.access.identity,
    expires_at: c.access.expires_at,
    permissions: c.access.permissions,
    project_readable: c.access.project_readable,
    visibility,
    operation,
    filters: { ...filters, limit: query.limit ?? 25 },
  });
  let key: string;
  try {
    c.check();
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(binding),
    );
    if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
    key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    c.check();
    return fail('GATEWAY_UNAVAILABLE', c.trace);
  }
  c.check();
  // A concurrent start/resume can grant a new visible ID while the digest is pending.
  // Do not issue a page whose visibility no longer matches its continuation binding.
  if (JSON.stringify(c.visibility()) !== JSON.stringify(visibility)) fail('INVALID_INPUT', c.trace);
  return key;
}

function currentRows(c: Context, visibility: 'all' | string[]) {
  const allowed = visibility === 'all' ? undefined : new Set(visibility);
  const sessions = new Map<string, SessionMutationSession>();
  const checkpoints = new Map<string, CheckpointRow>();
  const latest = new Map<string, CheckpointRow>();
  const runs = new Map<string, number>();
  const tools = new Map<string, number>();
  const handoffs: Array<Extract<MockSessionStored, { kind: 'handoff' }>['value']> = [];
  // All records are read synchronously after the cursor digest; no mixed pre/post-await state.
  for (const row of c.values()) {
    if (row.kind === 'session' && (!allowed || allowed.has(row.value.session_id)))
      sessions.set(row.value.session_id, row.value);
  }
  for (const row of c.values()) {
    if (!('value' in row) || !sessions.has(row.value.session_id)) continue;
    if (row.kind === 'checkpoint') {
      checkpoints.set(row.value.checkpoint_id, row);
      if ((latest.get(row.value.session_id)?.value.revision ?? 0) < row.value.revision)
        latest.set(row.value.session_id, row);
    } else if (row.kind === 'run') {
      runs.set(row.value.session_id, (runs.get(row.value.session_id) ?? 0) + 1);
    } else if (row.kind === 'tool') {
      tools.set(row.value.session_id, (tools.get(row.value.session_id) ?? 0) + 1);
    } else if (row.kind === 'handoff') {
      handoffs.push(row.value);
    }
  }
  return { sessions, checkpoints, latest, runs, tools, handoffs };
}
function directory(c: Context, sources: readonly string[], content: object) {
  return {
    schema_version: 1 as const,
    trace_id: c.trace,
    // Required protocol labels identify simulated projections, not real PostgreSQL reads.
    source_refs: sources.map((id) => ({ type: 'postgres', id })),
    scope: c.scope,
    ...content,
    ...metadata(c),
  };
}
function validated<T>(c: Context, code: string, read: () => T): T {
  try {
    return read();
  } catch {
    c.check();
    return fail(code, c.trace);
  }
}

export async function readMockSessionWorkbench(c: Context): Promise<unknown> {
  if (c.request.method !== 'POST' || c.request.path !== '/v1/workbench/query')
    fail('MOCK_ROUTE_NOT_FOUND', c.trace);
  if (
    [
      'idempotency-key',
      'if-match',
      'if-match-version',
      'x-expected-version',
      'if-none-match',
      'if-modified-since',
      'if-unmodified-since',
      'range',
      'if-range',
      'content-encoding',
      'transfer-encoding',
      'content-length',
    ].some((name) => c.request.headers[name] !== undefined)
  )
    throw new TypeError();
  c.check();
  if (!c.access.permissions.read_sessions) fail('DENIED', c.trace);
  const { operation, ...input } = object(c.request.body);
  if (operation === 'session') {
    const query = parseSessionStateQuery(input);
    const row = c.session(query.session_id);
    const parsed = parseSessionStateEnvelope(
      {
        ...envelope(
          {
            session_id: row.session_id,
            status: row.status,
            version: row.version,
            ended_at: row.ended_at ?? null,
          },
          c.trace,
          [{ type: 'session', id: row.session_id }],
        ),
        ...c.scope,
        ...metadata(c),
      },
      query.session_id,
      c.scope,
      c.trace,
      c.access.identity,
    );
    // The existing workbench POST omits the top-level scope of the dedicated GET.
    const {
      tenant_id: _tenant,
      workspace_id: _workspace,
      project_id: _project,
      ...result
    } = parsed;
    return c.output(result);
  }
  if (operation === 'checkpoints' && input.session_id !== undefined) {
    const query = parseCheckpointHistoryQuery(input);
    c.session(query.session_id);
    return c.output(
      parseCheckpointHistoryWorkbenchEnvelope(
        {
          ...readMockCheckpointHistory(c.values(), query, c.scope, c.trace),
          ...metadata(c),
        },
        query,
        c.scope,
        c.trace,
      ),
    );
  }
  if (!c.access.project_readable) fail('DENIED', c.trace);
  const visibility = c.visibility();
  if (operation === 'sessions') {
    const query = parseSessionRegistryQuery(input);
    const key = await cursorKey(c, operation, query, visibility);
    const rows = currentRows(c, visibility);
    const data: SessionRegistryRecord[] = [];
    for (const session of rows.sessions.values()) {
      if (
        (query.status && session.status !== query.status) ||
        (query.client_id && session.client_id !== query.client_id) ||
        !matches(query.query, [
          session.session_id,
          session.client_id,
          session.actor_id,
          session.trace_id,
        ])
      )
        continue;
      const checkpoint = rows.latest.get(session.session_id)?.value;
      data.push({
        session_id: session.session_id,
        client_id: session.client_id,
        actor_id: session.actor_id,
        parent_session_id: session.parent_session_id ?? null,
        resume_origin: session.resume_origin ?? null,
        status: session.status,
        version: session.version,
        started_at: micros(session.started_at),
        ended_at: session.ended_at ?? null,
        trace_id: session.trace_id,
        run_count: rows.runs.get(session.session_id) ?? 0,
        tool_call_count: rows.tools.get(session.session_id) ?? 0,
        checkpoint_id: checkpoint?.checkpoint_id ?? null,
        checkpoint_revision: checkpoint?.revision ?? null,
      });
    }
    const result = page(
      data,
      query,
      key,
      (row) => ({ time: row.started_at, id: row.session_id }),
      (cursor) => {
        const row = parseSessionRegistryCursor(cursor);
        return { time: row.started_at, id: row.session_id, key: row.key };
      },
      encodeSessionRegistryCursor,
    );
    return c.output(
      validated(c, 'SESSION_REGISTRY_INVALID', () =>
        parseSessionRegistryEnvelope(
          directory(c, SESSION_REGISTRY_SOURCES, result),
          query,
          c.scope,
          c.trace,
        ),
      ),
    );
  }
  if (operation === 'handoffs') {
    const query = parseHandoffRegistryQuery(input);
    const key = await cursorKey(c, operation, query, visibility);
    const rows = currentRows(c, visibility);
    const data: Array<
      HandoffRegistryRecord & { recipient_matches: boolean; claimed_here: boolean }
    > = [];
    for (const handoff of rows.handoffs) {
      const checkpoint = rows.checkpoints.get(handoff.checkpoint_id)?.value;
      if (!checkpoint || checkpoint.session_id !== handoff.session_id)
        fail('HANDOFF_REGISTRY_INVALID', c.trace);
      const note = firstNote(checkpoint);
      if (
        query.origin === 'projection' ||
        (query.session_id && query.session_id !== handoff.session_id) ||
        (query.status && (handoff.status === 'open') !== (query.status === 'open')) ||
        !matches(query.query, [
          handoff.handoff_id,
          handoff.session_id,
          handoff.checkpoint_id,
          handoff.target_client ?? null,
          handoff.claimed_by ?? null,
          handoff.claimed_by_actor ?? null,
          note,
        ])
      )
        continue;
      data.push({
        handoff_id: handoff.handoff_id,
        session_id: handoff.session_id,
        checkpoint_id: handoff.checkpoint_id,
        status: handoff.status,
        origin: 'session',
        from_client: handoff.from_client,
        offered_to: handoff.target_client ?? null,
        claimed_by: handoff.claimed_by ?? null,
        claimed_by_actor: handoff.claimed_by_actor ?? null,
        version: handoff.version,
        created_at: micros(handoff.created_at),
        updated_at: micros(handoff.updated_at),
        ...summary(note, HANDOFF_REGISTRY_SUMMARY_BYTES),
        recipient_matches:
          handoff.target_client === undefined ||
          handoff.target_client === c.access.identity.client_id,
        claimed_here:
          handoff.claimed_by === c.access.identity.client_id &&
          handoff.claimed_by_actor === c.access.identity.actor_id,
      });
    }
    const result = page(
      data,
      query,
      key,
      (row) => ({ time: row.updated_at, id: row.handoff_id }),
      (cursor) => {
        const row = parseHandoffRegistryCursor(cursor);
        return { time: row.updated_at, id: row.handoff_id, key: row.key };
      },
      encodeHandoffRegistryCursor,
    );
    return c.output(
      validated(c, 'HANDOFF_REGISTRY_INVALID', () =>
        parseHandoffRegistryEnvelope(
          {
            ...directory(c, HANDOFF_REGISTRY_SOURCES, result),
            handoff_permissions: {
              write_sessions: c.access.permissions.write_sessions,
              claim: c.access.permissions.claim_handoffs,
            },
          },
          query,
          c.scope,
          c.trace,
        ),
      ),
    );
  }
  if (operation === 'checkpoints') {
    const query = parseCheckpointRegistryQuery(input);
    const key = await cursorKey(c, operation, query, visibility);
    const rows = currentRows(c, visibility);
    const data: CheckpointRegistryRecord[] = [];
    for (const row of rows.checkpoints.values()) {
      const checkpoint = row.value;
      const note = firstNote(checkpoint);
      if (
        (query.checkpoint_id && query.checkpoint_id !== checkpoint.checkpoint_id) ||
        !matches(query.query, [
          checkpoint.checkpoint_id,
          checkpoint.session_id,
          checkpoint.revision,
          note,
        ])
      )
        continue;
      data.push({
        checkpoint_id: checkpoint.checkpoint_id,
        session_id: checkpoint.session_id,
        revision: checkpoint.revision,
        created_at: micros(row.created_at),
        ...summary(note, CHECKPOINT_REGISTRY_SUMMARY_BYTES),
      });
    }
    const result = page(
      data,
      query,
      key,
      (row) => ({ time: row.created_at, id: row.checkpoint_id }),
      (cursor) => {
        const row = parseCheckpointRegistryCursor(cursor);
        return { time: row.created_at, id: row.checkpoint_id, key: row.key };
      },
      encodeCheckpointRegistryCursor,
    );
    return c.output(
      validated(c, 'CHECKPOINT_REGISTRY_INVALID', () =>
        parseCheckpointRegistryEnvelope(
          directory(c, [CHECKPOINT_REGISTRY_SOURCE], result),
          query,
          c.scope,
          c.trace,
        ),
      ),
    );
  }
  return fail('MOCK_ROUTE_NOT_FOUND', c.trace);
}
