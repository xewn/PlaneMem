import {
  ContractError,
  buildEtag,
  createUlid,
  isUlid,
  parseCreateProposal,
  parseEtag,
  parseProposalListQuery,
  parseSyncCommandIdentity,
  proposalText,
  proposalWarnings,
  syncJsonSnapshot,
  validateIdempotencyKey,
  type Classification,
  type ContextScope,
  type ProposalDocument,
  type ProposalMutationReceipt,
  type ProposalSummary,
  type SourceRef,
  type SyncCommandIdentity,
  type SyncUploadScope,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';

const classes: Classification[] = ['public', 'internal', 'confidential', 'restricted'];
const configurationTrace = 'trace_mock_proposal_configuration';
const MAX_BYTES = 16 * 1024 * 1024;
const RESPONSE_BYTES = 4 * 1024 * 1024;

/** Explicit fixture state. dependency_version changes when simulated transitive content changes. */
export interface MockProposalSource {
  id: string;
  revision: number;
  classification: Classification;
  available: boolean;
  current: boolean;
  expires_at: string | null;
  dependency_version: string;
}
export interface MockProposalSeed {
  scope: SyncUploadScope;
  context_sources: MockProposalSource[];
}
/** These simulated permissions come from configuration, never from request headers. */
export interface MockProposalSession {
  identity: SyncCommandIdentity;
  expires_at: string;
  actor_type: 'human' | 'service';
  project_readable: boolean;
  read_proposals: boolean;
  create_proposals: boolean;
  review_proposals: boolean;
  read_restricted: boolean;
  visible_context_item_ids: string[];
}
type Session = Omit<MockProposalSession, 'visible_context_item_ids'> & { visible: Set<string> };
type Stored = { document: ProposalDocument; sources: Map<string, string>; bytes: number };
type Receipt = { fingerprint: string; data: ProposalMutationReceipt; cursor: number };

function fail(code: string, trace: string): never {
  throw new ContractError(code, 'Simulated proposal request failed: ' + code, {
    trace_id: trace,
    retryable: false,
  });
}
function checked<T>(code: string, trace: string, read: () => T): T {
  try {
    return read();
  } catch {
    return fail(code, trace);
  }
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
function instant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function source(value: unknown): MockProposalSource {
  const row = record(value, [
    'id',
    'revision',
    'classification',
    'available',
    'current',
    'expires_at',
    'dependency_version',
  ]);
  if (
    !isUlid(row.id) ||
    typeof row.revision !== 'number' ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !classes.includes(row.classification as Classification) ||
    typeof row.available !== 'boolean' ||
    typeof row.current !== 'boolean' ||
    (row.expires_at !== null && !instant(row.expires_at)) ||
    typeof row.dependency_version !== 'string' ||
    !/^[\x21-\x7e]{1,255}$/.test(row.dependency_version)
  )
    throw new TypeError();
  return {
    id: row.id,
    revision: row.revision,
    classification: row.classification as Classification,
    available: row.available,
    current: row.current,
    expires_at: row.expires_at,
    dependency_version: row.dependency_version,
  };
}
function summary(doc: ProposalDocument): ProposalSummary {
  return {
    proposal_id: doc.proposal_id,
    kind: doc.kind,
    title: doc.title,
    status: doc.status,
    revision: doc.revision,
    classification: doc.classification,
    created_at: doc.created_at,
    expires_at: doc.expires_at,
  };
}
function canonical(value: unknown): string {
  // Match normalized command equality regardless of JSON object-key order; arrays retain order.
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const row = entry as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(row)
          .sort()
          .map((key) => [key, row[key]]),
      );
    }
    return entry;
  });
}
export function isMockProposalPath(path: string) {
  const name = typeof path === 'string' ? path.split('?')[0] : '';
  return name === '/v1/proposals' || name?.startsWith('/v1/proposals/') === true;
}

/** Bounded, ephemeral development state; no database, model invocation or sync publication. */
export class MockProposalStore {
  readonly #scope: ContextScope;
  readonly #sources = new Map<string, MockProposalSource>();
  readonly #proposals = new Map<string, Stored>();
  readonly #receipts = new Map<string, Receipt>();
  #cursor = 0;
  #bytes = 0;

  constructor(seed: MockProposalSeed) {
    this.#scope = checked('MOCK_PROPOSAL_CONFIGURATION_INVALID', configurationTrace, () => {
      const input = record(JSON.parse(syncJsonSnapshot(seed, MAX_BYTES)), [
        'scope',
        'context_sources',
      ]);
      const rawScope = record(input.scope, ['tenant_id', 'workspace_id', 'project_id']);
      const identity = parseSyncCommandIdentity({
        ...rawScope,
        actor_id: 'mock',
        client_id: 'mock',
      });
      if (
        !isUlid(identity.tenant_id) ||
        !isUlid(identity.workspace_id) ||
        !isUlid(identity.project_id)
      )
        throw new TypeError();
      if (!Array.isArray(input.context_sources) || input.context_sources.length > 1000)
        throw new TypeError();
      for (const raw of input.context_sources) {
        const saved = source(raw);
        if (this.#sources.has(saved.id)) throw new TypeError();
        this.#sources.set(saved.id, saved);
      }
      return {
        tenant_id: identity.tenant_id,
        workspace_id: identity.workspace_id,
        project_id: identity.project_id,
      };
    });
  }

  /** Change a known fixture source to model revision, dependency, expiry or availability changes. */
  setContextSource(value: MockProposalSource): void {
    const saved = checked('MOCK_PROPOSAL_CONFIGURATION_INVALID', configurationTrace, () => {
      const parsed = source(JSON.parse(syncJsonSnapshot(value, 8192)));
      if (!this.#sources.has(parsed.id)) throw new TypeError();
      return parsed;
    });
    this.#sources.set(saved.id, saved);
  }

  connect(session: MockProposalSession): WcpTransport {
    const saved = checked(
      'MOCK_PROPOSAL_CONFIGURATION_INVALID',
      configurationTrace,
      (): Session => {
        const input = record(JSON.parse(syncJsonSnapshot(session, 128 * 1024)), [
          'identity',
          'expires_at',
          'actor_type',
          'project_readable',
          'read_proposals',
          'create_proposals',
          'review_proposals',
          'read_restricted',
          'visible_context_item_ids',
        ]);
        const identity = parseSyncCommandIdentity(input.identity);
        for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (identity[field] !== this.#scope[field]) throw new TypeError();
        if (
          !instant(input.expires_at) ||
          (input.actor_type !== 'human' && input.actor_type !== 'service') ||
          !Array.isArray(input.visible_context_item_ids) ||
          input.visible_context_item_ids.length > 1000
        )
          throw new TypeError();
        for (const field of [
          'project_readable',
          'read_proposals',
          'create_proposals',
          'review_proposals',
          'read_restricted',
        ])
          if (typeof input[field] !== 'boolean') throw new TypeError();
        const visible = new Set<string>();
        for (const id of input.visible_context_item_ids) {
          if (typeof id !== 'string' || !this.#sources.has(id) || visible.has(id))
            throw new TypeError();
          visible.add(id);
        }
        return {
          identity,
          expires_at: input.expires_at,
          actor_type: input.actor_type as 'human' | 'service',
          project_readable: input.project_readable as boolean,
          read_proposals: input.read_proposals as boolean,
          create_proposals: input.create_proposals as boolean,
          review_proposals: input.review_proposals as boolean,
          read_restricted: input.read_restricted as boolean,
          visible,
        };
      },
    );
    return {
      request: async <T = unknown>(request: WcpRequest): Promise<T> =>
        this.respond(request, saved) as T,
    };
  }

  private sourceVisible(
    value: MockProposalSource | undefined,
    session: Session,
  ): value is MockProposalSource {
    return (
      !!value &&
      value.available &&
      session.visible.has(value.id) &&
      (value.classification !== 'restricted' || session.read_restricted)
    );
  }
  private sourceCurrent(value: MockProposalSource, now: number) {
    return value.current && (value.expires_at === null || Date.parse(value.expires_at) > now);
  }
  private visible(stored: Stored, session: Session): boolean {
    let next: Stored | undefined = stored;
    const seen = new Set<string>();
    while (next) {
      const doc: ProposalDocument = next.document;
      if (
        seen.size > 32 ||
        seen.has(doc.proposal_id) ||
        (doc.classification === 'restricted' && !session.read_restricted) ||
        [...next.sources.keys()].some((id) => !this.sourceVisible(this.#sources.get(id), session))
      )
        return false;
      seen.add(doc.proposal_id);
      const parent = doc.provenance.derived_from;
      if (!parent) return true;
      next = this.#proposals.get(parent.proposal_id);
    }
    return false;
  }
  private read(id: string, session: Session, trace: string): Stored {
    const saved = this.#proposals.get(id);
    if (!saved || !this.visible(saved, session)) return fail('PROPOSAL_NOT_FOUND', trace);
    return saved;
  }
  private sourcesCurrent(saved: Stored, session: Session, now: number) {
    return [...saved.sources].every(([id, original]) => {
      const current = this.#sources.get(id);
      return (
        this.sourceVisible(current, session) &&
        this.sourceCurrent(current, now) &&
        JSON.stringify(current) === original
      );
    });
  }

  private respond(request: WcpRequest, session: Session): unknown {
    let trace = 'trace_unknown';
    const headers = checked('INVALID_INPUT', trace, () => {
      const input = JSON.parse(syncJsonSnapshot(request.headers, 16 * 1024)) as Record<
        string,
        unknown
      >;
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
      const normalized = new Map<string, string>();
      for (const [key, value] of Object.entries(input)) {
        if (typeof value !== 'string' || normalized.has(key.toLowerCase())) throw new TypeError();
        normalized.set(key.toLowerCase(), value);
      }
      return normalized;
    });
    const supplied = headers.get('x-trace-id') ?? headers.get('traceparent');
    if (
      !supplied ||
      supplied.length > 1024 ||
      !supplied.trim() ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(supplied)
    )
      return fail('INVALID_INPUT', trace);
    trace = supplied;
    const live = () => {
      if (request.signal?.aborted) fail('GATEWAY_REQUEST_CANCELED', trace);
      if (Date.parse(session.expires_at) <= Date.now()) fail('DENIED', trace);
    };
    live();
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
      typeof request.path !== 'string' ||
      request.path.length > 8192 ||
      request.path.includes('#')
    )
      fail('INVALID_INPUT', trace);
    const [path] = request.path.split('?');
    const query = new URLSearchParams(
      request.path.includes('?') ? request.path.slice(request.path.indexOf('?') + 1) : '',
    );
    const identity = path === '/v1/proposals/submission-context';
    const collection = path === '/v1/proposals';
    const match = /^\/v1\/proposals\/([0-9A-HJKMNP-TV-Z]{26})(?:\/(confirm|reject))?$/.exec(path!);
    if (
      (!identity && !collection && !match) ||
      (identity && request.method !== 'GET') ||
      (match && request.method !== (match[2] ? 'POST' : 'GET'))
    )
      fail('MOCK_ROUTE_NOT_FOUND', trace);
    const write = request.method === 'POST';
    if (request.method !== 'GET' && !write) fail('MOCK_ROUTE_NOT_FOUND', trace);
    if ((!collection || write) && query.size) fail('INVALID_INPUT', trace);
    if (
      !write &&
      (request.body !== undefined ||
        ['idempotency-key', 'if-match', 'x-expected-version'].some((name) => headers.has(name)))
    )
      fail('INVALID_INPUT', trace);
    const maximum = request.max_response_bytes ?? RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      (request.response_type !== undefined &&
        !['json', 'bounded-json'].includes(request.response_type)) ||
      (request.response_type === 'bounded-json' && request.max_response_bytes === undefined)
    )
      fail('INVALID_INPUT', trace);
    const finish = (value: unknown) => {
      const detached: unknown = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
        JSON.parse(syncJsonSnapshot(value, Math.min(maximum, RESPONSE_BYTES))),
      );
      live();
      return detached;
    };
    const envelope = (data: unknown, source_refs: SourceRef[]) => ({
      schema_version: 1,
      trace_id: trace,
      data,
      source_refs,
    });
    if (identity) return finish(envelope({ identity_preconditions: 1, ...session.identity }, []));
    const review = session.actor_type === 'human' && session.review_proposals;
    if (
      (!write && !session.read_proposals) ||
      (write && !(collection ? session.create_proposals : review))
    )
      fail('DENIED', trace);
    if (!session.project_readable) fail('PROPOSAL_NOT_FOUND', trace);
    const now = Date.now();
    if (!write && collection) {
      const filters = checked('INVALID_INPUT', trace, () => {
        const input: Record<string, unknown> = {};
        for (const [name, value] of query) {
          if (
            !['status', 'kind', 'before', 'limit', 'derived_from'].includes(name) ||
            Object.hasOwn(input, name)
          )
            throw new TypeError();
          if (name === 'limit' && !/^[1-9][0-9]{0,2}$/.test(value)) throw new TypeError();
          input[name] = name === 'limit' ? Number(value) : value;
        }
        return parseProposalListQuery(input);
      });
      const limit = filters.limit ?? 25;
      const rows = [...this.#proposals.values()]
        .filter((entry) => {
          const doc = entry.document;
          return (
            this.visible(entry, session) &&
            (!filters.status || doc.status === filters.status) &&
            (!filters.kind || doc.kind === filters.kind) &&
            (!filters.before || doc.proposal_id < filters.before) &&
            (!filters.derived_from ||
              doc.provenance.derived_from?.proposal_id === filters.derived_from)
          );
        })
        .sort((a, b) => (a.document.proposal_id < b.document.proposal_id ? 1 : -1));
      const selected = rows.slice(0, limit).map((entry) => summary(entry.document));
      return finish(
        envelope(
          {
            proposals: selected,
            review_allowed: review,
            create_allowed: session.create_proposals,
            restricted_read: session.read_restricted,
            ...(rows.length > limit
              ? { next_before: selected[selected.length - 1]!.proposal_id }
              : {}),
          },
          [{ type: 'proposal-list', id: this.#scope.project_id }],
        ),
      );
    }
    const id = match?.[1];
    if (id !== undefined && !isUlid(id)) fail('INVALID_INPUT', trace);
    if (!write) {
      const saved = this.read(id!, session, trace);
      const doc = saved.document;
      return finish({
        ...envelope(
          {
            proposal: doc,
            sources_current: this.sourcesCurrent(saved, session, now),
            review_allowed: review,
          },
          [{ type: 'proposal', id: doc.proposal_id, revision: doc.revision }, ...doc.source_refs],
        ),
        revision: doc.revision,
        etag: buildEtag(doc.revision),
      });
    }
    const operation = collection ? 'create' : match![2]!;
    const parsed = checked('INVALID_INPUT', trace, () => {
      const body = JSON.parse(syncJsonSnapshot(request.body, 1024 * 1024));
      const key = validateIdempotencyKey(headers.get('idempotency-key') ?? body?.idempotency_key);
      if (
        headers.has('idempotency-key') &&
        body?.idempotency_key !== undefined &&
        body.idempotency_key !== key
      )
        throw new TypeError();
      const raw = record(body, [], Object.keys(body));
      delete raw.idempotency_key;
      if (collection) {
        if (headers.has('if-match') || headers.has('x-expected-version')) throw new TypeError();
        return { key, draft: parseCreateProposal(raw), expected: null, reason: null };
      }
      record(raw, ['reason'], ['expected_revision']);
      const etag = headers.has('if-match') ? parseEtag(headers.get('if-match')) : undefined;
      const versionText = headers.get('x-expected-version');
      if (versionText !== undefined && !/^[1-9][0-9]*$/.test(versionText)) throw new TypeError();
      const version = versionText === undefined ? undefined : Number(versionText);
      const expected = etag ?? version ?? raw.expected_revision;
      if (
        typeof expected !== 'number' ||
        !Number.isSafeInteger(expected) ||
        expected < 1 ||
        [etag, version, raw.expected_revision].some(
          (value) => value !== undefined && value !== expected,
        )
      )
        throw new TypeError();
      return { key, draft: null, expected, reason: proposalText(raw.reason, 'reason', 2000) };
    });
    const key = JSON.stringify([session.identity.actor_id, session.identity.client_id, parsed.key]);
    const fingerprint = canonical([
      operation,
      id ?? null,
      parsed.expected,
      parsed.reason,
      parsed.draft,
    ]);
    const result = (receipt: Receipt, replayed: boolean) => ({
      ...envelope({ ...receipt.data, replayed }, [
        { type: 'proposal', id: receipt.data.proposal_id, revision: receipt.data.revision },
      ]),
      revision: receipt.data.revision,
      etag: buildEtag(receipt.data.revision),
      server_cursor: receipt.cursor,
    });
    const previous = this.#receipts.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED', trace);
      this.read(previous.data.proposal_id, session, trace);
      return finish(result(previous, true));
    }
    let saved: Stored;
    let replacedBytes = 0;
    if (parsed.draft) {
      if (this.#proposals.size >= 1000) fail('RATE_LIMITED', trace);
      const draft = parsed.draft;
      let classification = draft.classification;
      if (draft.derived_from) {
        const parent = this.read(draft.derived_from.proposal_id, session, trace);
        if (parent.document.revision !== draft.derived_from.revision)
          fail('PROPOSAL_VERSION_CONFLICT', trace);
        let ancestor: Stored = parent;
        let depth = 1;
        while (ancestor.document.provenance.derived_from) {
          if (++depth > 32) fail('INVALID_INPUT', trace);
          ancestor = this.read(
            ancestor.document.provenance.derived_from.proposal_id,
            session,
            trace,
          );
        }
        classification =
          classes[
            Math.max(
              classes.indexOf(classification),
              classes.indexOf(parent.document.classification),
            )
          ]!;
      }
      const pinned = new Map<string, number>();
      const manifest = new Map<string, string>();
      for (const ref of draft.source_refs.filter((entry) => entry.type === 'context-item')) {
        if (pinned.has(ref.id) && pinned.get(ref.id) !== ref.revision) fail('INVALID_INPUT', trace);
        pinned.set(ref.id, ref.revision!);
        const current = this.#sources.get(ref.id);
        if (!this.sourceVisible(current, session)) fail('PROPOSAL_SOURCE_UNAVAILABLE', trace);
        if (current.revision !== ref.revision || !this.sourceCurrent(current, now))
          fail('PROPOSAL_SOURCE_STALE', trace);
        manifest.set(ref.id, JSON.stringify(current));
        classification =
          classes[
            Math.max(classes.indexOf(classification), classes.indexOf(current.classification))
          ]!;
      }
      if (classification === 'restricted' && !session.read_restricted) fail('DENIED', trace);
      const document: ProposalDocument = {
        schema_version: 1,
        ...this.#scope,
        proposal_id: createUlid(),
        kind: draft.kind,
        title: draft.title,
        content: draft.content,
        status: 'proposed',
        revision: 1,
        classification,
        source_refs: draft.source_refs,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + draft.ttl_seconds * 1000).toISOString(),
        provenance: {
          model_version: draft.model_version,
          prompt_version: draft.prompt_version,
          warnings: proposalWarnings(draft.content),
          ...(draft.derived_from ? { derived_from: draft.derived_from } : {}),
        },
        created_by: session.identity.actor_id,
        created_by_client: session.identity.client_id,
        reviewed_by: null,
        reviewed_by_client: null,
        reviewed_at: null,
        review_reason: null,
        trace_id: trace,
      };
      saved = { document, sources: manifest, bytes: 0 };
    } else {
      const current = this.read(id!, session, trace);
      const doc = current.document;
      if (doc.revision !== parsed.expected) fail('PROPOSAL_VERSION_CONFLICT', trace);
      if (doc.status !== 'proposed') fail('PROPOSAL_ALREADY_REVIEWED', trace);
      if (operation === 'confirm') {
        if (Date.parse(doc.expires_at) <= now) fail('PROPOSAL_EXPIRED', trace);
        if (!this.sourcesCurrent(current, session, now)) fail('PROPOSAL_SOURCE_STALE', trace);
      }
      replacedBytes = current.bytes;
      saved = {
        sources: current.sources,
        bytes: 0,
        document: {
          ...doc,
          status: operation === 'confirm' ? 'verified' : 'rejected',
          revision: 2,
          reviewed_by: session.identity.actor_id,
          reviewed_by_client: session.identity.client_id,
          reviewed_at: new Date(now).toISOString(),
          review_reason: parsed.reason,
          trace_id: trace,
        },
      };
    }
    const receipt: Receipt = {
      fingerprint,
      cursor: this.#cursor + 1,
      data: {
        proposal_id: saved.document.proposal_id,
        status: saved.document.status,
        revision: saved.document.revision,
        event_id: createUlid(),
        occurred_at: new Date(now).toISOString(),
        replayed: false,
      },
    };
    if (collection && this.#proposals.has(saved.document.proposal_id))
      fail('MOCK_PROPOSAL_ID_COLLISION', trace);
    if ([...this.#receipts.values()].some((entry) => entry.data.event_id === receipt.data.event_id))
      fail('MOCK_PROPOSAL_ID_COLLISION', trace);
    saved.bytes = new TextEncoder().encode(
      syncJsonSnapshot([saved.document, [...saved.sources]], RESPONSE_BYTES),
    ).byteLength;
    const receiptBytes = new TextEncoder().encode(
      syncJsonSnapshot([key, receipt], RESPONSE_BYTES),
    ).byteLength;
    const total = this.#bytes - replacedBytes + saved.bytes + receiptBytes;
    if (this.#receipts.size >= 2000 || total > MAX_BYTES) fail('RATE_LIMITED', trace);
    // Prepare the entire response first; this synchronous Mock never mutates on local response failure.
    const response = finish(result(receipt, false));
    if (operation === 'confirm') {
      if (Date.parse(saved.document.expires_at) <= Date.now()) fail('PROPOSAL_EXPIRED', trace);
      if (!this.sourcesCurrent(saved, session, Date.now())) fail('PROPOSAL_SOURCE_STALE', trace);
    }
    this.#proposals.set(saved.document.proposal_id, saved);
    this.#receipts.set(key, receipt);
    this.#bytes = total;
    this.#cursor = receipt.cursor;
    return response;
  }
}
