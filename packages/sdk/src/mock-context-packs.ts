import {
  ContractError,
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  contextPackReadHashJson,
  isSyncIdentifier,
  isUlid,
  parseContextPackReadEnvelope,
  parseContextPackReadQuery,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type ContextPackReadEnvelope,
  type ContextPackReadQuery,
  type SyncCommandIdentity,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

type Scope = Pick<SyncCommandIdentity, 'tenant_id' | 'workspace_id' | 'project_id'>;
export interface MockContextPackSeed {
  scope: Scope;
  packs: Array<{
    /** Complete saved json-format response; its digest is checked when read, never generated. */
    response: ContextPackReadEnvelope;
    /** Original compilation visibility bucket, including packs with no restricted selections. */
    read_restricted: boolean;
    /** Explicit scenario only; this store never queries or refreshes source records. */
    sources_current: boolean;
  }>;
}
export interface MockContextPackSession {
  identity: SyncCommandIdentity;
  expires_at: string;
  project_readable: boolean;
  read_context: boolean;
  read_restricted: boolean;
  visible_pack_ids: string[];
}
type Stored = MockContextPackSeed['packs'][number];
type Session = MockContextPackSession & { visible: Set<string> };
const configurationTrace = 'trace_mock_context_pack_configuration';
const messages = {
  MOCK_CONTEXT_PACK_CONFIGURATION_INVALID:
    'Supply a bounded complete saved-pack dataset and explicit simulated session',
  MOCK_ROUTE_NOT_FOUND: 'Mock saved context pack read route not found',
  INVALID_INPUT: 'Supply a valid saved pack read without write or cache conditions',
  DENIED: 'The simulated session does not permit saved context pack reads',
  CONTEXT_PACK_NOT_FOUND: 'The selected saved pack is unavailable in this simulated project',
  CONTEXT_PACK_EXPIRED: 'The selected saved context pack expired',
  CONTEXT_PACK_STALE: 'The simulated sources of the selected saved pack changed',
  CONTEXT_PACK_INVALID: 'The complete simulated saved context pack could not be validated',
  CONTEXT_PACK_INTEGRITY_UNAVAILABLE: 'Saved context pack integrity checking is unavailable',
  CONTEXT_PACK_HASH_MISMATCH: 'The complete simulated saved pack differs from its saved hash',
  GATEWAY_RESPONSE_INVALID: 'The complete simulated saved pack exceeds its response limit',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the simulated saved context pack',
  GATEWAY_REQUEST_TIMEOUT: 'The simulated saved context pack read exceeded its local deadline',
  RATE_LIMITED: 'Simulated saved context pack read capacity is occupied',
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
function record(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    fields.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !fields.includes(key))
  )
    throw new TypeError();
  return row;
}
function expiry(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    value.startsWith('0000') ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError();
  return value;
}
export function isMockContextPackPath(path: unknown): path is string {
  return typeof path === 'string' && /^\/v1\/context-pack(?:[?#].*)?$/.test(path);
}
function queryFromPath(path: string): ContextPackReadQuery {
  if (new TextEncoder().encode(path).byteLength > 4096 || path.includes('#')) throw new TypeError();
  const fields: Record<string, string> = {};
  const params = new URLSearchParams(path.slice('/v1/context-pack'.length));
  for (const [key, value] of params) {
    if (!['pack_id', 'format'].includes(key) || Object.hasOwn(fields, key)) throw new TypeError();
    fields[key] = value;
  }
  return parseContextPackReadQuery(fields);
}

/** Fixed supplied snapshots and explicit source-state scenarios; no compiler or source database. */
export class MockContextPackStore {
  readonly #scope: Scope;
  readonly #packs = new Map<string, Stored>();
  readonly #ordered: Stored[];
  #active = 0;

  constructor(seed: MockContextPackSeed) {
    const prepared = checked('MOCK_CONTEXT_PACK_CONFIGURATION_INVALID', configurationTrace, () => {
      const input = record(snapshot(seed, 16 * 1024 * 1024), ['scope', 'packs']);
      const scopeRow = record(input.scope, ['tenant_id', 'workspace_id', 'project_id']);
      for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (!isUlid(scopeRow[field])) throw new TypeError();
      const scope = scopeRow as Scope;
      if (!Array.isArray(input.packs) || input.packs.length > 100) throw new TypeError();
      const packs: Stored[] = [];
      const ids = new Set<string>();
      for (const entry of input.packs) {
        const row = record(entry, ['response', 'read_restricted', 'sources_current']);
        if (typeof row.read_restricted !== 'boolean' || typeof row.sources_current !== 'boolean')
          throw new TypeError();
        const raw = row.response as ContextPackReadEnvelope;
        const response = parseContextPackReadEnvelope(raw, { format: 'json' }, scope, raw.trace_id);
        if (
          ids.has(response.data.pack_id) ||
          (!row.read_restricted &&
            response.data.pack.items.some((item) => item.sensitivity === 'restricted'))
        )
          throw new TypeError();
        ids.add(response.data.pack_id);
        packs.push({
          response,
          read_restricted: row.read_restricted,
          sources_current: row.sources_current,
        });
      }
      return { scope, packs };
    });
    this.#scope = prepared.scope;
    for (const pack of prepared.packs) this.#packs.set(pack.response.data.pack_id, pack);
    // Match the production latest selection, without filtering stale or expired candidates first.
    this.#ordered = prepared.packs.sort((a, b) => {
      const left = a.response.data;
      const right = b.response.data;
      return (
        right.version - left.version ||
        (left.pack_id < right.pack_id ? 1 : left.pack_id > right.pack_id ? -1 : 0)
      );
    });
  }

  connect(session: MockContextPackSession): WcpTransport {
    const saved = checked(
      'MOCK_CONTEXT_PACK_CONFIGURATION_INVALID',
      configurationTrace,
      (): Session => {
        const input = record(snapshot(session, 64 * 1024), [
          'identity',
          'expires_at',
          'project_readable',
          'read_context',
          'read_restricted',
          'visible_pack_ids',
        ]);
        const identity = parseSyncCommandIdentity(input.identity);
        for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (identity[field] !== this.#scope[field]) throw new TypeError();
        if (!isUlid(identity.actor_id) || !isSyncIdentifier(identity.client_id))
          throw new TypeError();
        const expires_at = expiry(input.expires_at);
        for (const field of ['project_readable', 'read_context', 'read_restricted'])
          if (typeof input[field] !== 'boolean') throw new TypeError();
        if (!Array.isArray(input.visible_pack_ids) || input.visible_pack_ids.length > 100)
          throw new TypeError();
        const visible = new Set<string>();
        for (const id of input.visible_pack_ids) {
          if (typeof id !== 'string' || !this.#packs.has(id) || visible.has(id))
            throw new TypeError();
          visible.add(id);
        }
        return {
          identity,
          expires_at,
          project_readable: input.project_readable as boolean,
          read_context: input.read_context as boolean,
          read_restricted: input.read_restricted as boolean,
          visible_pack_ids: [...visible],
          visible,
        };
      },
    );
    return {
      request: async <T = unknown>(request: WcpRequest): Promise<T> =>
        (await this.respond(request, saved)) as T,
    };
  }

  private async respond(raw: WcpRequest, session: Session): Promise<unknown> {
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
    if (!isSyncIdentifier(suppliedTrace)) fail('INVALID_INPUT', trace);
    trace = suppliedTrace;
    const budget = checked('INVALID_INPUT', trace, () =>
      createRequestBudget(trace, 30_000, signal),
    );
    const live = () => {
      budget.check();
      if (Date.parse(session.expires_at) <= Date.now() || !session.read_context)
        fail('DENIED', trace);
      if (!session.project_readable) fail('CONTEXT_PACK_NOT_FOUND', trace);
    };
    try {
      live();
      if (method !== 'GET' || !isMockContextPackPath(path)) fail('MOCK_ROUTE_NOT_FOUND', trace);
      if (body !== undefined) fail('INVALID_INPUT', trace);
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
        ].some((key) => headers.has(key)) ||
        (headers.has('traceparent') && headers.get('traceparent') !== trace)
      )
        fail('INVALID_INPUT', trace);
      const query = checked('INVALID_INPUT', trace, () => queryFromPath(path));
      const maximum =
        max_response_bytes === undefined ? CONTEXT_PACK_READ_RESPONSE_BYTES : max_response_bytes;
      if (
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        (response_type !== undefined && !['json', 'bounded-json'].includes(response_type)) ||
        (response_type === 'bounded-json' && max_response_bytes === undefined)
      )
        fail('INVALID_INPUT', trace);
      const available = (pack: Stored) =>
        session.visible.has(pack.response.data.pack_id) &&
        (!pack.read_restricted || session.read_restricted);
      const selected =
        query.pack_id === undefined
          ? this.#ordered.find(available)
          : this.#packs.get(query.pack_id);
      if (!selected || !available(selected)) fail('CONTEXT_PACK_NOT_FOUND', trace);
      if (this.#active >= 2) fail('RATE_LIMITED', trace);
      return await budget.wait(async () => {
        this.#active++;
        try {
          live();
          const response = checked('CONTEXT_PACK_INVALID', trace, () =>
            parseContextPackReadEnvelope(
              { ...selected.response, trace_id: trace },
              { pack_id: selected.response.data.pack_id, format: 'json' },
              this.#scope,
              trace,
            ),
          );
          const bytes = checked('CONTEXT_PACK_INVALID', trace, () =>
            new TextEncoder().encode(contextPackReadHashJson(response.data.pack)),
          );
          live();
          let digest: ArrayBuffer;
          try {
            // Await the actual digest so canceling the outer wait cannot release capacity early.
            digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer);
            if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
          } catch {
            live();
            return fail('CONTEXT_PACK_INTEGRITY_UNAVAILABLE', trace);
          }
          live();
          const hash =
            'sha256:' +
            Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
              '',
            );
          if (hash !== response.data.pack.pack_hash) fail('CONTEXT_PACK_HASH_MISMATCH', trace);
          const current = () => {
            live();
            if (Date.parse(response.data.pack.expires_at) <= Date.now())
              fail('CONTEXT_PACK_EXPIRED', trace);
            if (!selected.sources_current) fail('CONTEXT_PACK_STALE', trace);
          };
          current();
          if (query.format !== 'json') {
            response.data.rendered = {
              uri: `work://project/${encodeURIComponent(this.#scope.project_id)}/context-pack/${encodeURIComponent(response.data.pack_id)}`,
              mimeType: 'text/markdown',
              text: response.data.pack.items
                .map(
                  (item) =>
                    `## ${item.layer} ${item.id}\n\n${item.content}\n\nSource: ${item.source_refs.map((ref) => `${ref.type}:${ref.id}`).join(', ')}`,
                )
                .join('\n\n'),
            };
          }
          const bounded = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
            snapshot(response, Math.min(maximum, CONTEXT_PACK_READ_RESPONSE_BYTES)),
          );
          const result = checked('CONTEXT_PACK_INVALID', trace, () =>
            parseContextPackReadEnvelope(bounded, query, this.#scope, trace),
          );
          current();
          return result;
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
          ? (envelope.code as ErrorCode)
          : 'CONTEXT_PACK_INVALID',
        trace,
      );
    } finally {
      budget.close();
    }
  }
}
