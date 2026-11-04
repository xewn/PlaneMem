import {
  ContractError,
  CONTEXT_HISTORY_RESPONSE_BYTES,
  CONTEXT_REVISION_RESPONSE_BYTES,
  CONTEXT_ITEM_READ_RESPONSE_BYTES,
  contextRevisionSnapshotJson,
  isSyncIdentifier,
  isUlid,
  parseContextHistoryReadEnvelope,
  parseContextHistoryReadQuery,
  parseContextItemReadEnvelope,
  parseContextItemReadQuery,
  parseContextRevision,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type Classification,
  type ContextHistoryReadQuery,
  type ContextItemReadEnvelope,
  type ContextItemReadQuery,
  type ContextItemDocument,
  type ContextItemRevision,
  type ContextItemRevisionSummary,
  type SourceRef,
  type SyncCommandIdentity,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

type Scope = Pick<SyncCommandIdentity, 'tenant_id' | 'workspace_id' | 'project_id'>;
export interface MockContextHistorySeed {
  scope: Scope;
  items: Array<{
    item_id: string;
    current_version: number;
    current_archived: boolean;
    current_classification: Classification;
    /** Complete supplied current observation, or archived detail; never derived from history. */
    current_detail?: ContextItemReadEnvelope;
    revisions: ContextItemRevision[];
  }>;
}
/** Explicit simulated human/review decisions; they never authorize a write. */
export interface MockContextReviewAccess {
  human: boolean;
  review_context: boolean;
}
/** Explicit simulated decisions, never inferred from headers or historical authors. */
export interface MockContextHistorySession {
  identity: SyncCommandIdentity;
  expires_at: string;
  project_readable: boolean;
  read_context: boolean;
  read_restricted: boolean;
  visible_item_ids: string[];
  review_access?: MockContextReviewAccess;
}
type Session = MockContextHistorySession & { visible: Set<string>; can_review: boolean };
type ReadQuery = ContextHistoryReadQuery | ContextItemReadQuery;
type Stored = Omit<MockContextHistorySeed['items'][number], 'revisions'> & {
  revisions: Map<number, ContextItemRevision>;
  ordered: ContextItemRevision[];
};
const seedBytes = 16 * 1024 * 1024;
const configurationTrace = 'trace_mock_context_history_configuration';
const classifications = ['public', 'internal', 'confidential', 'restricted'];
const messages = {
  MOCK_CONTEXT_HISTORY_CONFIGURATION_INVALID:
    'Supply a bounded context detail/history dataset and explicit simulated session',
  MOCK_ROUTE_NOT_FOUND: 'Mock context read route not found',
  INVALID_INPUT: 'Supply a valid context read query without body, write or cache conditions',
  DENIED: 'The simulated session does not permit this context read',
  CONTEXT_ITEM_NOT_FOUND:
    'The selected item view or recorded version is unavailable in this simulated project',
  CONTEXT_ITEM_INVALID: 'The complete simulated context response is invalid',
  CONTEXT_HISTORY_INTEGRITY_UNAVAILABLE:
    'Snapshot integrity checking is unavailable; no unchecked version was returned',
  CONTEXT_HISTORY_HASH_MISMATCH:
    'The complete simulated context snapshot differs from its saved hash',
  GATEWAY_RESPONSE_INVALID:
    'The complete simulated response exceeds its size or representation limit',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the simulated context read',
  GATEWAY_REQUEST_TIMEOUT: 'The simulated context read exceeded its local deadline',
  RATE_LIMITED: 'Simulated context read capacity is occupied',
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
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError();
  return value;
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
function summarize(revision: ContextItemRevision): ContextItemRevisionSummary {
  const { item: _item, archived_at: _archived, confirmation: _confirmation, ...summary } = revision;
  return summary;
}
function isDetailQuery(query: ReadQuery): query is ContextItemReadQuery {
  return query.kind === 'current' || query.kind === 'archived';
}
/** Compare saved fields only; live source diagnostics are not historical snapshot fields. */
function requireMatchingDetail(detail: ContextItemReadEnvelope, revision: ContextItemRevision) {
  let item: ContextItemDocument;
  let archived_at: string | null;
  if ('archived_at' in detail.data) {
    const { archived_at: archived, ...saved } = detail.data;
    archived_at = archived;
    item = saved;
  } else {
    const {
      confirm_allowed: _allowed,
      confirmation,
      sources_current: _current,
      source_check: _check,
      source_checks: _checks,
      confirmation_readiness: _readiness,
      ...saved
    } = detail.data;
    item = saved;
    archived_at = null;
    if (revision.confirmation) {
      if (!confirmation) throw new TypeError();
      for (const field of [
        'reviewed_version',
        'confirmed_version',
        'actor_id',
        'client_id',
        'event_id',
        'reason',
        'confirmed_at',
      ] as const)
        if (confirmation[field] !== revision.confirmation[field]) throw new TypeError();
    }
  }
  if (
    contextRevisionSnapshotJson({ ...revision, item, archived_at }) !==
    contextRevisionSnapshotJson(revision)
  )
    throw new TypeError();
}
export function isMockContextHistoryPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    /^\/v1\/context-items\/[^/]+\/(?:history|versions\/[^/]+)(?:\?.*)?$/.test(path)
  );
}
export function isMockContextReadPath(path: unknown): path is string {
  return (
    isMockContextHistoryPath(path) ||
    (typeof path === 'string' &&
      /^\/v1\/context-items\/[^/?#]+(?:\/archived)?(?:[?#].*)?$/.test(path))
  );
}
function queryFromPath(path: string): ReadQuery {
  if (new TextEncoder().encode(path).byteLength > 4096 || path.includes('#')) throw new TypeError();
  const detail = /^\/v1\/context-items\/([^/?]+)(\/archived)?$/.exec(path);
  if (detail) {
    const item_id = decodeURIComponent(detail[1]!);
    if (encodeURIComponent(item_id) !== detail[1]) throw new TypeError();
    return parseContextItemReadQuery({ kind: detail[2] ? 'archived' : 'current', item_id });
  }
  const version = /^\/v1\/context-items\/([^/?]+)\/versions\/([1-9][0-9]*)$/.exec(path);
  const history = /^\/v1\/context-items\/([^/?]+)\/history(?:\?(.*))?$/.exec(path);
  const match = version ?? history;
  if (!match) throw new TypeError();
  const item_id = decodeURIComponent(match[1]!);
  if (encodeURIComponent(item_id) !== match[1]) throw new TypeError();
  if (version)
    return parseContextHistoryReadQuery({ kind: 'version', item_id, version: Number(version[2]) });
  const parameters = new URLSearchParams(history![2] ?? '');
  const input: Record<string, unknown> = { kind: 'history', item_id };
  for (const [key, value] of parameters) {
    if (
      !['before_version', 'limit'].includes(key) ||
      Object.hasOwn(input, key) ||
      !/^[1-9][0-9]*$/.test(value)
    )
      throw new TypeError();
    input[key] = Number(value);
  }
  return parseContextHistoryReadQuery(input);
}

/** Immutable supplied details/history; no invented observations, revisions or database effects. */
export class MockContextHistoryStore {
  readonly #scope: Scope;
  readonly #items = new Map<string, Stored>();
  #active = 0;

  constructor(seed: MockContextHistorySeed) {
    this.#scope = checked('MOCK_CONTEXT_HISTORY_CONFIGURATION_INVALID', configurationTrace, () => {
      const input = record(snapshot(seed, seedBytes), ['scope', 'items']);
      const rawScope = record(input.scope, ['tenant_id', 'workspace_id', 'project_id']);
      if (
        !isUlid(rawScope.tenant_id) ||
        !isUlid(rawScope.workspace_id) ||
        !isUlid(rawScope.project_id)
      )
        throw new TypeError();
      const scope = {
        tenant_id: rawScope.tenant_id,
        workspace_id: rawScope.workspace_id,
        project_id: rawScope.project_id,
      };
      if (!Array.isArray(input.items) || input.items.length > 1000) throw new TypeError();
      let count = 0;
      for (const raw of input.items) {
        const row = record(
          raw,
          ['item_id', 'current_version', 'current_archived', 'current_classification', 'revisions'],
          ['current_detail'],
        );
        const target = parseContextHistoryReadQuery({ kind: 'history', item_id: row.item_id });
        const current_version = positive(row.current_version);
        if (
          this.#items.has(target.item_id) ||
          typeof row.current_archived !== 'boolean' ||
          typeof row.current_classification !== 'string' ||
          !classifications.includes(row.current_classification) ||
          !Array.isArray(row.revisions) ||
          (count += row.revisions.length) > 1000
        )
          throw new TypeError();
        const revisions = new Map<number, ContextItemRevision>();
        for (const rawRevision of row.revisions) {
          if (!rawRevision || typeof rawRevision !== 'object' || Array.isArray(rawRevision))
            throw new TypeError();
          const version = positive((rawRevision as Record<string, unknown>).version);
          if (version > current_version || revisions.has(version)) throw new TypeError();
          const revision = parseContextRevision(
            rawRevision,
            { kind: 'version', item_id: target.item_id, version },
            scope,
          );
          if (
            version === current_version &&
            (revision.archived !== row.current_archived ||
              revision.classification !== row.current_classification)
          )
            throw new TypeError();
          revisions.set(version, revision);
        }
        let current_detail: ContextItemReadEnvelope | undefined;
        if (Object.hasOwn(row, 'current_detail')) {
          const supplied = record(row.current_detail, [
            'schema_version',
            'trace_id',
            'source_refs',
            'revision',
            'etag',
            'data',
          ]);
          if (!isSyncIdentifier(supplied.trace_id)) throw new TypeError();
          current_detail = parseContextItemReadEnvelope(
            supplied,
            { kind: row.current_archived ? 'archived' : 'current', item_id: target.item_id },
            scope,
            supplied.trace_id,
          );
          if (
            current_detail.revision !== current_version ||
            current_detail.data.classification !== row.current_classification
          )
            throw new TypeError();
          const revision = revisions.get(current_version);
          if (revision) requireMatchingDetail(current_detail, revision);
        }
        this.#items.set(target.item_id, {
          item_id: target.item_id,
          current_version,
          current_archived: row.current_archived,
          current_classification: row.current_classification as Classification,
          ...(current_detail === undefined ? {} : { current_detail }),
          revisions,
          ordered: [...revisions.values()].sort((a, b) => b.version - a.version),
        });
      }
      return scope;
    });
  }

  connect(session: MockContextHistorySession): WcpTransport {
    const saved = checked(
      'MOCK_CONTEXT_HISTORY_CONFIGURATION_INVALID',
      configurationTrace,
      (): Session => {
        const input = record(
          snapshot(session, 1024 * 1024),
          [
            'identity',
            'expires_at',
            'project_readable',
            'read_context',
            'read_restricted',
            'visible_item_ids',
          ],
          ['review_access'],
        );
        const identity = parseSyncCommandIdentity(input.identity);
        for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (identity[field] !== this.#scope[field]) throw new TypeError();
        if (!isUlid(identity.actor_id) || !isSyncIdentifier(identity.client_id))
          throw new TypeError();
        const expires_at = expiry(input.expires_at);
        for (const field of ['project_readable', 'read_context', 'read_restricted'])
          if (typeof input[field] !== 'boolean') throw new TypeError();
        if (!Array.isArray(input.visible_item_ids) || input.visible_item_ids.length > 1000)
          throw new TypeError();
        const visible = new Set<string>();
        for (const id of input.visible_item_ids) {
          if (typeof id !== 'string' || !this.#items.has(id) || visible.has(id))
            throw new TypeError();
          visible.add(id);
        }
        let can_review = false;
        if (Object.hasOwn(input, 'review_access')) {
          const access = record(input.review_access, ['human', 'review_context']);
          if (typeof access.human !== 'boolean' || typeof access.review_context !== 'boolean')
            throw new TypeError();
          can_review = access.human && access.review_context;
        }
        return {
          identity,
          expires_at,
          project_readable: input.project_readable as boolean,
          read_context: input.read_context as boolean,
          read_restricted: input.read_restricted as boolean,
          visible_item_ids: [...visible],
          visible,
          can_review,
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
      if (
        Date.parse(session.expires_at) <= Date.now() ||
        !session.read_context ||
        !session.project_readable
      )
        fail('DENIED', trace);
    };
    try {
      live();
      if (method !== 'GET' || !isMockContextReadPath(path)) fail('MOCK_ROUTE_NOT_FOUND', trace);
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
        ].some((key) => headers.has(key))
      )
        fail('INVALID_INPUT', trace);
      const query = checked('INVALID_INPUT', trace, () => queryFromPath(path));
      const responseBytes = isDetailQuery(query)
        ? CONTEXT_ITEM_READ_RESPONSE_BYTES
        : query.kind === 'history'
          ? CONTEXT_HISTORY_RESPONSE_BYTES
          : CONTEXT_REVISION_RESPONSE_BYTES;
      const maximum = max_response_bytes === undefined ? responseBytes : max_response_bytes;
      if (
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        (response_type !== undefined && !['json', 'bounded-json'].includes(response_type)) ||
        (response_type === 'bounded-json' && max_response_bytes === undefined)
      )
        fail('INVALID_INPUT', trace);
      const item = this.#items.get(query.item_id);
      if (
        !item ||
        !session.visible.has(item.item_id) ||
        (item.current_classification === 'restricted' && !session.read_restricted)
      )
        fail('CONTEXT_ITEM_NOT_FOUND', trace);
      if (
        isDetailQuery(query) &&
        (!item.current_detail || item.current_archived !== (query.kind === 'archived'))
      )
        fail('CONTEXT_ITEM_NOT_FOUND', trace);
      if (this.#active >= 2) fail('RATE_LIMITED', trace);
      return await budget.wait(async () => {
        this.#active++;
        try {
          live();
          if (isDetailQuery(query)) {
            const supplied = item.current_detail!;
            let data = supplied.data;
            if ('confirm_allowed' in data) {
              // Saved observations are never refreshed or promoted to reviewer authority.
              const { confirmation_readiness, ...saved } = data;
              const expiry = confirmation_readiness?.effective_expires_at;
              data = {
                ...saved,
                confirm_allowed:
                  data.confirm_allowed &&
                  session.can_review &&
                  (expiry === null || (expiry !== undefined && Date.parse(expiry) > Date.now())),
                ...(session.can_review && confirmation_readiness !== undefined
                  ? { confirmation_readiness }
                  : {}),
              };
            }
            const response = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
              snapshot({ ...supplied, trace_id: trace, data }, Math.min(maximum, responseBytes)),
            );
            const parsed = checked('CONTEXT_ITEM_INVALID', trace, () =>
              parseContextItemReadEnvelope(response, query, this.#scope, trace),
            );
            live();
            return parsed;
          }
          let data: unknown;
          let source_refs: SourceRef[];
          if (query.kind === 'history') {
            const selected: ContextItemRevisionSummary[] = [];
            for (const revision of item.ordered) {
              live();
              if (
                (query.before_version !== undefined && revision.version >= query.before_version) ||
                (revision.classification === 'restricted' && !session.read_restricted)
              )
                continue;
              selected.push(summarize(revision));
              if (selected.length > query.limit) break;
            }
            const versions = selected.slice(0, query.limit);
            data = {
              item_id: item.item_id,
              current_version: item.current_version,
              current_archived: item.current_archived,
              versions,
              ...(selected.length > query.limit
                ? { next_before_version: versions[versions.length - 1]!.version }
                : {}),
            };
            source_refs = [{ type: 'context-item', id: item.item_id }];
          } else {
            const revision = item.revisions.get(query.version);
            if (!revision || (revision.classification === 'restricted' && !session.read_restricted))
              fail('CONTEXT_ITEM_NOT_FOUND', trace);
            const bytes = new TextEncoder().encode(contextRevisionSnapshotJson(revision));
            live();
            let digest: ArrayBuffer;
            try {
              // Await the real digest directly so an outer timeout cannot release capacity early.
              digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer);
              if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32)
                throw new TypeError();
            } catch {
              live();
              return fail('CONTEXT_HISTORY_INTEGRITY_UNAVAILABLE', trace);
            }
            live();
            const hash = Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join('');
            if (hash !== revision.snapshot_hash) fail('CONTEXT_HISTORY_HASH_MISMATCH', trace);
            data = revision;
            source_refs = [
              { type: 'context-item', id: item.item_id, revision: revision.version },
              ...revision.item.source_refs,
            ];
          }
          live();
          const response = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
            snapshot(
              { schema_version: 1, trace_id: trace, source_refs, data },
              Math.min(maximum, responseBytes),
            ),
          );
          const parsed = checked('CONTEXT_ITEM_INVALID', trace, () =>
            parseContextHistoryReadEnvelope(response, query, this.#scope, trace),
          );
          live();
          return parsed;
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
          : 'CONTEXT_ITEM_INVALID',
        trace,
      );
    } finally {
      budget.close();
    }
  }
}
