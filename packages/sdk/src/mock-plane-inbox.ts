import {
  ContractError,
  createUlid,
  isUlid,
  describePlaneInboxVersionPosition,
  parsePlaneInboxIdentity,
  parsePlaneInboxListQuery,
  parsePlaneInboxRecord,
  parsePlaneInboxPage,
  parsePlaneInboxSummary,
  parsePlaneInboxDiagnosis,
  parsePlaneInboxRetryQuery,
  parsePlaneInboxRetryReceipt,
  parsePlaneInboxRetryLookup,
  syncJsonSnapshot,
  type Classification,
  type ObservedScope,
  type PlaneInboxIdentity,
  type PlaneInboxRecord,
  type PlaneInboxRetryReceipt,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

/** Committed stream metadata is independent of inbox status and receipt visibility. */
export type MockPlaneInboxCommittedEvent = Pick<
  PlaneInboxRecord,
  'event_id' | 'aggregate_type' | 'aggregate_id' | 'aggregate_version'
> & { event_type: string };

export interface MockPlaneInboxSeed {
  scope: ObservedScope;
  project_classification: Classification;
  events: Array<{
    /** Classification must include the current index classification, if any. */
    record: PlaneInboxRecord;
    /** Explicit simulated immutable-event validity; no payload or signature is inspected. */
    event_valid: boolean;
  }>;
  committed_events: MockPlaneInboxCommittedEvent[];
}

/** Fixed simulation authority. Request headers can constrain it, never grant permissions. */
export interface MockPlaneInboxSession {
  identity: PlaneInboxIdentity;
  expires_at: string;
  authenticated_client: boolean;
  admin_role: boolean;
  human_actor: boolean;
  read_admin: boolean;
  retry_plane: boolean;
  project_readable: boolean;
  read_restricted: boolean;
  visible_event_ids: string[];
}

type Session = MockPlaneInboxSession & { visible: Set<string> };
type Item = MockPlaneInboxSeed['events'][number];
type ListQuery = ReturnType<typeof parsePlaneInboxListQuery>;
type RetryQuery = ReturnType<typeof parsePlaneInboxRetryQuery>;
type Route =
  | { kind: 'list'; query: ListQuery }
  | { kind: 'summary' }
  | { kind: 'read'; id: string }
  | { kind: 'diagnosis'; id: string }
  | { kind: 'retry'; query: RetryQuery }
  | { kind: 'receipt'; query: RetryQuery };
type Commit = { item: Item; key: string; receipt: PlaneInboxRetryReceipt; bytes: number };
const seedBytes = 16 * 1024 * 1024;
const responseBytes = 2 * 1024 * 1024;
const configurationTrace = 'trace_mock_plane_inbox_configuration';
const classifications = ['public', 'internal', 'confidential', 'restricted'] as const;
const permissions = [
  'authenticated_client',
  'admin_role',
  'human_actor',
  'read_admin',
  'retry_plane',
  'project_readable',
  'read_restricted',
] as const;
const eventTypes = {
  project: ['ProjectCreated', 'ProjectUpdated'],
  work_item: [
    'WorkItemCreated',
    'WorkItemUpdated',
    'WorkItemStatusConfirmed',
    'WorkItemDeleted',
    'WorkItemRestored',
  ],
};
const messages = {
  MOCK_PLANE_INBOX_CONFIGURATION_INVALID:
    'Supply a bounded inbox dataset and explicit simulated access',
  MOCK_PLANE_INBOX_CAPACITY: 'The simulated original retry receipt ledger is full',
  MOCK_ROUTE_NOT_FOUND: 'Mock inbox route or method not found',
  INVALID_INPUT: 'Supply valid inbox filters or the original retry command and identity',
  UNAUTHENTICATED: 'The simulated session has expired',
  DENIED: 'The simulated identity or permissions do not allow this inbox operation',
  NOT_FOUND: 'The event is unavailable in this simulated project',
  PLANE_INBOX_INVALID: 'The simulated inbox metadata or immutable event is invalid',
  PLANE_INBOX_UNAVAILABLE: 'The simulated inbox cursor could not be calculated',
  PLANE_INBOX_REVISION_CONFLICT: 'The queue revision changed; read the event again',
  PLANE_INBOX_STATE_CONFLICT: 'An applied event cannot be scheduled again',
  IDEMPOTENCY_KEY_REUSED: 'The original retry key belongs to another command',
  GATEWAY_RESPONSE_INVALID:
    'The complete simulated response exceeds its representation or size limit',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the simulated inbox operation',
  GATEWAY_REQUEST_TIMEOUT: 'The simulated inbox operation exceeded its deadline',
  RATE_LIMITED: 'Simulated inbox capacity is occupied',
} as const;
type Code = keyof typeof messages;
function fail(code: Code, trace: string): never {
  throw new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}
function checked<T>(code: Code, trace: string, read: () => T): T {
  try {
    return read();
  } catch {
    return fail(code, trace);
  }
}
function snapshot(value: unknown, maximum: number): unknown {
  return JSON.parse(syncJsonSnapshot(value, maximum));
}
function record(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError();
  return row;
}
function time(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    value.startsWith('0000') ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError();
  return value;
}
function encodeCursor(key: string, before: string): string {
  // Both components are validated ASCII; no arbitrary Unicode text is encoded here.
  return btoa(JSON.stringify([1, key, before]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decodeCursor(cursor: string, key: string): string {
  const base = cursor.replace(/-/g, '+').replace(/_/g, '/');
  const parts: unknown = JSON.parse(atob(base + '='.repeat((4 - (base.length % 4)) % 4)));
  if (
    !Array.isArray(parts) ||
    parts.length !== 3 ||
    parts[0] !== 1 ||
    parts[1] !== key ||
    !isUlid(parts[2]) ||
    encodeCursor(key, parts[2]) !== cursor
  )
    throw new TypeError();
  return parts[2];
}
function sameStream(a: MockPlaneInboxCommittedEvent | PlaneInboxRecord, b: PlaneInboxRecord) {
  return a.aggregate_type === b.aggregate_type && a.aggregate_id === b.aggregate_id;
}
function sameEvent(a: MockPlaneInboxCommittedEvent, b: PlaneInboxRecord) {
  return (
    sameStream(a, b) &&
    a.event_id === b.event_id &&
    a.aggregate_version === b.aggregate_version &&
    a.event_type === b.event_type
  );
}
export function isMockPlaneInboxPath(path: unknown): path is string {
  return typeof path === 'string' && /^\/v1\/plane\/events(?:[/?#]|$)/.test(path);
}

/** In-memory scheduling only; this store never executes a worker or changes observations. */
export class MockPlaneInboxStore {
  readonly #id = createUlid();
  readonly #scope: ObservedScope;
  readonly #items: Map<string, Item>;
  readonly #committed: MockPlaneInboxCommittedEvent[];
  readonly #receipts = new Map<string, PlaneInboxRetryReceipt>();
  #receiptBytes = 0;
  #active = 0;

  constructor(seed: MockPlaneInboxSeed) {
    const saved = checked('MOCK_PLANE_INBOX_CONFIGURATION_INVALID', configurationTrace, () => {
      const raw = record(snapshot(seed, seedBytes), [
        'scope',
        'project_classification',
        'events',
        'committed_events',
      ]);
      const scopeRow = record(raw.scope, ['tenant_id', 'workspace_id', 'project_id']);
      const identity = parsePlaneInboxIdentity({
        ...scopeRow,
        actor_id: 'mock',
        client_id: 'mock',
      });
      const scope: ObservedScope = {
        tenant_id: identity.tenant_id,
        workspace_id: identity.workspace_id,
        project_id: identity.project_id,
      };
      const parent = classifications.indexOf(raw.project_classification as Classification);
      if (
        parent < 0 ||
        !Array.isArray(raw.events) ||
        raw.events.length > 1000 ||
        !Array.isArray(raw.committed_events) ||
        raw.committed_events.length > 1000
      )
        throw new TypeError();
      const items = new Map<string, Item>();
      for (const value of raw.events) {
        const item = record(value, ['record', 'event_valid']);
        const data = parsePlaneInboxRecord(item.record, scope);
        if (
          typeof item.event_valid !== 'boolean' ||
          items.has(data.event_id) ||
          (item.event_valid && data.event_type === null)
        )
          throw new TypeError();
        data.classification =
          classifications[Math.max(parent, classifications.indexOf(data.classification))]!;
        items.set(data.event_id, { record: data, event_valid: item.event_valid });
      }
      const ids = new Set<string>();
      const committed = raw.committed_events.map((value): MockPlaneInboxCommittedEvent => {
        const event = record(value, [
          'event_id',
          'event_type',
          'aggregate_type',
          'aggregate_id',
          'aggregate_version',
        ]);
        if (
          !isUlid(event.event_id) ||
          !isUlid(event.aggregate_id) ||
          ids.has(event.event_id) ||
          (event.aggregate_type !== 'project' && event.aggregate_type !== 'work_item') ||
          typeof event.event_type !== 'string' ||
          !eventTypes[event.aggregate_type].includes(event.event_type) ||
          typeof event.aggregate_version !== 'string' ||
          !/^[1-9][0-9]{0,15}$/.test(event.aggregate_version) ||
          BigInt(event.aggregate_version) > BigInt(Number.MAX_SAFE_INTEGER)
        )
          throw new TypeError();
        const result: MockPlaneInboxCommittedEvent = {
          event_id: event.event_id,
          event_type: event.event_type,
          aggregate_type: event.aggregate_type,
          aggregate_id: event.aggregate_id,
          aggregate_version: event.aggregate_version,
        };
        const receipt = items.get(result.event_id);
        if (receipt && !sameEvent(result, receipt.record)) throw new TypeError();
        ids.add(result.event_id);
        return result;
      });
      return { scope, items, committed };
    });
    this.#scope = saved.scope;
    this.#items = saved.items;
    this.#committed = saved.committed;
  }

  connect(input: MockPlaneInboxSession): WcpTransport {
    const session = checked(
      'MOCK_PLANE_INBOX_CONFIGURATION_INVALID',
      configurationTrace,
      (): Session => {
        const raw = record(snapshot(input, 1024 * 1024), [
          'identity',
          'expires_at',
          ...permissions,
          'visible_event_ids',
        ]);
        const identity = parsePlaneInboxIdentity(raw.identity);
        for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (identity[key] !== this.#scope[key]) throw new TypeError();
        for (const key of permissions) if (typeof raw[key] !== 'boolean') throw new TypeError();
        if (!Array.isArray(raw.visible_event_ids) || raw.visible_event_ids.length > 1000)
          throw new TypeError();
        const visible = new Set<string>();
        for (const id of raw.visible_event_ids) {
          if (typeof id !== 'string' || !this.#items.has(id) || visible.has(id))
            throw new TypeError();
          visible.add(id);
        }
        return {
          identity,
          expires_at: time(raw.expires_at),
          visible,
          visible_event_ids: [...visible].sort(),
          authenticated_client: raw.authenticated_client as boolean,
          admin_role: raw.admin_role as boolean,
          human_actor: raw.human_actor as boolean,
          read_admin: raw.read_admin as boolean,
          retry_plane: raw.retry_plane as boolean,
          project_readable: raw.project_readable as boolean,
          read_restricted: raw.read_restricted as boolean,
        };
      },
    );
    return {
      request: async <T = unknown>(request: WcpRequest): Promise<T> =>
        (await this.respond(request, session)) as T,
    };
  }

  private visible(session: Session, now: string): PlaneInboxRecord[] {
    if (!session.project_readable) return [];
    return [...this.#items.values()]
      .filter(
        ({ record: row }) =>
          session.visible.has(row.event_id) &&
          (session.read_restricted || row.classification !== 'restricted'),
      )
      .map(({ record: row }) => ({ ...row, checked_at: now }));
  }

  private summary(rows: PlaneInboxRecord[], now: string) {
    const pending = rows.filter((row) => row.status === 'pending');
    const due = pending.filter((row) => Date.parse(row.next_attempt_at!) <= Date.parse(now));
    const chronological = (a: string, b: string) => Date.parse(a) - Date.parse(b);
    const first = (values: Array<string | null>) =>
      values.filter((value): value is string => value !== null).sort(chronological)[0] ?? null;
    return parsePlaneInboxSummary(
      {
        schema_version: 1,
        scope: this.#scope,
        checked_at: now,
        counts: {
          total: String(rows.length),
          pending: String(pending.length),
          applied: String(rows.filter((row) => row.status === 'applied').length),
          rejected: String(rows.filter((row) => row.status === 'rejected').length),
          due: String(due.length),
          delayed: String(pending.length - due.length),
          version_gap: String(
            pending.filter((row) => row.last_error_code === 'AGGREGATE_VERSION_GAP').length,
          ),
        },
        oldest_pending_received_at: first(pending.map((row) => row.received_at)),
        oldest_due_received_at: first(due.map((row) => row.received_at)),
        earliest_pending_attempt_at: first(pending.map((row) => row.next_attempt_at)),
        latest_received_at:
          rows
            .map((row) => row.received_at)
            .sort(chronological)
            .at(-1) ?? null,
      },
      this.#scope,
    );
  }

  private diagnosis(target: PlaneInboxRecord, rows: PlaneInboxRecord[]) {
    const related = rows
      .filter((row) => sameStream(row, target))
      .sort((a, b) => (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0));
    const latest = this.#committed
      .filter((event) => sameStream(event, target))
      .sort((a, b) => {
        const av = BigInt(a.aggregate_version),
          bv = BigInt(b.aggregate_version);
        return av === bv ? (a.event_id < b.event_id ? -1 : 1) : av > bv ? -1 : 1;
      })
      .slice(0, 2);
    const tip = latest.filter((event) => event.aggregate_version === latest[0]!.aggregate_version);
    const matching = tip.map((event) =>
      related.find((row) => row.status === 'applied' && sameEvent(event, row)),
    );
    // A hidden/missing actual tip must never reveal an older visible baseline.
    const baseline = matching.every((row) => row !== undefined)
      ? (matching as PlaneInboxRecord[])
      : [];
    const comparison = describePlaneInboxVersionPosition(target, baseline);
    const candidates = (version: string | null, excludeTarget: boolean) => {
      const found = related.filter(
        (row) =>
          row.aggregate_version === version && (!excludeTarget || row.event_id !== target.event_id),
      );
      return { items: found.slice(0, 10), has_more: found.length > 10 };
    };
    return parsePlaneInboxDiagnosis(
      {
        schema_version: 1,
        record: target,
        baseline,
        ...comparison,
        next_version_candidates: candidates(comparison.next_version, false),
        same_version_candidates: candidates(target.aggregate_version, true),
      },
      this.#scope,
      target.event_id,
    );
  }

  private async listBinding(query: ListQuery, session: Session, trace: string, live: () => void) {
    try {
      const binding = JSON.stringify([
        'mock-plane-inbox-v1',
        this.#id,
        session.identity,
        session.expires_at,
        permissions.map((key) => session[key]),
        session.visible_event_ids,
        query.status,
        query.pending_state,
        query.aggregate_id ?? null,
        query.limit,
      ]);
      live();
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(binding),
      );
      live();
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    } catch {
      live();
      return fail('PLANE_INBOX_UNAVAILABLE', trace);
    }
  }

  private list(query: ListQuery, rows: PlaneInboxRecord[], binding: string, trace: string) {
    const before =
      query.cursor === undefined
        ? undefined
        : checked('INVALID_INPUT', trace, () => decodeCursor(query.cursor!, binding));
    const matched = rows
      .filter((row) => {
        if (
          (query.status !== 'all' && row.status !== query.status) ||
          (query.aggregate_id !== undefined && row.aggregate_id !== query.aggregate_id) ||
          (before !== undefined && row.event_id >= before)
        )
          return false;
        if (query.pending_state === 'all') return true;
        if (row.status !== 'pending') return false;
        if (query.pending_state === 'version_gap')
          return row.last_error_code === 'AGGREGATE_VERSION_GAP';
        const due = Date.parse(row.next_attempt_at!) <= Date.parse(row.checked_at);
        return query.pending_state === 'due' ? due : !due;
      })
      .sort((a, b) => (a.event_id > b.event_id ? -1 : a.event_id < b.event_id ? 1 : 0));
    const items = matched.slice(0, query.limit);
    return parsePlaneInboxPage(
      {
        scope: this.#scope,
        items,
        ...(matched.length > query.limit
          ? { next_cursor: encodeCursor(binding, items.at(-1)!.event_id) }
          : {}),
      },
      this.#scope,
      query,
    );
  }

  private retry(
    query: RetryQuery,
    lookup: boolean,
    current: PlaneInboxRecord,
    session: Session,
    trace: string,
  ): { data: unknown; commit?: Commit } {
    const { request_key, ...command } = query;
    if (!this.#items.get(command.event_id)!.event_valid) fail('PLANE_INBOX_INVALID', trace);
    const key = JSON.stringify([session.identity, request_key]);
    const original = this.#receipts.get(key);
    if (original && JSON.stringify(original.command) !== JSON.stringify(command))
      fail('IDEMPOTENCY_KEY_REUSED', trace);
    if (
      original &&
      (BigInt(current.revision) < BigInt(original.record.revision) ||
        BigInt(current.attempts) < BigInt(original.record.attempts) ||
        !sameStream(original.record, current) ||
        original.record.aggregate_version !== current.aggregate_version ||
        original.record.event_type !== current.event_type ||
        original.record.received_at !== current.received_at)
    )
      fail('PLANE_INBOX_INVALID', trace);
    if (original?.record.classification === 'restricted' && !session.read_restricted)
      fail('NOT_FOUND', trace);
    if (lookup)
      return {
        data: parsePlaneInboxRetryLookup(
          {
            identity: session.identity,
            request_key,
            command,
            ...(original ? { status: 'recorded', receipt: original } : { status: 'not-observed' }),
          },
          command,
          session.identity,
          request_key,
        ),
      };
    if (original)
      return {
        data: parsePlaneInboxRetryReceipt(original, command, session.identity, request_key),
      };
    if (current.revision !== command.expected_revision)
      fail('PLANE_INBOX_REVISION_CONFLICT', trace);
    if (current.status === 'applied') fail('PLANE_INBOX_STATE_CONFLICT', trace);
    const updated: PlaneInboxRecord = {
      ...current,
      status: 'pending',
      revision: String(BigInt(current.revision) + 1n),
      last_error_code: null,
      applied_at: null,
      updated_at: current.checked_at,
      next_attempt_at: current.checked_at,
    };
    const receipt = parsePlaneInboxRetryReceipt(
      {
        operation: 'plane.inbox.retry',
        identity: session.identity,
        request_key,
        command,
        previous_status: current.status,
        previous_error_code: current.last_error_code,
        previous_attempts: current.attempts,
        record: updated,
      },
      command,
      session.identity,
      request_key,
    );
    const bytes = new TextEncoder().encode(
      syncJsonSnapshot({ key, receipt }, responseBytes),
    ).byteLength;
    if (this.#receipts.size >= 1000 || this.#receiptBytes + bytes > seedBytes)
      fail('MOCK_PLANE_INBOX_CAPACITY', trace);
    return {
      data: receipt,
      commit: { item: { record: updated, event_valid: true }, key, receipt, bytes },
    };
  }

  private route(
    path: string,
    method: string,
    body: unknown,
    headers: Map<string, string>,
    trace: string,
  ): Route {
    return checked('INVALID_INPUT', trace, (): Route => {
      const url = new URL(path, 'https://mock.invalid');
      if (url.pathname !== path.split('?')[0]) throw new TypeError();
      if (url.pathname === '/v1/plane/events') {
        if (method !== 'GET' || body !== undefined) throw new TypeError();
        const fields: Record<string, unknown> = {};
        for (const [key, value] of url.searchParams) {
          if (
            !['status', 'pending_state', 'aggregate_id', 'limit', 'cursor'].includes(key) ||
            Object.hasOwn(fields, key) ||
            (key === 'limit' && !/^[1-9][0-9]*$/.test(value))
          )
            throw new TypeError();
          fields[key] = key === 'limit' ? Number(value) : value;
        }
        return { kind: 'list', query: parsePlaneInboxListQuery(fields) };
      }
      if (url.search) throw new TypeError();
      if (url.pathname === '/v1/plane/events/summary') {
        if (method !== 'GET' || body !== undefined) throw new TypeError();
        return { kind: 'summary' };
      }
      const match = /^\/v1\/plane\/events\/([^/]+)(?:\/(diagnosis|retry|retry\/receipt))?$/.exec(
        url.pathname,
      );
      if (!match || !isUlid(match[1])) throw new TypeError();
      const id = match[1];
      if (!match[2] || match[2] === 'diagnosis') {
        if (method !== 'GET' || body !== undefined) throw new TypeError();
        return { kind: match[2] ? 'diagnosis' : 'read', id };
      }
      if (method !== 'POST') throw new TypeError();
      const row = record(
        snapshot(body, 16 * 1024),
        ['expected_revision', 'reason'],
        ['request_key'],
      );
      const query = parsePlaneInboxRetryQuery({
        ...row,
        event_id: id,
        request_key:
          row.request_key === undefined ? headers.get('idempotency-key') : row.request_key,
      });
      const headerKey = headers.get('idempotency-key');
      if (headerKey !== undefined && headerKey !== query.request_key) throw new TypeError();
      return { kind: match[2] === 'retry' ? 'retry' : 'receipt', query };
    });
  }

  private async respond(raw: WcpRequest, session: Session): Promise<unknown> {
    const { method, path, body, response_type, max_response_bytes, signal } = raw;
    let trace = 'trace_unknown';
    const headers = checked('INVALID_INPUT', trace, () => {
      const input = snapshot(raw.headers, 16 * 1024);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
      const result = new Map<string, string>();
      for (const [name, value] of Object.entries(input)) {
        if (
          typeof value !== 'string' ||
          result.has(name.toLowerCase()) ||
          /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
        )
          throw new TypeError();
        result.set(name.toLowerCase(), value);
      }
      return result;
    });
    const supplied = headers.get('x-trace-id') ?? headers.get('traceparent');
    if (!supplied?.trim() || supplied.length > 512) fail('INVALID_INPUT', trace);
    trace = supplied;
    const budget = checked('INVALID_INPUT', trace, () =>
      createRequestBudget(trace, 30_000, signal),
    );
    const live = () => {
      budget.check();
      if (Date.parse(session.expires_at) <= Date.now()) fail('UNAUTHENTICATED', trace);
      if (!session.authenticated_client || !session.admin_role) fail('DENIED', trace);
    };
    try {
      live();
      for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (headers.get('x-' + field.replaceAll('_', '-')) !== this.#scope[field])
          fail('DENIED', trace);
      for (const field of ['actor_id', 'client_id'] as const) {
        const value = headers.get('x-expected-' + field.replaceAll('_', '-'));
        if (value !== undefined && value !== session.identity[field]) fail('DENIED', trace);
      }
      if (!isMockPlaneInboxPath(path) || !['GET', 'POST'].includes(method))
        fail('MOCK_ROUTE_NOT_FOUND', trace);
      if (
        path.length > 16 * 1024 ||
        new TextEncoder().encode(path).byteLength > 16 * 1024 ||
        /[\u0000-\u001f\u007f\\#]/.test(path) ||
        [
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
        ].some((name) => headers.has(name))
      )
        fail('INVALID_INPUT', trace);
      const maximum = max_response_bytes === undefined ? responseBytes : max_response_bytes;
      if (
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        (response_type !== undefined && !['json', 'bounded-json'].includes(response_type)) ||
        (response_type === 'bounded-json' && max_response_bytes === undefined)
      )
        fail('INVALID_INPUT', trace);
      const route = this.route(path, method, body, headers, trace);
      if (route.kind === 'retry') {
        if (!session.human_actor || !session.retry_plane) fail('DENIED', trace);
      } else if (!session.read_admin) fail('DENIED', trace);
      if (route.kind === 'retry' || route.kind === 'receipt') {
        for (const field of ['actor_id', 'client_id'] as const)
          if (headers.get('x-expected-' + field.replaceAll('_', '-')) !== session.identity[field])
            fail('DENIED', trace);
      } else if (headers.has('idempotency-key')) fail('INVALID_INPUT', trace);
      if (this.#active >= 2) fail('RATE_LIMITED', trace);
      return await budget.wait(async () => {
        this.#active++;
        try {
          const binding =
            route.kind === 'list'
              ? await this.listBinding(route.query, session, trace, live)
              : undefined;
          live();
          // Capture current rows after the only asynchronous operation. No await follows a write preflight.
          const now = new Date().toISOString();
          const rows = this.visible(session, now);
          let result: { data: unknown; commit?: Commit };
          if (route.kind === 'summary') result = { data: this.summary(rows, now) };
          else if (route.kind === 'list')
            result = { data: this.list(route.query, rows, binding!, trace) };
          else {
            const id = 'query' in route ? route.query.event_id : route.id;
            const current = rows.find((row) => row.event_id === id);
            if (!current) fail('NOT_FOUND', trace);
            if (route.kind === 'read') result = { data: current };
            else if (route.kind === 'diagnosis') result = { data: this.diagnosis(current, rows) };
            else
              result = this.retry(route.query, route.kind === 'receipt', current, session, trace);
          }
          const response = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
            snapshot(
              {
                schema_version: 1,
                trace_id: trace,
                source_refs: [],
                data: result.data,
                ...(route.kind === 'read'
                  ? {
                      plane_inbox_identity: session.identity,
                      plane_inbox_permissions: { retry: session.human_actor },
                    }
                  : {}),
              },
              Math.min(maximum, responseBytes),
            ),
          );
          live();
          if (result.commit) {
            const change = result.commit;
            this.#items.set(change.item.record.event_id, change.item);
            this.#receipts.set(change.key, change.receipt);
            this.#receiptBytes += change.bytes;
          }
          return response;
        } finally {
          this.#active--;
        }
      });
    } catch (error) {
      let failure = error;
      try {
        live();
      } catch (stopped) {
        failure = stopped;
      }
      const envelope = failure instanceof ContractError ? failure.envelope : undefined;
      return fail(
        envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
          ? (envelope.code as Code)
          : 'PLANE_INBOX_INVALID',
        trace,
      );
    } finally {
      budget.close();
    }
  }
}
