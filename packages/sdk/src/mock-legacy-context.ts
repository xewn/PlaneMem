import {
  ContractError,
  createUlid,
  compareObservedExternalIds,
  parseIndexedContextInput,
  parseIndexedContextWriteInput,
  parseIndexedContextWriteEnvelope,
  parseLegacyContextIdentity,
  parseLegacyContextStatus,
  parseLegacyContextStatusQuery,
  parseLegacyContextListQuery,
  parseLegacyContextListPage,
  parseLegacyContextMutation,
  parseLegacyContextMutationReceipt,
  validateIdempotencyKey,
  syncJsonSnapshot,
  LEGACY_INDEX_INPUT_BYTES,
  LEGACY_INDEX_RESPONSE_BYTES,
  type IndexedContextInput,
  type IndexedContextRecord,
  type LegacyContextIdentity,
  type LegacyContextStatus,
  type LegacyContextMutation,
  type LegacyContextMutationReceipt,
  type LegacyContextAction,
  type Classification,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

type Scope = Pick<LegacyContextIdentity, 'tenant_id' | 'workspace_id' | 'project_id'>;
export type MockLegacyContextCapture =
  | { mode: 'off'; required: boolean }
  | {
      mode: 'configured';
      required: boolean;
      scenarios: Array<{
        input: IndexedContextInput;
        outcome:
          | { kind: 'captured'; page_ref: string }
          | {
              kind: 'failed';
              code: 'MEMORY_PROVIDER_OFF' | 'MEMORY_UNAVAILABLE' | 'MEMORY_SCOPE_MISMATCH';
            };
      }>;
    };
export interface MockLegacyContextSeed {
  scope: Scope;
  project_classification: Classification;
  records: Array<{ content: IndexedContextInput; updated_at: string; deleted_at: string | null }>;
  capture: MockLegacyContextCapture;
}
/** Explicit effective permissions, including any simulated policy decision. */
export interface MockLegacyContextSession {
  identity: LegacyContextIdentity;
  expires_at: string;
  authenticated_client: boolean;
  read_context: boolean;
  write_context: boolean;
  read_restricted: boolean;
  project_readable: boolean;
  /** May include IDs not yet present so this connection can create them. */
  visible_index_ids: string[];
}
type Item = MockLegacyContextSeed['records'][number];
type Session = MockLegacyContextSession & { visible: Set<string> };
type Query = ReturnType<typeof parseLegacyContextListQuery>;
type Outcome = Extract<
  MockLegacyContextCapture,
  { mode: 'configured' }
>['scenarios'][number]['outcome'];
type Saved = { fingerprint: string; data: IndexedContextRecord | LegacyContextMutationReceipt };
type Route =
  | { kind: 'list'; query: Query }
  | { kind: 'status'; id: string }
  | { kind: 'index'; input: IndexedContextInput; key: string }
  | { kind: 'delete' | 'restore'; input: LegacyContextMutation; key: string };
type Pending = {
  id: string;
  item: Item;
  key: string;
  saved: Saved;
  itemBytes: number;
  receiptBytes: number;
};
type Result = { data: unknown; source_refs: unknown[]; pending?: Pending };
const seedBytes = 16 * 1024 * 1024;
const configurationTrace = 'trace_mock_legacy_context_configuration';
const classifications = ['public', 'internal', 'confidential', 'restricted'] as const;
const permissions = [
  'authenticated_client',
  'read_context',
  'write_context',
  'read_restricted',
  'project_readable',
] as const;
const messages = {
  MOCK_CONTEXT_INDEX_CONFIGURATION_INVALID:
    'Supply a bounded index dataset and explicit simulated access',
  MOCK_CONTEXT_INDEX_CAPACITY: 'The simulated index or original receipt ledger is full',
  MOCK_CONTEXT_INDEX_CAPTURE_UNCONFIGURED: 'Configure this exact simulated capture input first',
  MOCK_ROUTE_NOT_FOUND: 'Mock legacy index route or method not found',
  INVALID_INPUT: 'Supply valid index filters or the complete original command',
  UNAUTHENTICATED: 'The simulated session has expired',
  DENIED: 'The simulated identity or permissions do not allow this index operation',
  NOT_FOUND: 'The index is unavailable in this simulated project',
  CONTEXT_INDEX_VERSION_CONFLICT: 'Index revision, classification or deletion state changed',
  IDEMPOTENCY_KEY_REUSED: 'The original index key belongs to another command',
  SEARCH_RESULT_INVALID: 'The complete simulated index record or receipt is invalid',
  CONTEXT_PERSISTENCE_UNAVAILABLE: 'The simulated index cursor could not be calculated',
  MEMORY_PROVIDER_OFF: 'The required simulated memory provider is unavailable',
  MEMORY_UNAVAILABLE: 'The required simulated memory capture failed',
  MEMORY_SCOPE_MISMATCH: 'The simulated memory capture returned another scope',
  GATEWAY_RESPONSE_INVALID:
    'The complete simulated response exceeds its representation or size limit',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the simulated index operation',
  GATEWAY_REQUEST_TIMEOUT: 'The simulated index operation exceeded its deadline',
  RATE_LIMITED: 'Simulated index capacity is occupied',
} as const;
type Code = keyof typeof messages;
function fail(code: Code, trace: string): never {
  throw new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}
function checked<T>(code: Code, trace: string, action: () => T): T {
  try {
    return action();
  } catch {
    return fail(code, trace);
  }
}
function snapshot<T>(value: T, maximum: number): T {
  return JSON.parse(syncJsonSnapshot(value, maximum)) as T;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}
function fields(value: unknown, keys: readonly string[]) {
  const row = object(value);
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  return row;
}
function time(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError();
  return value;
}
function bytes(value: unknown) {
  return new TextEncoder().encode(syncJsonSnapshot(value, seedBytes)).byteLength;
}
function status(item: Item, scope: Scope, now: string): LegacyContextStatus {
  const { content, updated_at, deleted_at } = item;
  return parseLegacyContextStatus(
    {
      ...scope,
      id: content.id,
      revision: content.revision,
      classification: content.classification,
      expires_at: content.expires_at,
      deleted_at,
      updated_at,
      checked_at: now,
      state:
        deleted_at !== null
          ? 'deleted'
          : content.expires_at !== null && Date.parse(content.expires_at) <= Date.parse(now)
            ? 'expired'
            : 'active',
      managed_by: content.id.startsWith('plane:') ? 'plane' : 'manual',
    },
    content.id,
  );
}
function encodeCursor(key: string, after: string): string {
  const raw = new TextEncoder().encode(JSON.stringify([1, key, after]));
  return btoa(Array.from(raw, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decodeCursor(cursor: string, key: string): string {
  const base = cursor.replace(/-/g, '+').replace(/_/g, '/');
  const raw = Uint8Array.from(atob(base + '='.repeat((4 - (base.length % 4)) % 4)), (char) =>
    char.charCodeAt(0),
  );
  const parts: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== 1 || parts[1] !== key)
    throw new TypeError();
  const id = parseLegacyContextStatusQuery({ id: parts[2] }).id;
  if (encodeCursor(key, id) !== cursor) throw new TypeError();
  return id;
}
export function isMockLegacyContextPath(path: unknown): path is string {
  return typeof path === 'string' && /^\/v1\/context\/index(?:[/?#]|$)/.test(path);
}

/** Manual index content and lifecycle share one in-memory ledger. No external capture occurs. */
export class MockLegacyContextStore {
  readonly #id = createUlid();
  readonly #scope: Scope;
  readonly #classification: Classification;
  readonly #items: Map<string, Item>;
  readonly #capture: {
    mode: 'off' | 'configured';
    required: boolean;
    scenarios: Map<string, Outcome>;
  };
  readonly #receipts = new Map<string, Saved>();
  #itemBytes: number;
  #receiptBytes = 0;
  #active = 0;

  constructor(seed: MockLegacyContextSeed) {
    const saved = checked('MOCK_CONTEXT_INDEX_CONFIGURATION_INVALID', configurationTrace, () => {
      const raw = fields(snapshot(seed, seedBytes), [
        'scope',
        'project_classification',
        'records',
        'capture',
      ]);
      const rawScope = fields(raw.scope, ['tenant_id', 'workspace_id', 'project_id']);
      const identity = parseLegacyContextIdentity({
        ...rawScope,
        actor_id: 'mock',
        client_id: 'mock',
      });
      const scope = {
        tenant_id: identity.tenant_id,
        workspace_id: identity.workspace_id,
        project_id: identity.project_id,
      };
      if (
        !classifications.includes(raw.project_classification as Classification) ||
        !Array.isArray(raw.records) ||
        raw.records.length > 1000
      )
        throw new TypeError();
      const items = new Map<string, Item>();
      const now = new Date().toISOString();
      let itemBytes = 0;
      for (const value of raw.records) {
        const row = fields(value, ['content', 'updated_at', 'deleted_at']);
        const content = parseIndexedContextInput(snapshot(row.content, LEGACY_INDEX_INPUT_BYTES));
        const item: Item = {
          content,
          updated_at: time(row.updated_at),
          deleted_at: row.deleted_at === null ? null : time(row.deleted_at),
        };
        if (items.has(content.id)) throw new TypeError();
        status(item, scope, now);
        items.set(content.id, item);
        itemBytes += bytes(item);
      }
      if (itemBytes > seedBytes) throw new TypeError();
      const capture = object(raw.capture);
      if (
        typeof capture.required !== 'boolean' ||
        !['off', 'configured'].includes(capture.mode as string)
      )
        throw new TypeError();
      fields(
        capture,
        capture.mode === 'off' ? ['mode', 'required'] : ['mode', 'required', 'scenarios'],
      );
      const scenarios = new Map<string, Outcome>();
      if (capture.mode === 'configured') {
        if (!Array.isArray(capture.scenarios) || capture.scenarios.length > 1000)
          throw new TypeError();
        for (const value of capture.scenarios) {
          const row = fields(value, ['input', 'outcome']);
          const input = parseIndexedContextWriteInput(row.input);
          const key = JSON.stringify(input);
          if (scenarios.has(key)) throw new TypeError();
          const outcome = object(row.outcome);
          if (outcome.kind === 'captured') {
            fields(outcome, ['kind', 'page_ref']);
            const normalized = parseIndexedContextInput({
              ...input,
              source_refs: [...input.source_refs, { type: 'ai-memory', id: outcome.page_ref }],
            });
            scenarios.set(key, { kind: 'captured', page_ref: normalized.source_refs.at(-1)!.id });
          } else {
            fields(outcome, ['kind', 'code']);
            if (
              outcome.kind !== 'failed' ||
              !['MEMORY_PROVIDER_OFF', 'MEMORY_UNAVAILABLE', 'MEMORY_SCOPE_MISMATCH'].includes(
                outcome.code as string,
              )
            )
              throw new TypeError();
            scenarios.set(key, {
              kind: 'failed',
              code: outcome.code as Extract<Outcome, { kind: 'failed' }>['code'],
            });
          }
        }
      }
      return {
        scope,
        items,
        itemBytes,
        classification: raw.project_classification as Classification,
        capture: {
          mode: capture.mode as 'off' | 'configured',
          required: capture.required,
          scenarios,
        },
      };
    });
    this.#scope = saved.scope;
    this.#classification = saved.classification;
    this.#items = saved.items;
    this.#itemBytes = saved.itemBytes;
    this.#capture = saved.capture;
  }

  connect(input: MockLegacyContextSession): WcpTransport {
    const session = checked(
      'MOCK_CONTEXT_INDEX_CONFIGURATION_INVALID',
      configurationTrace,
      (): Session => {
        const raw = fields(snapshot(input, 1024 * 1024), [
          'identity',
          'expires_at',
          ...permissions,
          'visible_index_ids',
        ]);
        const identity = parseLegacyContextIdentity(raw.identity);
        for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (identity[field] !== this.#scope[field]) throw new TypeError();
        for (const field of permissions) if (typeof raw[field] !== 'boolean') throw new TypeError();
        if (!Array.isArray(raw.visible_index_ids) || raw.visible_index_ids.length > 1000)
          throw new TypeError();
        const visible = new Set<string>();
        for (const value of raw.visible_index_ids) {
          const id = parseLegacyContextStatusQuery({ id: value }).id;
          if (visible.has(id)) throw new TypeError();
          visible.add(id);
        }
        return {
          identity,
          expires_at: time(raw.expires_at),
          visible,
          visible_index_ids: [...visible].sort(compareObservedExternalIds),
          authenticated_client: raw.authenticated_client as boolean,
          read_context: raw.read_context as boolean,
          write_context: raw.write_context as boolean,
          read_restricted: raw.read_restricted as boolean,
          project_readable: raw.project_readable as boolean,
        };
      },
    );
    return {
      request: async <T = unknown>(request: WcpRequest): Promise<T> =>
        (await this.respond(request, session)) as T,
    };
  }
  private parentVisible(session: Session) {
    return (
      session.project_readable && (this.#classification !== 'restricted' || session.read_restricted)
    );
  }
  private visible(item: Item, session: Session) {
    return (
      this.parentVisible(session) &&
      session.visible.has(item.content.id) &&
      (item.content.classification !== 'restricted' || session.read_restricted)
    );
  }
  private capture(input: IndexedContextInput, trace: string): IndexedContextInput {
    if (this.#capture.mode === 'off') {
      if (this.#capture.required) fail('MEMORY_PROVIDER_OFF', trace);
      return input;
    }
    if (input.source_refs.length >= 64) fail('INVALID_INPUT', trace);
    const outcome = this.#capture.scenarios.get(JSON.stringify(input));
    if (!outcome) fail('MOCK_CONTEXT_INDEX_CAPTURE_UNCONFIGURED', trace);
    if (outcome.kind === 'failed') {
      if (this.#capture.required) fail(outcome.code, trace);
      return input;
    }
    return parseIndexedContextInput({
      ...input,
      source_refs: [...input.source_refs, { type: 'ai-memory', id: outcome.page_ref }],
    });
  }
  private stage(id: string, item: Item, key: string, saved: Saved, trace: string): Pending {
    const current = this.#items.get(id);
    const itemBytes = this.#itemBytes - (current ? bytes(current) : 0) + bytes(item);
    const receiptBytes = bytes({ key, ...saved });
    if (
      (!current && this.#items.size >= 1000) ||
      itemBytes > seedBytes ||
      this.#receipts.size >= 1000 ||
      this.#receiptBytes + receiptBytes > seedBytes
    )
      fail('MOCK_CONTEXT_INDEX_CAPACITY', trace);
    return { id, item, key, saved, itemBytes, receiptBytes };
  }
  private index(
    input: IndexedContextInput,
    requestKey: string,
    session: Session,
    now: string,
    trace: string,
  ): Result {
    const current = this.#items.get(input.id);
    if (
      !this.parentVisible(session) ||
      !session.visible.has(input.id) ||
      (input.classification === 'restricted' && !session.read_restricted) ||
      (current && !this.visible(current, session))
    )
      fail('DENIED', trace);
    const key = JSON.stringify([session.identity, 'index', requestKey]);
    const fingerprint = JSON.stringify(input);
    const previous = this.#receipts.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED', trace);
      const data = previous.data as IndexedContextRecord;
      if (
        !current ||
        current.deleted_at !== null ||
        (current.content.expires_at !== null &&
          Date.parse(current.content.expires_at) <= Date.parse(now)) ||
        (data.classification === 'restricted' && !session.read_restricted) ||
        (data.expires_at !== null && Date.parse(data.expires_at) <= Date.parse(now))
      )
        fail('DENIED', trace);
      if (current.content.revision < data.revision) fail('SEARCH_RESULT_INVALID', trace);
      const verified = parseIndexedContextWriteEnvelope(
        { schema_version: 1, trace_id: trace, source_refs: data.source_refs, data },
        input,
        this.#scope,
        trace,
      );
      return { data: verified.data, source_refs: verified.source_refs };
    }
    if (
      current &&
      (current.deleted_at !== null ||
        current.content.revision >= input.revision ||
        classifications.indexOf(current.content.classification) >
          classifications.indexOf(input.classification))
    )
      fail('CONTEXT_INDEX_VERSION_CONFLICT', trace);
    const content = this.capture(input, trace);
    const data: IndexedContextRecord = { ...content, ...this.#scope, schema_version: 1 };
    const verified = parseIndexedContextWriteEnvelope(
      { schema_version: 1, trace_id: trace, source_refs: data.source_refs, data },
      input,
      this.#scope,
      trace,
    );
    const item: Item = { content, updated_at: now, deleted_at: null };
    const pending = this.stage(input.id, item, key, { fingerprint, data: verified.data }, trace);
    return { data: verified.data, source_refs: verified.source_refs, pending };
  }
  private mutate(
    operation: LegacyContextAction,
    input: LegacyContextMutation,
    requestKey: string,
    session: Session,
    now: string,
    trace: string,
  ): Result {
    const current = this.#items.get(input.id);
    if (!current || !this.visible(current, session)) fail('NOT_FOUND', trace);
    status(current, this.#scope, now);
    const key = JSON.stringify([session.identity, operation, requestKey]);
    const fingerprint = JSON.stringify(input);
    const previous = this.#receipts.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED', trace);
      const data = parseLegacyContextMutationReceipt(previous.data, input, operation, requestKey);
      if (data.record.revision > current.content.revision) fail('SEARCH_RESULT_INVALID', trace);
      if (data.record.classification === 'restricted' && !session.read_restricted)
        fail('NOT_FOUND', trace);
      return { data, source_refs: [] };
    }
    if (
      current.content.revision !== input.expected_revision ||
      (operation === 'restore') !== (current.deleted_at !== null)
    )
      fail('CONTEXT_INDEX_VERSION_CONFLICT', trace);
    const item: Item = {
      content: { ...current.content, revision: current.content.revision + 1 },
      updated_at: now,
      deleted_at: operation === 'delete' ? now : null,
    };
    const data = parseLegacyContextMutationReceipt(
      {
        operation,
        request_key: requestKey,
        expected_revision: input.expected_revision,
        reason: input.reason,
        record: status(item, this.#scope, now),
      },
      input,
      operation,
      requestKey,
    );
    const pending = this.stage(input.id, item, key, { fingerprint, data }, trace);
    return { data, source_refs: [], pending };
  }

  private async list(query: Query, session: Session, trace: string, live: () => void) {
    let key: string;
    try {
      live();
      const binding = JSON.stringify([
        'mock-legacy-index-v1',
        this.#id,
        session.identity,
        session.expires_at,
        permissions.map((field) => session[field]),
        session.visible_index_ids,
        query.query,
        query.state,
        query.managed_by,
      ]);
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(binding),
      );
      live();
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
      key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    } catch {
      live();
      return fail('CONTEXT_PERSISTENCE_UNAVAILABLE', trace);
    }
    const after =
      query.cursor === undefined
        ? undefined
        : checked('INVALID_INPUT', trace, () => decodeCursor(query.cursor!, key));
    const now = new Date().toISOString();
    const candidates = [...this.#items.values()]
      .filter((item) => this.visible(item, session))
      .map((item) => status(item, this.#scope, now))
      .filter(
        (row) =>
          (after === undefined || compareObservedExternalIds(row.id, after) > 0) &&
          (query.state === 'all' || query.state === row.state) &&
          (query.managed_by === 'all' || query.managed_by === row.managed_by) &&
          row.id.toLowerCase().includes(query.query.toLowerCase()),
      )
      .sort((a, b) => compareObservedExternalIds(a.id, b.id));
    const items = candidates.slice(0, query.limit);
    return parseLegacyContextListPage(
      {
        scope: this.#scope,
        items,
        ...(candidates.length > query.limit
          ? { next_cursor: encodeCursor(key, items.at(-1)!.id) }
          : {}),
      },
      query,
    );
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
      if (url.pathname === '/v1/context/index' && method === 'GET') {
        if (body !== undefined || headers.has('idempotency-key')) throw new TypeError();
        const query: Record<string, unknown> = {};
        for (const [key, value] of url.searchParams) {
          if (
            !['query', 'state', 'managed_by', 'limit', 'cursor'].includes(key) ||
            Object.hasOwn(query, key) ||
            (key === 'limit' && !/^[1-9][0-9]*$/.test(value))
          )
            throw new TypeError();
          query[key] = key === 'limit' ? Number(value) : value;
        }
        return { kind: 'list', query: parseLegacyContextListQuery(query) };
      }
      if (url.search) throw new TypeError();
      if (url.pathname === '/v1/context/index' && method === 'POST') {
        const row = object(snapshot(body, LEGACY_INDEX_INPUT_BYTES));
        const { idempotency_key, ...content } = row;
        const key = validateIdempotencyKey(headers.get('idempotency-key') ?? idempotency_key);
        if (idempotency_key !== undefined && idempotency_key !== key) throw new TypeError();
        return { kind: 'index', input: parseIndexedContextWriteInput(content), key };
      }
      const match = /^\/v1\/context\/index\/([^/]+)(?:\/(delete|restore))?$/.exec(url.pathname);
      if (!match) throw new TypeError();
      const id = parseLegacyContextStatusQuery({ id: decodeURIComponent(match[1]!) }).id;
      if (encodeURIComponent(id) !== match[1]) throw new TypeError();
      if (!match[2]) {
        if (method !== 'GET' || body !== undefined || headers.has('idempotency-key'))
          throw new TypeError();
        return { kind: 'status', id };
      }
      if (method !== 'POST') throw new TypeError();
      const { idempotency_key, ...raw } = object(snapshot(body, 16 * 1024));
      const key = validateIdempotencyKey(headers.get('idempotency-key') ?? idempotency_key);
      if (idempotency_key !== undefined && idempotency_key !== key) throw new TypeError();
      // Gateway route parameters override a body ID, including one sent by the current SDK.
      const input = parseLegacyContextMutation({ ...raw, id });
      return { kind: match[2] as LegacyContextAction, input, key };
    });
  }
  private async respond(raw: WcpRequest, session: Session): Promise<unknown> {
    const { method, path, body, response_type, max_response_bytes, signal } = raw;
    let trace = 'trace_unknown';
    const headers = checked('INVALID_INPUT', trace, () => {
      const input = object(snapshot(raw.headers, 16 * 1024));
      const normalized = new Map<string, string>();
      for (const [name, value] of Object.entries(input)) {
        if (
          typeof value !== 'string' ||
          normalized.has(name.toLowerCase()) ||
          /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
        )
          throw new TypeError();
        normalized.set(name.toLowerCase(), value);
      }
      return normalized;
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
      if (!isMockLegacyContextPath(path) || !['GET', 'POST'].includes(method))
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
      const maximum =
        max_response_bytes === undefined ? LEGACY_INDEX_RESPONSE_BYTES : max_response_bytes;
      if (
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        (response_type !== undefined && !['json', 'bounded-json'].includes(response_type)) ||
        (response_type === 'bounded-json' && max_response_bytes === undefined)
      )
        fail('INVALID_INPUT', trace);
      const route = this.route(path, method, body, headers, trace);
      if (route.kind === 'list' || route.kind === 'status') {
        if (!session.read_context) fail('DENIED', trace);
      } else if (!session.authenticated_client || !session.write_context) fail('DENIED', trace);
      if (this.#active >= 2) fail('RATE_LIMITED', trace);
      return await budget.wait(async () => {
        this.#active++;
        try {
          live();
          let result: Result;
          if (route.kind === 'list')
            result = { data: await this.list(route.query, session, trace, live), source_refs: [] };
          else {
            const now = new Date().toISOString();
            if (route.kind === 'status') {
              const item = this.#items.get(route.id);
              if (!item || !this.visible(item, session)) fail('NOT_FOUND', trace);
              result = { data: status(item, this.#scope, now), source_refs: [] };
            } else if (route.kind === 'index')
              result = this.index(route.input, route.key, session, now, trace);
            else result = this.mutate(route.kind, route.input, route.key, session, now, trace);
          }
          const response = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
            snapshot(
              {
                schema_version: 1,
                trace_id: trace,
                source_refs: result.source_refs,
                data: result.data,
                ...(route.kind === 'status'
                  ? {
                      index_identity: session.identity,
                      index_permissions: {
                        write: session.authenticated_client && session.write_context,
                      },
                    }
                  : {}),
              },
              Math.min(LEGACY_INDEX_RESPONSE_BYTES, maximum),
            ),
          );
          live();
          // All write checks complete before a synchronous state/receipt commit; no capture call is dispatched.
          if (result.pending) {
            const pending = result.pending;
            this.#items.set(pending.id, pending.item);
            this.#receipts.set(pending.key, pending.saved);
            this.#itemBytes = pending.itemBytes;
            this.#receiptBytes += pending.receiptBytes;
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
          : 'SEARCH_RESULT_INVALID',
        trace,
      );
    } finally {
      budget.close();
    }
  }
}
