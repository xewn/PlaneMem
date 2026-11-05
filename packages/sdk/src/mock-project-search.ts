import {
  ContractError,
  createUlid,
  compareObservedExternalIds,
  parseLegacyContextIdentity,
  parseProjectSearchQuery,
  parseProjectSearchEnvelope,
  projectSearchSources,
  syncJsonSnapshot,
  SEARCH_INPUT_BYTES,
  SEARCH_RESPONSE_BYTES,
  type Classification,
  type LegacyContextIdentity,
  type ProjectSearchHit,
  type SearchResponseScope,
  type NormalizedProjectSearchQuery,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export type MockProjectSearchRecord = Omit<ProjectSearchHit, 'snippet' | 'score'> & {
  body: string;
  external_id: string | null;
  owner: string | null;
  deleted: boolean;
};
export interface MockProjectSearchSeed {
  scope: SearchResponseScope;
  project_classification: Classification;
  records: MockProjectSearchRecord[];
  /** Each configured query lists all matches; omission is an explicit nonmatch. */
  fts_queries: Array<{
    query: string;
    matches: Array<Pick<ProjectSearchHit, 'type' | 'id' | 'score'>>;
  }>;
}
export interface MockProjectSearchSession {
  identity: LegacyContextIdentity;
  expires_at: string;
  read_context: boolean;
  read_restricted: boolean;
  project_readable: boolean;
  visible_records: Array<Pick<ProjectSearchHit, 'type' | 'id'>>;
}
type Position = Pick<ProjectSearchHit, 'type' | 'id' | 'score'> & { updated: string };
type RecordRow = { hit: ProjectSearchHit; position: Position; text: string; deleted: boolean };
type Session = MockProjectSearchSession & { visible: Set<string> };
const configurationTrace = 'trace_mock_project_search_configuration';
const messages = {
  MOCK_SEARCH_CONFIGURATION_INVALID:
    'Supply complete search records, query scenarios and simulated access',
  MOCK_SEARCH_SCENARIO_UNCONFIGURED: 'Configure the complete match list for this FTS query first',
  MOCK_SEARCH_INTEGRITY_UNAVAILABLE: 'The simulated search cursor could not be calculated',
  MOCK_ROUTE_NOT_FOUND: 'Mock project search route or method not found',
  INVALID_INPUT: 'Supply valid search parameters and bounded JSON read options',
  UNAUTHENTICATED: 'The simulated session has expired',
  DENIED: 'The simulated identity or permissions do not allow this search',
  SEARCH_RESULT_INVALID: 'The complete simulated search result is invalid',
  GATEWAY_RESPONSE_INVALID: 'The simulated search response exceeds its representation limit',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the simulated search',
  GATEWAY_REQUEST_TIMEOUT: 'The simulated search exceeded its local deadline',
  RATE_LIMITED: 'Simulated search capacity is occupied',
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
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== names.length || names.some((name) => !Object.hasOwn(row, name)))
    throw new TypeError();
  return row;
}
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
function text(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000\p{Cs}]/u.test(value)) throw new TypeError();
  return value;
}
function key(row: Pick<ProjectSearchHit, 'type' | 'id'>) {
  return JSON.stringify([row.type, row.id]);
}
function compare(a: Position, b: Position): number {
  return (
    b.score - a.score ||
    (a.updated === b.updated ? 0 : a.updated > b.updated ? -1 : 1) ||
    compareObservedExternalIds(a.type, b.type) ||
    compareObservedExternalIds(a.id, b.id)
  );
}
function encode(binding: string, row: Position): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify([1, binding, row.score, row.updated, row.type, row.id]),
  );
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decode(cursor: string, binding: string): Position {
  const bytes = Uint8Array.from(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
    char.charCodeAt(0),
  );
  const parts: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    !Array.isArray(parts) ||
    parts.length !== 6 ||
    parts[0] !== 1 ||
    parts[1] !== binding ||
    typeof parts[2] !== 'number' ||
    !Number.isFinite(parts[2]) ||
    parts[2] < 0 ||
    parts[2] > 1 ||
    !['work_item', 'context_item'].includes(parts[4]) ||
    typeof parts[5] !== 'string'
  )
    throw new TypeError();
  const row: Position = {
    score: parts[2],
    updated: micros(parts[3]),
    type: parts[4] as Position['type'],
    id: parts[5],
  };
  if (encode(binding, row) !== cursor) throw new TypeError();
  return row;
}
export function isMockProjectSearchPath(path: unknown): path is string {
  return typeof path === 'string' && /^\/v1\/search(?:[/?#]|$)/.test(path);
}

/** Fixed complete records. Substring matching is literal; PostgreSQL FTS scores are supplied fixtures. */
export class MockProjectSearchStore {
  readonly #id = createUlid();
  readonly #scope: SearchResponseScope;
  readonly #classification: Classification;
  readonly #records: Map<string, RecordRow>;
  readonly #queries: Map<string, Map<string, number>>;
  #active = 0;

  constructor(seed: MockProjectSearchSeed) {
    const saved = checked('MOCK_SEARCH_CONFIGURATION_INVALID', configurationTrace, () => {
      const input = fields(snapshot(seed, 16 * 1024 * 1024), [
        'scope',
        'project_classification',
        'records',
        'fts_queries',
      ]);
      const rawScope = fields(input.scope, ['tenant_id', 'workspace_id', 'project_id']);
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
        !['public', 'internal', 'confidential', 'restricted'].includes(
          input.project_classification as string,
        ) ||
        !Array.isArray(input.records) ||
        input.records.length > 1000 ||
        !Array.isArray(input.fts_queries) ||
        input.fts_queries.length > 1000
      )
        throw new TypeError();
      const records = new Map<string, RecordRow>();
      const query = parseProjectSearchQuery({ query: 'fixture', include_inactive_context: true });
      for (const value of input.records) {
        const row = fields(value, [
          'type',
          'id',
          'title',
          'version',
          'status',
          'classification',
          'updated_at',
          'expires_at',
          'source_refs',
          'body',
          'external_id',
          'owner',
          'deleted',
        ]);
        const body = text(row.body),
          title = text(row.title);
        const external = row.external_id === null ? null : text(row.external_id);
        const owner = row.owner === null ? null : text(row.owner);
        if (
          typeof row.deleted !== 'boolean' ||
          (row.type === 'context_item' && (row.external_id !== null || row.owner !== null)) ||
          (row.type === 'work_item' && row.expires_at !== null)
        )
          throw new TypeError();
        if (row.expires_at !== null) micros(row.expires_at);
        const updated = micros(row.updated_at);
        const hit = parseProjectSearchEnvelope(
          {
            schema_version: 1,
            trace_id: configurationTrace,
            source_refs: projectSearchSources('all'),
            data: {
              query: query.query,
              type: query.type,
              mode: query.mode,
              include_inactive_context: true,
              scope,
              backend: 'postgres',
              vector_used: false,
              hits: [
                {
                  type: row.type,
                  id: row.id,
                  title,
                  version: row.version,
                  status: row.status,
                  classification: row.classification,
                  updated_at: row.updated_at,
                  expires_at: row.expires_at,
                  source_refs: row.source_refs,
                  snippet: Array.from(body).slice(0, 360).join(''),
                  score: 0,
                },
              ],
            },
          },
          query,
          scope,
          configurationTrace,
        ).data.hits[0]!;
        const id = key(hit);
        if (records.has(id)) throw new TypeError();
        records.set(id, {
          hit,
          position: { type: hit.type, id: hit.id, score: 0, updated },
          deleted: row.deleted,
          text: (hit.type === 'work_item' ? [title, external, body, owner] : [title, body])
            .filter((value) => value !== null)
            .join(' ')
            .toLowerCase(),
        });
      }
      const queries = new Map<string, Map<string, number>>();
      for (const value of input.fts_queries) {
        const row = fields(value, ['query', 'matches']);
        const query = parseProjectSearchQuery({ query: row.query as string }).query;
        if (queries.has(query) || !Array.isArray(row.matches) || row.matches.length > 1000)
          throw new TypeError();
        const matches = new Map<string, number>();
        for (const value of row.matches) {
          const match = fields(value, ['type', 'id', 'score']);
          const id = JSON.stringify([match.type, match.id]);
          if (
            !records.has(id) ||
            matches.has(id) ||
            typeof match.score !== 'number' ||
            !Number.isFinite(match.score) ||
            match.score < 0 ||
            match.score > 1
          )
            throw new TypeError();
          matches.set(id, match.score);
        }
        queries.set(query, matches);
      }
      return {
        scope,
        classification: input.project_classification as Classification,
        records,
        queries,
      };
    });
    this.#scope = saved.scope;
    this.#classification = saved.classification;
    this.#records = saved.records;
    this.#queries = saved.queries;
  }

  connect(input: MockProjectSearchSession): WcpTransport {
    const session = checked(
      'MOCK_SEARCH_CONFIGURATION_INVALID',
      configurationTrace,
      (): Session => {
        const raw = fields(snapshot(input, 1024 * 1024), [
          'identity',
          'expires_at',
          'read_context',
          'read_restricted',
          'project_readable',
          'visible_records',
        ]);
        const identity = parseLegacyContextIdentity(raw.identity);
        for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (identity[field] !== this.#scope[field]) throw new TypeError();
        for (const field of ['read_context', 'read_restricted', 'project_readable'])
          if (typeof raw[field] !== 'boolean') throw new TypeError();
        const expires_at = micros(raw.expires_at);
        if (!Array.isArray(raw.visible_records) || raw.visible_records.length > 1000)
          throw new TypeError();
        const visible = new Set<string>();
        const visible_records = raw.visible_records
          .map((value) => {
            const row = fields(value, ['type', 'id']);
            const id = JSON.stringify([row.type, row.id]);
            const record = this.#records.get(id);
            if (!record || visible.has(id)) throw new TypeError();
            visible.add(id);
            return { type: record.hit.type, id: record.hit.id };
          })
          .sort((a, b) => compareObservedExternalIds(key(a), key(b)));
        return {
          identity,
          expires_at,
          visible,
          visible_records,
          read_context: raw.read_context as boolean,
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

  private async page(
    query: NormalizedProjectSearchQuery,
    session: Session,
    trace: string,
    live: () => void,
  ) {
    const matches = query.mode === 'fts' ? this.#queries.get(query.query) : undefined;
    if (query.mode === 'fts' && !matches) fail('MOCK_SEARCH_SCENARIO_UNCONFIGURED', trace);
    let binding: string;
    try {
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify([
            'mock-project-search-v1',
            this.#id,
            this.#scope,
            session.identity,
            session.expires_at,
            session.read_context,
            session.read_restricted,
            session.project_readable,
            session.visible_records,
            query.query,
            query.type,
            query.mode,
            query.include_inactive_context,
          ]),
        ),
      );
      live();
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
      binding = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
    } catch {
      live();
      return fail('MOCK_SEARCH_INTEGRITY_UNAVAILABLE', trace);
    }
    const after =
      query.cursor === undefined
        ? undefined
        : checked('INVALID_INPUT', trace, () => decode(query.cursor!, binding));
    const candidates: Array<{ hit: ProjectSearchHit; position: Position }> = [];
    const now = micros(new Date().toISOString());
    const parentVisible =
      session.project_readable &&
      (this.#classification !== 'restricted' || session.read_restricted);
    for (const [id, row] of this.#records) {
      const hit = row.hit;
      if (
        !parentVisible ||
        row.deleted ||
        !session.visible.has(id) ||
        (!session.read_restricted && hit.classification === 'restricted') ||
        (query.type !== 'all' && query.type !== hit.type) ||
        (!query.include_inactive_context &&
          hit.type === 'context_item' &&
          (!['confirmed', 'proposed'].includes(hit.status) ||
            (hit.expires_at !== null && micros(hit.expires_at) <= now)))
      )
        continue;
      const score =
        query.mode === 'fts'
          ? matches!.get(id)
          : row.text.includes(query.query.toLowerCase())
            ? 0
            : undefined;
      if (score === undefined) continue;
      const position = { ...row.position, score };
      if (after && compare(position, after) <= 0) continue;
      candidates.push({ hit: { ...hit, score }, position });
    }
    candidates.sort((a, b) => compare(a.position, b.position));
    const selected = candidates.slice(0, query.limit);
    return parseProjectSearchEnvelope(
      {
        schema_version: 1,
        trace_id: trace,
        source_refs: projectSearchSources(query.type),
        data: {
          query: query.query,
          type: query.type,
          mode: query.mode,
          include_inactive_context: query.include_inactive_context,
          scope: this.#scope,
          hits: selected.map((row) => row.hit),
          backend: 'postgres',
          vector_used: false,
          ...(candidates.length > query.limit
            ? { next_cursor: encode(binding, selected.at(-1)!.position) }
            : {}),
        },
      },
      query,
      this.#scope,
      trace,
    );
  }

  private async respond(raw: WcpRequest, session: Session): Promise<unknown> {
    const { method, path, body, response_type, max_response_bytes, signal } = raw;
    let trace = 'trace_unknown';
    const headers = checked('INVALID_INPUT', trace, () => {
      const input = snapshot(raw.headers, 16 * 1024);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
      const result = new Map<string, string>();
      for (const [key, value] of Object.entries(input)) {
        if (
          typeof value !== 'string' ||
          result.has(key.toLowerCase()) ||
          /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
        )
          throw new TypeError();
        result.set(key.toLowerCase(), value);
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
      if (session.expires_at <= micros(new Date().toISOString())) fail('UNAUTHENTICATED', trace);
      if (!session.read_context) fail('DENIED', trace);
    };
    try {
      live();
      if (method !== 'POST' || path !== '/v1/search') fail('MOCK_ROUTE_NOT_FOUND', trace);
      for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (headers.get('x-' + field.replaceAll('_', '-')) !== session.identity[field])
          fail('DENIED', trace);
      for (const field of ['actor_id', 'client_id'] as const) {
        const value = headers.get('x-expected-' + field.replaceAll('_', '-'));
        if (value !== undefined && value !== session.identity[field]) fail('DENIED', trace);
      }
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
          'content-length',
          'transfer-encoding',
        ].some((key) => headers.has(key))
      )
        fail('INVALID_INPUT', trace);
      const maximum = max_response_bytes ?? SEARCH_RESPONSE_BYTES;
      if (
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        (response_type !== undefined && !['json', 'bounded-json'].includes(response_type)) ||
        (response_type === 'bounded-json' && max_response_bytes === undefined)
      )
        fail('INVALID_INPUT', trace);
      const query = checked('INVALID_INPUT', trace, () =>
        parseProjectSearchQuery(snapshot(body, SEARCH_INPUT_BYTES)),
      );
      if (this.#active >= 2) fail('RATE_LIMITED', trace);
      return await budget.wait(async () => {
        this.#active++;
        try {
          live();
          const result = await this.page(query, session, trace, live);
          const response = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
            snapshot(result, Math.min(maximum, SEARCH_RESPONSE_BYTES)),
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
          : 'SEARCH_RESULT_INVALID',
        trace,
      );
    } finally {
      budget.close();
    }
  }
}
