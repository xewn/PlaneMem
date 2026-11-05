import {
  ContractError,
  compareObservedExternalIds,
  createUlid,
  matchesObservedWorkItemQuery,
  parseObservedRecordId,
  parseObservedSnapshot,
  parseObservedWorkItemContext,
  parseObservedWorkItemListQuery,
  parseObservedWorkItemPage,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type Classification,
  type ObservedScope,
  type ObservedSnapshot,
  type ObservedWorkItemContext,
  type ObservedWorkItemEntry,
  type SyncCommandIdentity,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface MockObservedContextScenario {
  read_restricted: boolean;
  /** Complete supplied recall result; it must describe this exact saved work-item observation. */
  data: ObservedWorkItemContext;
}
export interface MockObservedSeed {
  scope: ObservedScope;
  /** Current local parent visibility, independent of the saved Plane project observation. */
  project_classification: Classification;
  project: {
    snapshot: ObservedSnapshot;
    event_type: 'ProjectCreated' | 'ProjectUpdated';
    expires_at: string | null;
  } | null;
  work_items: Array<{
    snapshot: ObservedSnapshot;
    event_type: ObservedWorkItemEntry['event_type'];
    /** Active index expiry. A deletion observation remains readable after this time. */
    expires_at: string | null;
    contexts?: MockObservedContextScenario[];
  }>;
}
/** Fixed simulated authority; request headers cannot add permissions or visible records. */
export interface MockObservedSession {
  identity: SyncCommandIdentity;
  expires_at: string;
  project_readable: boolean;
  read_context: boolean;
  read_restricted: boolean;
  /** Canonical external IDs only. State reads may additionally use their aggregate-ID aliases. */
  visible_work_item_ids: string[];
}
type Session = MockObservedSession & { visible: Set<string> };
type Project = NonNullable<MockObservedSeed['project']>;
type Item = {
  snapshot: ObservedSnapshot;
  expires_at: string | null;
  entry: ObservedWorkItemEntry;
  contexts: Map<boolean, ObservedWorkItemContext>;
};
type ListQuery = ReturnType<typeof parseObservedWorkItemListQuery>;
const seedBytes = 16 * 1024 * 1024;
const responseBytes = 2 * 1024 * 1024;
const configurationTrace = 'trace_mock_observed_configuration';
const classifications = ['public', 'internal', 'confidential', 'restricted'] as const;
const messages = {
  MOCK_OBSERVED_CONFIGURATION_INVALID:
    'Supply a bounded observation dataset and explicit simulated access',
  MOCK_OBSERVED_CONTEXT_UNCONFIGURED:
    'No context scenario is configured for this observation and restricted permission',
  MOCK_ROUTE_NOT_FOUND: 'Mock observation route not found',
  INVALID_INPUT:
    'Supply an observation read without write conditions and preserve the original paging filters',
  UNAUTHENTICATED: 'The simulated session has expired',
  DENIED: 'The simulated session cannot read these observations',
  NOT_FOUND: 'The observation is unavailable in this simulated project',
  OBSERVED_STATE_INVALID: 'The simulated observation is invalid or its identity is ambiguous',
  OBSERVED_RECORD_DELETED: 'The saved work item is deleted; read its state instead of context',
  OBSERVED_STATE_UNAVAILABLE: 'The simulated observation cursor could not be calculated',
  GATEWAY_RESPONSE_INVALID:
    'The complete simulated response exceeds its representation or size limit',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the simulated observation read',
  GATEWAY_REQUEST_TIMEOUT: 'The simulated observation read exceeded its deadline',
  RATE_LIMITED: 'Simulated observation read capacity is occupied',
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
function record(value: unknown, required: string[], optional: string[] = []) {
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
function expiry(value: unknown): string | null {
  return value === null ? null : time(value);
}
function classification(value: unknown): Classification {
  if (!classifications.includes(value as Classification)) throw new TypeError();
  return value as Classification;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child))
        .join(',') +
      '}'
    );
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError();
  return encoded;
}
function entry(
  state: ObservedSnapshot,
  event: ObservedWorkItemEntry['event_type'],
  parent: Classification,
): ObservedWorkItemEntry {
  const deleted = state.schema_version === 2;
  const candidate =
    typeof state.fields.title === 'string'
      ? Array.from(state.fields.title).slice(0, 2000).join('')
      : '';
  const title = candidate.trim() ? candidate : state.external_id;
  return {
    external_id: state.external_id,
    aggregate_id: state.aggregate_id,
    plane_version: state.plane_version,
    source_event_id: state.source_event_id,
    event_type: event,
    state: deleted ? 'deleted' : 'active',
    title: deleted ? null : title,
    status:
      deleted || state.status === undefined
        ? null
        : Array.from(state.status).slice(0, 255).join(''),
    classification:
      classifications[
        Math.max(classifications.indexOf(parent), classifications.indexOf(state.classification))
      ]!,
    observed_at: state.observed_at,
    deleted_at: state.deleted_at ?? null,
  };
}
function encodeCursor(key: string, after: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify([1, key, after]));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decodeCursor(cursor: string, key: string): string {
  const base = cursor.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(base + '='.repeat((4 - (base.length % 4)) % 4)), (char) =>
    char.charCodeAt(0),
  );
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== 1 || parsed[1] !== key)
    throw new TypeError();
  const after = parseObservedRecordId(parsed[2]);
  if (encodeCursor(key, after) !== cursor) throw new TypeError();
  return after;
}
export function isMockObservedPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    /^\/v1\/(?:projects\/[^/]+\/state|work-items\/[^/]+\/(?:state|context)|plane\/work-items)(?:\?|$)/.test(
      path,
    )
  );
}

/** Fixed saved observations; no upstream Plane access, webhook ingestion or authority promotion. */
export class MockObservedStore {
  readonly #id = createUlid();
  readonly #scope: ObservedScope;
  readonly #classification: Classification;
  readonly #project: Project | null;
  readonly #items: Map<string, Item>;
  readonly #aliases = new Map<string, Item[]>();
  readonly #ordered: Item[];
  #active = 0;

  constructor(seed: MockObservedSeed) {
    const saved = checked('MOCK_OBSERVED_CONFIGURATION_INVALID', configurationTrace, () => {
      const raw = record(snapshot(seed, seedBytes), [
        'scope',
        'project_classification',
        'project',
        'work_items',
      ]);
      const scopeRow = record(raw.scope, ['tenant_id', 'workspace_id', 'project_id']);
      const scope: ObservedScope = {
        tenant_id: parseObservedRecordId(scopeRow.tenant_id),
        workspace_id: parseObservedRecordId(scopeRow.workspace_id),
        project_id: parseObservedRecordId(scopeRow.project_id),
      };
      const parent = classification(raw.project_classification);
      let project: Project | null = null;
      if (raw.project !== null) {
        const row = record(raw.project, ['snapshot', 'event_type', 'expires_at']);
        if (row.event_type !== 'ProjectCreated' && row.event_type !== 'ProjectUpdated')
          throw new TypeError();
        project = {
          snapshot: parseObservedSnapshot(row.snapshot, 'Project', scope.project_id, scope),
          event_type: row.event_type,
          expires_at: expiry(row.expires_at),
        };
        snapshot(project, responseBytes);
      }
      if (!Array.isArray(raw.work_items) || raw.work_items.length > 1000) throw new TypeError();
      const items = new Map<string, Item>();
      const sourceEvents = new Set(project ? [project.snapshot.source_event_id] : []);
      for (const input of raw.work_items) {
        const row = record(input, ['snapshot', 'event_type', 'expires_at'], ['contexts']);
        if (!row.snapshot || typeof row.snapshot !== 'object' || Array.isArray(row.snapshot))
          throw new TypeError();
        const externalId = parseObservedRecordId(
          (row.snapshot as Record<string, unknown>).external_id,
        );
        const state = parseObservedSnapshot(row.snapshot, 'WorkItem', externalId, scope);
        if (
          items.has(externalId) ||
          sourceEvents.has(state.source_event_id) ||
          ![
            'WorkItemCreated',
            'WorkItemUpdated',
            'WorkItemStatusConfirmed',
            'WorkItemDeleted',
            'WorkItemRestored',
          ].includes(row.event_type as string) ||
          (row.event_type === 'WorkItemDeleted') !== (state.schema_version === 2) ||
          (row.event_type === 'WorkItemRestored') !== (state.restored_from !== undefined)
        )
          throw new TypeError();
        sourceEvents.add(state.source_event_id);
        snapshot(state, responseBytes);
        const metadata = entry(
          state,
          row.event_type as ObservedWorkItemEntry['event_type'],
          parent,
        );
        // Reuse the complete directory parser; fixture metadata cannot disagree with its state.
        parseObservedWorkItemPage(
          { schema_version: 1, scope, checked_at: state.observed_at, items: [metadata] },
          scope,
          { state: 'all' },
        );
        const contexts = new Map<boolean, ObservedWorkItemContext>();
        const scenarios = row.contexts === undefined ? [] : row.contexts;
        if (
          !Array.isArray(scenarios) ||
          scenarios.length > 2 ||
          (state.schema_version === 2 && scenarios.length)
        )
          throw new TypeError();
        for (const scenario of scenarios) {
          const value = record(scenario, ['read_restricted', 'data']);
          if (typeof value.read_restricted !== 'boolean' || contexts.has(value.read_restricted))
            throw new TypeError();
          const data = record(snapshot(value.data, responseBytes), ['work_item', 'context_pack']);
          const pack = data.context_pack as ObservedWorkItemContext['context_pack'];
          const trace = pack?.trace_id;
          if (typeof trace !== 'string') throw new TypeError();
          const parsed = parseObservedWorkItemContext(data, externalId, scope, trace);
          const title = (
            typeof state.fields.title === 'string' && state.fields.title.trim()
              ? state.fields.title
              : state.external_id
          ).slice(0, 1000);
          const localHit = parsed.context_pack.hits[0]!;
          if (
            canonical(parsed.work_item) !== canonical(state) ||
            parsed.context_pack.query !== title ||
            localHit.title !== title ||
            localHit.snippet !== `${title} (${state.status ?? 'observed'})` ||
            (!value.read_restricted &&
              (parsed.context_pack.memory_used ||
                parsed.context_pack.hits.some((hit) => hit.classification === 'restricted')))
          )
            throw new TypeError();
          contexts.set(value.read_restricted, parsed);
        }
        items.set(externalId, {
          snapshot: state,
          expires_at: expiry(row.expires_at),
          entry: metadata,
          contexts,
        });
      }
      return { scope, parent, project, items };
    });
    this.#scope = saved.scope;
    this.#classification = saved.parent;
    this.#project = saved.project;
    this.#items = saved.items;
    this.#ordered = [...saved.items.values()].sort((a, b) =>
      compareObservedExternalIds(a.snapshot.external_id, b.snapshot.external_id),
    );
    for (const row of this.#ordered)
      for (const id of new Set([row.snapshot.external_id, row.snapshot.aggregate_id])) {
        const candidates = this.#aliases.get(id) ?? [];
        candidates.push(row);
        this.#aliases.set(id, candidates);
      }
  }

  connect(input: MockObservedSession): WcpTransport {
    const session = checked(
      'MOCK_OBSERVED_CONFIGURATION_INVALID',
      configurationTrace,
      (): Session => {
        const raw = record(snapshot(input, 1024 * 1024), [
          'identity',
          'expires_at',
          'project_readable',
          'read_context',
          'read_restricted',
          'visible_work_item_ids',
        ]);
        const identity = parseSyncCommandIdentity(raw.identity);
        for (const name of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (identity[name] !== this.#scope[name]) throw new TypeError();
        for (const name of ['project_readable', 'read_context', 'read_restricted'])
          if (typeof raw[name] !== 'boolean') throw new TypeError();
        if (!Array.isArray(raw.visible_work_item_ids) || raw.visible_work_item_ids.length > 1000)
          throw new TypeError();
        const visible = new Set<string>();
        for (const id of raw.visible_work_item_ids) {
          if (typeof id !== 'string' || !this.#items.has(id) || visible.has(id))
            throw new TypeError();
          visible.add(id);
        }
        return {
          identity,
          expires_at: time(raw.expires_at),
          project_readable: raw.project_readable as boolean,
          read_context: raw.read_context as boolean,
          read_restricted: raw.read_restricted as boolean,
          visible_work_item_ids: [...visible].sort(compareObservedExternalIds),
          visible,
        };
      },
    );
    return {
      request: async <T = unknown>(request: WcpRequest): Promise<T> =>
        (await this.respond(request, session)) as T,
    };
  }
  private available(row: Item | Project, session: Session, now: number) {
    return (
      (row.snapshot.classification !== 'restricted' || session.read_restricted) &&
      (row.snapshot.schema_version === 2 ||
        row.expires_at === null ||
        Date.parse(row.expires_at) > now)
    );
  }
  private selected(id: string, session: Session, trace: string): Item {
    const now = Date.now();
    const rows = (this.#aliases.get(id) ?? []).filter(
      (row) => session.visible.has(row.snapshot.external_id) && this.available(row, session, now),
    );
    if (!rows.length) fail('NOT_FOUND', trace);
    if (rows.length !== 1) fail('OBSERVED_STATE_INVALID', trace);
    return rows[0]!;
  }
  private async list(query: ListQuery, session: Session, trace: string, live: () => void) {
    const binding = JSON.stringify([
      'mock-observed-list-v1',
      this.#id,
      this.#scope,
      session.identity,
      session.expires_at,
      session.project_readable,
      session.read_context,
      session.read_restricted,
      session.visible_work_item_ids,
      query.query,
      query.state,
      query.limit,
    ]);
    let key: string;
    try {
      live();
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(binding),
      );
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
      key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    } catch {
      live();
      return fail('OBSERVED_STATE_UNAVAILABLE', trace);
    }
    live();
    const after =
      query.cursor === undefined
        ? undefined
        : checked('INVALID_INPUT', trace, () => decodeCursor(query.cursor!, key));
    const now = Date.now();
    const items: ObservedWorkItemEntry[] = [];
    for (const row of this.#ordered) {
      if (
        !session.visible.has(row.snapshot.external_id) ||
        !this.available(row, session, now) ||
        (query.state !== 'all' && row.entry.state !== query.state) ||
        (after !== undefined && compareObservedExternalIds(row.entry.external_id, after) <= 0) ||
        !matchesObservedWorkItemQuery(row.entry, query.query)
      )
        continue;
      items.push(row.entry);
      if (items.length > query.limit) break;
    }
    const data = items.slice(0, query.limit);
    return checked('OBSERVED_STATE_INVALID', trace, () =>
      parseObservedWorkItemPage(
        {
          schema_version: 1,
          scope: this.#scope,
          checked_at: new Date(now).toISOString(),
          items: data,
          ...(items.length > query.limit
            ? { next_cursor: encodeCursor(key, data.at(-1)!.external_id) }
            : {}),
        },
        this.#scope,
        query,
      ),
    );
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
      if (!session.read_context) fail('DENIED', trace);
      if (
        !session.project_readable ||
        (this.#classification === 'restricted' && !session.read_restricted)
      )
        fail('NOT_FOUND', trace);
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
      if (method !== 'GET' || !isMockObservedPath(path)) fail('MOCK_ROUTE_NOT_FOUND', trace);
      if (
        body !== undefined ||
        path.length > 16 * 1024 ||
        new TextEncoder().encode(path).byteLength > 16 * 1024 ||
        /[\u0000-\u001f\u007f\\#]/.test(path) ||
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
      const route = checked('INVALID_INPUT', trace, () => {
        const url = new URL(path, 'https://mock.invalid');
        if (url.pathname !== path.split('?')[0]) throw new TypeError();
        if (url.pathname === '/v1/plane/work-items') {
          const fields: Record<string, unknown> = {};
          for (const [key, value] of url.searchParams) {
            if (!['query', 'state', 'limit', 'cursor'].includes(key) || Object.hasOwn(fields, key))
              throw new TypeError();
            if (key === 'limit' && !/^[1-9][0-9]*$/.test(value)) throw new TypeError();
            fields[key] = key === 'limit' ? Number(value) : value;
          }
          return { kind: 'list' as const, query: parseObservedWorkItemListQuery(fields) };
        }
        const match = /^\/v1\/(projects|work-items)\/([^/]+)\/(state|context)$/.exec(url.pathname);
        if (!match || url.search || (match[1] === 'projects' && match[3] !== 'state'))
          throw new TypeError();
        const id = parseObservedRecordId(decodeURIComponent(match[2]!));
        if (encodeURIComponent(id) !== match[2]) throw new TypeError();
        return {
          kind:
            match[1] === 'projects'
              ? ('project' as const)
              : match[3] === 'context'
                ? ('context' as const)
                : ('state' as const),
          id,
        };
      });
      if (this.#active >= 2) fail('RATE_LIMITED', trace);
      return await budget.wait(async () => {
        this.#active++;
        try {
          live();
          let result: { data: unknown; source_refs: ObservedSnapshot['source_refs'] };
          if (route.kind === 'list') {
            result = { data: await this.list(route.query, session, trace, live), source_refs: [] };
          } else if (route.kind === 'project') {
            if (
              route.id !== this.#scope.project_id ||
              !this.#project ||
              !this.available(this.#project, session, Date.now())
            )
              fail('NOT_FOUND', trace);
            result = {
              data: this.#project.snapshot,
              source_refs: this.#project.snapshot.source_refs,
            };
          } else {
            const row = this.selected(route.id, session, trace);
            if (route.kind === 'context') {
              if (row.snapshot.schema_version === 2) fail('OBSERVED_RECORD_DELETED', trace);
              const context = row.contexts.get(session.read_restricted);
              if (!context) fail('MOCK_OBSERVED_CONTEXT_UNCONFIGURED', trace);
              const data = checked('OBSERVED_STATE_INVALID', trace, () =>
                parseObservedWorkItemContext(
                  { ...context, context_pack: { ...context.context_pack, trace_id: trace } },
                  route.id,
                  this.#scope,
                  trace,
                ),
              );
              result = { data, source_refs: data.context_pack.source_refs };
            } else result = { data: row.snapshot, source_refs: row.snapshot.source_refs };
          }
          live();
          const response = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
            snapshot(
              { schema_version: 1, trace_id: trace, ...result },
              Math.min(maximum, responseBytes),
            ),
          );
          live();
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
          : 'OBSERVED_STATE_INVALID',
        trace,
      );
    } finally {
      budget.close();
    }
  }
}
