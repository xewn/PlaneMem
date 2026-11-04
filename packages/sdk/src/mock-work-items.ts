import {
  ContractError,
  matchesWorkItemDueFilter,
  createUlid,
  parseSyncCommandIdentity,
  parseWorkItemListQuery,
  parseWorkItemProjection,
  parseWorkItemProjectionList,
  parseWorkItemProjectionQuery,
  syncJsonSnapshot,
  type SyncCommandIdentity,
  type WorkItemListQuery,
  type WorkItemProjection,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

const seedBytes = 16 * 1024 * 1024;
const itemBytes = 256 * 1024;
const responseBytes = 2 * 1024 * 1024;
const configurationTrace = 'trace_mock_work_item_configuration';

export interface MockWorkItemSeed {
  scope: Pick<SyncCommandIdentity, 'tenant_id' | 'workspace_id' | 'project_id'>;
  items: WorkItemProjection[];
}

/** Explicit simulated decisions, never credentials or permissions inferred from request headers. */
export interface MockWorkItemSession {
  identity: SyncCommandIdentity;
  expires_at: string;
  project_readable: boolean;
  read_work_items: boolean;
  read_restricted: boolean;
  visible_item_ids: string[];
}

type Session = MockWorkItemSession & { visible: Set<string> };
type Stored = { item: WorkItemProjection; updated: string };
type Position = { updated: string; id: string };
const messages = {
  MOCK_WORK_ITEM_CONFIGURATION_INVALID:
    'Supply a bounded work item dataset and explicit simulated session',
  MOCK_WORK_ITEM_INTEGRITY_UNAVAILABLE: 'The simulated cursor binding could not be calculated',
  MOCK_ROUTE_NOT_FOUND: 'Mock work item route or operation not found',
  INVALID_INPUT:
    'Supply a valid work item query without write conditions; preserve filters when continuing',
  DENIED: 'The simulated session does not permit this work item read',
  WORK_ITEM_NOT_FOUND: 'The work item is unavailable in this simulated project',
  WORK_ITEM_PROJECTION_INVALID: 'The complete simulated work item response is invalid',
  GATEWAY_RESPONSE_INVALID:
    'The complete simulated response exceeds its size or representation limit',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the simulated work item read',
  GATEWAY_REQUEST_TIMEOUT: 'The simulated work item read exceeded its local deadline',
  RATE_LIMITED: 'Simulated work item read capacity is occupied',
} as const;
type ErrorCode = keyof typeof messages;
function fail(code: ErrorCode, trace: string): never {
  throw new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}
function checked<T>(code: ErrorCode, trace: string, read: () => T): T {
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

/** Fixture times retain their original precision; only the sorting position is padded to microseconds. */
function micros(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(value) ||
    value.startsWith('0000')
  )
    throw new TypeError();
  const milliseconds = value.slice(0, 23) + 'Z';
  if (new Date(milliseconds).toISOString() !== milliseconds) throw new TypeError();
  return value.slice(0, 23) + value.slice(23, -1).padEnd(3, '0') + 'Z';
}
function compareIds(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}
function encodeCursor(position: Position, key: string): string {
  const text = JSON.stringify([1, 'mock-work-items', key, position.updated, position.id]);
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCursor(cursor: string | undefined, key: string): Position | undefined {
  if (cursor === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new TypeError();
  const binary = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!Array.isArray(value) || value.length !== 5) throw new TypeError();
  const [version, kind, binding, updated, id] = value;
  if (version !== 1 || kind !== 'mock-work-items' || binding !== key || micros(updated) !== updated)
    throw new TypeError();
  const position = {
    updated: updated as string,
    id: parseWorkItemProjectionQuery({ item_id: id }).item_id,
  };
  if (encodeCursor(position, key) !== cursor) throw new TypeError();
  return position;
}

/** Immutable development dataset; no database access, write commands or live Plane observations. */
export class MockWorkItemStore {
  readonly #id = createUlid();
  readonly #scope: MockWorkItemSeed['scope'];
  readonly #items = new Map<string, Stored>();
  readonly #ordered: Stored[];
  #active = 0;

  constructor(seed: MockWorkItemSeed) {
    this.#scope = checked('MOCK_WORK_ITEM_CONFIGURATION_INVALID', configurationTrace, () => {
      const input = record(snapshot(seed, seedBytes), ['scope', 'items']);
      const scope = record(input.scope, ['tenant_id', 'workspace_id', 'project_id']);
      const identity = parseSyncCommandIdentity({ ...scope, actor_id: 'mock', client_id: 'mock' });
      if (!Array.isArray(input.items) || input.items.length > 1000) throw new TypeError();
      for (const raw of input.items) {
        const row = record(snapshot(raw, itemBytes), [
          'id',
          'external_id',
          'title',
          'status',
          'priority',
          'owner',
          'progress',
          'description',
          'due_at',
          'classification',
          'version',
          'source_refs',
          'trace_id',
          'created_at',
          'updated_at',
        ]);
        const { item_id } = parseWorkItemProjectionQuery({ item_id: row.id });
        const item = parseWorkItemProjection(row, item_id);
        if (this.#items.has(item.id)) throw new TypeError();
        for (const value of [
          item.external_id,
          item.title,
          item.owner,
          item.description,
          item.trace_id,
        ])
          if (/[\u0000\p{Cs}]/u.test(value)) throw new TypeError();
        for (const source of row.source_refs as unknown[])
          record(source, ['type', 'id'], ['revision', 'uri']);
        micros(item.created_at);
        if (item.due_at !== null) micros(item.due_at);
        this.#items.set(item.id, { item, updated: micros(item.updated_at) });
      }
      return {
        tenant_id: identity.tenant_id,
        workspace_id: identity.workspace_id,
        project_id: identity.project_id,
      };
    });
    this.#ordered = [...this.#items.values()].sort((a, b) =>
      a.updated === b.updated ? compareIds(a.item.id, b.item.id) : a.updated > b.updated ? -1 : 1,
    );
  }

  connect(session: MockWorkItemSession): WcpTransport {
    const saved = checked(
      'MOCK_WORK_ITEM_CONFIGURATION_INVALID',
      configurationTrace,
      (): Session => {
        const input = record(snapshot(session, 1024 * 1024), [
          'identity',
          'expires_at',
          'project_readable',
          'read_work_items',
          'read_restricted',
          'visible_item_ids',
        ]);
        const identity = parseSyncCommandIdentity(input.identity);
        for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (identity[field] !== this.#scope[field]) throw new TypeError();
        micros(input.expires_at);
        for (const field of ['project_readable', 'read_work_items', 'read_restricted'])
          if (typeof input[field] !== 'boolean') throw new TypeError();
        if (!Array.isArray(input.visible_item_ids) || input.visible_item_ids.length > 1000)
          throw new TypeError();
        const visible = new Set<string>();
        for (const id of input.visible_item_ids) {
          if (typeof id !== 'string' || !this.#items.has(id) || visible.has(id))
            throw new TypeError();
          visible.add(id);
        }
        return {
          identity,
          expires_at: input.expires_at as string,
          project_readable: input.project_readable as boolean,
          read_work_items: input.read_work_items as boolean,
          read_restricted: input.read_restricted as boolean,
          visible_item_ids: [...visible].sort(compareIds),
          visible,
        };
      },
    );
    return {
      request: async <T = unknown>(request: WcpRequest): Promise<T> =>
        (await this.respond(request, saved)) as T,
    };
  }

  private visible(item: WorkItemProjection, session: Session) {
    return (
      session.visible.has(item.id) &&
      (item.classification !== 'restricted' || session.read_restricted)
    );
  }

  private async list(query: WorkItemListQuery, session: Session, trace: string, live: () => void) {
    const withDue =
      query.due !== undefined || query.due_from !== undefined || query.due_before !== undefined;
    const binding = syncJsonSnapshot(
      [
        withDue ? 'mock-work-item-list-v2' : 'mock-work-item-list-v1',
        this.#id,
        session.identity,
        session.expires_at,
        session.project_readable,
        session.read_work_items,
        session.read_restricted,
        session.visible_item_ids,
        query.query ?? '',
        query.status ?? '',
        query.priority ?? '',
        query.owner ?? '',
        query.assignment ?? '',
        ...(withDue ? [query.due ?? '', query.due_from ?? '', query.due_before ?? ''] : []),
      ],
      1024 * 1024,
    );
    let key: string;
    try {
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(binding),
      );
      key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    } catch {
      live();
      return fail('MOCK_WORK_ITEM_INTEGRITY_UNAVAILABLE', trace);
    }
    live();
    const after = checked('INVALID_INPUT', trace, () => decodeCursor(query.cursor, key));
    const limit = query.limit ?? 25;
    const selected: Stored[] = [];
    const search = query.query?.toLowerCase();
    for (const stored of this.#ordered) {
      live();
      const item = stored.item;
      if (
        !this.visible(item, session) ||
        (query.status !== undefined && item.status !== query.status) ||
        (query.priority !== undefined && item.priority !== query.priority) ||
        (query.owner !== undefined && item.owner !== query.owner) ||
        (query.assignment === 'unassigned' && item.owner !== '') ||
        (query.assignment === 'assigned' && item.owner === '') ||
        !matchesWorkItemDueFilter(item.due_at, query) ||
        (search !== undefined &&
          ![item.external_id, item.title, item.owner].join(' ').toLowerCase().includes(search)) ||
        (after !== undefined &&
          !(
            stored.updated < after.updated ||
            (stored.updated === after.updated && compareIds(item.id, after.id) > 0)
          ))
      )
        continue;
      selected.push(stored);
      if (selected.length > limit) break;
    }
    const page = selected.slice(0, limit);
    const last = page[page.length - 1];
    return checked('WORK_ITEM_PROJECTION_INVALID', trace, () =>
      parseWorkItemProjectionList(
        {
          data: page.map((entry) => entry.item),
          ...(selected.length > limit && last
            ? { next_cursor: encodeCursor({ updated: last.updated, id: last.item.id }, key) }
            : {}),
        },
        query,
      ),
    );
  }

  private async respond(raw: WcpRequest, session: Session): Promise<unknown> {
    // Capture mutable caller values before the first asynchronous cursor hash.
    const { method, path, body, response_type, max_response_bytes, signal } = raw;
    let trace = 'trace_unknown';
    const headers = checked('INVALID_INPUT', trace, () => {
      const input = snapshot(raw.headers, 16 * 1024);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
      const result = new Map<string, string>();
      for (const [key, value] of Object.entries(input)) {
        if (typeof value !== 'string' || result.has(key.toLowerCase())) throw new TypeError();
        result.set(key.toLowerCase(), value);
      }
      return result;
    });
    const suppliedTrace = headers.get('x-trace-id') ?? headers.get('traceparent');
    if (
      !suppliedTrace?.trim() ||
      suppliedTrace.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(suppliedTrace)
    )
      fail('INVALID_INPUT', trace);
    trace = suppliedTrace;
    const budget = createRequestBudget(trace, 30_000, signal);
    const live = () => {
      budget.check();
      if (
        Date.parse(session.expires_at) <= Date.now() ||
        !session.read_work_items ||
        !session.project_readable
      )
        fail('DENIED', trace);
    };
    try {
      live();
      if (method !== 'POST' || path !== '/v1/workbench/query') fail('MOCK_ROUTE_NOT_FOUND', trace);
      for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (headers.get('x-' + field.replaceAll('_', '-')) !== session.identity[field])
          fail('DENIED', trace);
      for (const [header, field] of [
        ['x-expected-actor-id', 'actor_id'],
        ['x-expected-client-id', 'client_id'],
      ] as const)
        if (headers.has(header) && headers.get(header) !== session.identity[field])
          fail('DENIED', trace);
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
        ].some((key) => headers.has(key))
      )
        fail('INVALID_INPUT', trace);
      const maximum = max_response_bytes ?? responseBytes;
      if (
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        (response_type !== undefined && !['json', 'bounded-json'].includes(response_type)) ||
        (response_type === 'bounded-json' && max_response_bytes === undefined)
      )
        fail('INVALID_INPUT', trace);
      const input = checked('INVALID_INPUT', trace, () => {
        const value = snapshot(body, 8192);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
        return value as Record<string, unknown>;
      });
      const { operation, ...fields } = input;
      if (operation !== 'work_items' && operation !== 'work_item')
        fail('MOCK_ROUTE_NOT_FOUND', trace);
      const query =
        operation === 'work_items'
          ? checked('INVALID_INPUT', trace, () => parseWorkItemListQuery(fields))
          : undefined;
      const target =
        operation === 'work_item'
          ? checked('INVALID_INPUT', trace, () => parseWorkItemProjectionQuery(fields))
          : undefined;
      if (this.#active >= 2) fail('RATE_LIMITED', trace);
      return await budget.wait(async () => {
        this.#active++;
        try {
          live();
          let result: { data: WorkItemProjection | WorkItemProjection[]; next_cursor?: string };
          if (query) result = await this.list(query, session, trace, live);
          else {
            const stored = this.#items.get(target!.item_id);
            if (!stored || !this.visible(stored.item, session)) fail('WORK_ITEM_NOT_FOUND', trace);
            result = { data: parseWorkItemProjection(stored.item, target!.item_id) };
          }
          live();
          const response = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
            snapshot(
              {
                schema_version: 1,
                trace_id: trace,
                source_refs: [{ type: 'mock-work-item-store', id: this.#id }],
                ...result,
              },
              Math.min(maximum, responseBytes),
            ),
          );
          live();
          return response;
        } finally {
          // Retain the slot if the outer wait stops before the underlying hash settles.
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
          ? (envelope.code as ErrorCode)
          : 'WORK_ITEM_PROJECTION_INVALID',
        trace,
      );
    } finally {
      budget.close();
    }
  }
}
