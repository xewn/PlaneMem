import {
  assertHandoffCreationCurrent,
  buildEtag,
  checkpointNoteFields,
  checkpointStateHash,
  createUlid,
  isUlid,
  parseCheckpointBinding,
  parseCheckpointHistoryEnvelope,
  parseCheckpointHistoryQuery,
  parseCheckpointReadEnvelope,
  parseCheckpointReceiptEnvelope,
  parseCheckpointReceiptQuery,
  parseCheckpointSaveCommand,
  parseCheckpointSaveEnvelope,
  parseEtag,
  parseHandoffClaimBinding,
  parseHandoffClaimEnvelope,
  parseHandoffClaimReceiptQuery,
  parseHandoffCreateBinding,
  parseHandoffCreateEnvelope,
  parseHandoffCreateReceiptQuery,
  parseHandoffReadEnvelope,
  parseResumeBinding,
  parseResumeCommand,
  parseResumeEnvelope,
  parseResumeReceiptEnvelope,
  parseResumeReceiptQuery,
  validateIdempotencyKey,
  type CheckpointContent,
  type CheckpointMemoryReference,
  type CheckpointSavedRecord,
  type ContextPackReceipt,
  type HandoffClaimRecorded,
  type HandoffCreateRecorded,
  type HandoffReadDetail,
  type SessionMutationScope,
  type SessionMutationSession,
  type SourceRef,
  type Ulid,
} from '@planemem/contracts';
import type { WcpRequest } from './client.js';
import type { MockSessionAccess, MockSessionChange, MockSessionStored } from './mock-sessions.js';
import { envelope, fail, fingerprint, object } from './mock-session-json.js';

export type ContinuityStored =
  | { kind: 'checkpoint'; value: CheckpointSavedRecord; created_at: string }
  | { kind: 'checkpoint-receipt'; fingerprint: string; checkpoint_id: string }
  | { kind: 'handoff'; value: HandoffReadDetail }
  | { kind: 'handoff-create'; fingerprint: string; receipt: HandoffCreateRecorded }
  | { kind: 'handoff-claim'; fingerprint: string; receipt: HandoffClaimRecorded }
  | { kind: 'resume'; fingerprint: string; session_id: string; checkpoint_id: string };

interface Context {
  request: WcpRequest;
  url: URL;
  scope: SessionMutationScope;
  access: MockSessionAccess;
  trace: string;
  session(id: string): SessionMutationSession;
  get(key: string): MockSessionStored | undefined;
  values(): IterableIterator<MockSessionStored>;
  output(value: unknown): unknown;
  write(changes: MockSessionChange[], beforeCommit?: () => void): void;
  check(): void;
  grant(id: string): void;
  readPack(id: string): Promise<ContextPackReceipt>;
}

export function isMockSessionContinuityPath(path: string): boolean {
  return /^\/v1\/(?:sessions\/[^/]+\/(?:checkpoint|checkpoints|handoff|resume)(?:\/.*)?|handoffs\/[^/]+(?:\/.*)?)$/.test(
    path,
  );
}

function authorize(c: Context, capability: keyof MockSessionAccess['permissions']) {
  c.check();
  if (!c.access.permissions[capability]) fail('DENIED', c.trace);
  if (!c.access.project_readable) fail('SESSION_NOT_FOUND', c.trace);
}
function noVersion(c: Context) {
  if (
    c.request.headers['if-match'] !== undefined ||
    c.request.headers['if-match-version'] !== undefined
  )
    throw new TypeError();
}
function writeKey(c: Context): string {
  return validateIdempotencyKey(c.request.headers['idempotency-key']);
}
function key(c: Context, operation: string, requestKey: string, target?: string) {
  const parts = [operation, c.access.identity.actor_id, c.access.identity.client_id, requestKey];
  if (target !== undefined) parts.push(target);
  return JSON.stringify(parts);
}
function checkpoint(c: Context, id: string, parent?: string) {
  const row = c.get('checkpoint:' + id);
  if (row?.kind !== 'checkpoint' || (parent !== undefined && row.value.session_id !== parent))
    fail('CHECKPOINT_NOT_FOUND', c.trace);
  c.session(row.value.session_id);
  return row;
}
function handoff(c: Context, id: string) {
  const row = c.get('handoff:' + id);
  if (row?.kind !== 'handoff') fail('HANDOFF_NOT_FOUND', c.trace);
  checkpoint(c, row.value.checkpoint_id, row.value.session_id);
  return row.value;
}
function freshPack(c: Context, pack: ContextPackReceipt | undefined, expectedHash?: string) {
  c.check();
  if (!pack) return;
  if (Date.parse(pack.pack.expires_at) <= Date.now()) fail('CONTEXT_PACK_EXPIRED', c.trace);
  if (expectedHash !== undefined && pack.pack.pack_hash !== expectedHash)
    fail('CONTEXT_PACK_INVALID', c.trace);
}
function canClaim(c: Context, current: HandoffReadDetail, requireClaimed: boolean): void {
  if (current.status === 'expired') fail('HANDOFF_EXPIRED', c.trace);
  if (current.target_client !== undefined && current.target_client !== c.access.identity.client_id)
    fail('HANDOFF_ACCESS_DENIED', c.trace);
  if (current.status === 'claimed') {
    if (
      current.claimed_by !== c.access.identity.client_id ||
      current.claimed_by_actor !== c.access.identity.actor_id
    )
      fail('HANDOFF_CLAIM_CONFLICT', c.trace);
  } else if (requireClaimed) fail('HANDOFF_CLAIM_REQUIRED', c.trace);
}
function claimed(c: Context, current: HandoffReadDetail): HandoffReadDetail {
  canClaim(c, current, false);
  if (current.status === 'claimed') return current;
  if (!Number.isSafeInteger(current.version + 1)) fail('HANDOFF_VERSION_CONFLICT', c.trace);
  return {
    ...current,
    status: 'claimed',
    claimed_by: c.access.identity.client_id,
    claimed_by_actor: c.access.identity.actor_id,
    version: current.version + 1,
    updated_at: new Date().toISOString(),
    trace_id: c.trace,
  };
}

export async function handleMockSessionContinuity(c: Context): Promise<unknown> {
  const match =
    /^\/v1\/sessions\/([^/]+)\/(checkpoint|checkpoints|handoff|resume)(?:\/(.*))?$/.exec(
      c.url.pathname,
    );
  if (c.request.method === 'GET') {
    if (c.request.body !== undefined) throw new TypeError();
    authorize(c, 'read_sessions');
    return readContinuity(c, match);
  }
  if (c.request.method !== 'POST' || c.url.search) fail('MOCK_ROUTE_NOT_FOUND', c.trace);
  const claim = /^\/v1\/handoffs\/([^/]+)\/claim(?:\/(receipt))?$/.exec(c.url.pathname);
  if (claim) {
    if (!isUlid(claim[1])) throw new TypeError();
    return claimHandoff(c, claim[1], claim[2] === 'receipt');
  }
  if (!match || !isUlid(match[1]) || (match[3] !== undefined && match[3] !== 'receipt'))
    fail('MOCK_ROUTE_NOT_FOUND', c.trace);
  const id = match[1];
  const lookup = match[3] === 'receipt';
  authorize(c, lookup ? 'read_sessions' : 'write_sessions');
  c.session(id);
  if (match[2] === 'checkpoint') return saveCheckpoint(c, id, lookup);
  if (match[2] === 'handoff') return createHandoff(c, id, lookup);
  if (match[2] === 'resume') return resume(c, id, lookup);
  return fail('MOCK_ROUTE_NOT_FOUND', c.trace);
}

async function saveCheckpoint(c: Context, id: Ulid, lookup: boolean) {
  const query = lookup
    ? parseCheckpointReceiptQuery(c.request.body)
    : parseCheckpointReceiptQuery({
        request_key: writeKey(c),
        checkpoint: parseCheckpointSaveCommand(c.request.body),
      });
  const binding = parseCheckpointBinding(id, query, c.access.identity, c.scope);
  if (!lookup) {
    const header = c.request.headers['if-match'];
    if (header !== undefined && parseEtag(header) !== query.checkpoint.expected_version)
      throw new TypeError();
    if (c.request.headers['if-match-version'] !== undefined) throw new TypeError();
  }
  const receiptKey = key(c, 'checkpoint', query.request_key, id);
  const hash = fingerprint({ ...query.checkpoint, session_id: id });
  // The production path authorizes and checks a saved pack even before a write replay.
  const savedPack =
    !lookup && typeof query.checkpoint.context_pack_id === 'string'
      ? await c.readPack(query.checkpoint.context_pack_id)
      : undefined;
  freshPack(c, savedPack);
  const session = c.session(id);
  const previous = c.get(receiptKey);
  if (previous && (previous.kind !== 'checkpoint-receipt' || previous.fingerprint !== hash))
    fail('IDEMPOTENCY_KEY_REUSED', c.trace);
  if (lookup) {
    const record =
      previous?.kind === 'checkpoint-receipt'
        ? checkpoint(c, previous.checkpoint_id, id).value
        : undefined;
    return c.output(
      parseCheckpointReceiptEnvelope(
        envelope(
          record
            ? {
                status: 'recorded',
                session_id: id,
                checkpoint_id: record.checkpoint_id,
                revision: record.revision,
                context_pack_state: 'not-checked',
                ...(record.context_pack_id === undefined
                  ? {}
                  : { context_pack_id: record.context_pack_id }),
              }
            : { status: 'not-observed', session_id: id },
          c.trace,
        ),
        binding,
        c.trace,
      ),
    );
  }
  if (previous?.kind === 'checkpoint-receipt') {
    const record = checkpoint(c, previous.checkpoint_id, id).value;
    freshPack(c, savedPack, record.context_pack_hash);
    return c.output(
      parseCheckpointSaveEnvelope(
        { ...envelope(record, c.trace, record.source_refs), etag: buildEtag(record.revision) },
        binding,
        c.trace,
      ),
    );
  }
  if (session.status !== 'running' && session.status !== 'paused')
    fail('SESSION_STATE_CONFLICT', c.trace);
  if (session.version !== query.checkpoint.expected_version)
    fail('SESSION_VERSION_CONFLICT', c.trace);
  let revision = 1;
  for (const row of c.values())
    if (row.kind === 'checkpoint' && row.value.session_id === id)
      revision = Math.max(revision, row.value.revision + 1);
  if (!Number.isSafeInteger(revision)) fail('SESSION_VERSION_CONFLICT', c.trace);
  const original = query.checkpoint;
  const notes = Object.fromEntries(
    checkpointNoteFields.map((field) => [field, original[field]]),
  ) as CheckpointContent;
  const memory = original.memory_ref as CheckpointMemoryReference | undefined;
  const pack =
    savedPack?.pack ??
    (original.context_pack === undefined ? undefined : object(original.context_pack));
  const packHash = pack?.pack_hash as string | undefined;
  const packId = original.context_pack_id as string | undefined;
  const refs: SourceRef[] = [
    { type: 'session', id },
    ...(packId === undefined ? [] : [{ type: 'context-pack', id: packId }]),
    ...(memory?.source_refs ?? []),
    ...((pack?.source_refs as SourceRef[] | undefined) ?? []),
  ].filter(
    (ref, index, all) =>
      all.findIndex((other) => other.type === ref.type && other.id === ref.id) === index,
  );
  const record = {
    ...c.scope,
    schema_version: 1 as const,
    session_id: id,
    checkpoint_id: createUlid(),
    revision,
    ...notes,
    trace_id: c.trace,
    source_refs: refs,
    state_hash: checkpointStateHash({
      ...notes,
      ...(packHash === undefined ? {} : { context_pack_hash: packHash }),
      ...(packId === undefined ? {} : { context_pack_id: packId }),
      ...(memory === undefined ? {} : { memory_page_ref: memory.page_ref }),
    }),
    ...(packHash === undefined ? {} : { context_pack_hash: packHash }),
    ...(packId === undefined ? {} : { context_pack_id: packId }),
    ...(memory === undefined ? {} : { memory_ref: memory }),
  };
  const parsed = parseCheckpointSaveEnvelope(
    { ...envelope(record, c.trace, refs), etag: buildEtag(revision) },
    binding,
    c.trace,
  );
  const result = c.output(parsed);
  freshPack(c, savedPack);
  c.write(
    [
      {
        key: 'checkpoint:' + record.checkpoint_id,
        value: { kind: 'checkpoint', value: parsed.data, created_at: new Date().toISOString() },
      },
      {
        key: receiptKey,
        value: {
          kind: 'checkpoint-receipt',
          checkpoint_id: record.checkpoint_id,
          fingerprint: hash,
        },
      },
    ],
    () => freshPack(c, savedPack),
  );
  return result;
}

function createHandoff(c: Context, id: Ulid, lookup: boolean) {
  noVersion(c);
  const query = lookup
    ? parseHandoffCreateReceiptQuery(c.request.body)
    : parseHandoffCreateReceiptQuery({ request_key: writeKey(c), handoff: c.request.body });
  const binding = parseHandoffCreateBinding(id, query, c.access.identity, c.scope);
  checkpoint(c, query.handoff.checkpoint_id, id);
  const receiptKey = key(c, 'handoff-create', query.request_key);
  const hash = fingerprint({ ...query.handoff, session_id: id });
  const previous = c.get(receiptKey);
  if (previous && (previous.kind !== 'handoff-create' || previous.fingerprint !== hash))
    fail('IDEMPOTENCY_KEY_REUSED', c.trace);
  if (previous?.kind === 'handoff-create') {
    const current = handoff(c, previous.receipt.handoff_id);
    assertHandoffCreationCurrent(current, previous.receipt, c.scope);
    return c.output(
      parseHandoffCreateEnvelope(
        lookup
          ? envelope(previous.receipt, c.trace)
          : {
              ...envelope(
                { ...current, create_receipt: previous.receipt },
                c.trace,
                current.source_refs,
              ),
              etag: buildEtag(current.version),
            },
        binding,
        c.trace,
        lookup,
      ),
    );
  }
  if (lookup)
    return c.output(
      parseHandoffCreateEnvelope(
        envelope(
          { status: 'not-observed', session_id: id, checkpoint_id: query.handoff.checkpoint_id },
          c.trace,
        ),
        binding,
        c.trace,
        true,
      ),
    );
  const now = new Date().toISOString();
  const current: HandoffReadDetail = {
    ...c.scope,
    schema_version: 1,
    session_id: id,
    handoff_id: createUlid(),
    checkpoint_id: query.handoff.checkpoint_id,
    from_client: c.access.identity.client_id,
    ...(query.handoff.target_client === undefined
      ? {}
      : { target_client: query.handoff.target_client }),
    status: 'open',
    version: 1,
    created_at: now,
    updated_at: now,
    trace_id: c.trace,
    source_refs: [{ type: 'checkpoint', id: query.handoff.checkpoint_id }],
  };
  const receipt: HandoffCreateRecorded = {
    status: 'recorded',
    handoff_id: current.handoff_id,
    session_id: id,
    checkpoint_id: current.checkpoint_id,
    from_client: current.from_client,
    created_by_actor: c.access.identity.actor_id,
    handoff_version: 1,
    ...(current.target_client === undefined ? {} : { target_client: current.target_client }),
  };
  const result = c.output(
    parseHandoffCreateEnvelope(
      {
        ...envelope({ ...current, create_receipt: receipt }, c.trace, current.source_refs),
        etag: buildEtag(1),
      },
      binding,
      c.trace,
      false,
    ),
  );
  c.write([
    { key: 'handoff:' + current.handoff_id, value: { kind: 'handoff', value: current } },
    { key: receiptKey, value: { kind: 'handoff-create', fingerprint: hash, receipt } },
  ]);
  return result;
}

function claimHandoff(c: Context, id: Ulid, lookup: boolean) {
  authorize(c, lookup ? 'read_sessions' : 'claim_handoffs');
  const body = object(c.request.body);
  const version = lookup ? undefined : parseEtag(c.request.headers['if-match']);
  if (
    !lookup &&
    (c.request.headers['if-match-version'] !== undefined ||
      (body.expected_version !== undefined && body.expected_version !== version))
  )
    throw new TypeError();
  const query = parseHandoffClaimReceiptQuery(
    lookup ? body : { request_key: writeKey(c), claim: { ...body, expected_version: version } },
  );
  const binding = parseHandoffClaimBinding(id, query, c.access.identity, c.scope);
  const current = handoff(c, id);
  const receiptKey = key(c, 'handoff-claim', query.request_key, id);
  const hash = fingerprint({ ...query.claim, handoff_id: id });
  const previous = c.get(receiptKey);
  if (previous && (previous.kind !== 'handoff-claim' || previous.fingerprint !== hash))
    fail('IDEMPOTENCY_KEY_REUSED', c.trace);
  if (previous?.kind === 'handoff-claim') {
    const full = parseHandoffClaimEnvelope(
      {
        ...envelope({ ...current, claim_receipt: previous.receipt }, c.trace, current.source_refs),
        etag: buildEtag(current.version),
      },
      binding,
      c.trace,
      false,
    );
    return c.output(
      lookup
        ? parseHandoffClaimEnvelope(envelope(previous.receipt, c.trace), binding, c.trace, true)
        : full,
    );
  }
  if (lookup)
    return c.output(
      parseHandoffClaimEnvelope(
        envelope({ status: 'not-observed', handoff_id: id }, c.trace),
        binding,
        c.trace,
        true,
      ),
    );
  if (current.version !== query.claim.expected_version) fail('HANDOFF_VERSION_CONFLICT', c.trace);
  const next = claimed(c, current);
  const receipt: HandoffClaimRecorded = {
    status: 'recorded',
    handoff_id: id,
    session_id: current.session_id,
    checkpoint_id: current.checkpoint_id,
    expected_version: query.claim.expected_version,
    handoff_version: next.version,
    claimed_by: c.access.identity.client_id,
    claimed_by_actor: c.access.identity.actor_id,
    changed: current.version !== next.version,
  };
  const result = c.output(
    parseHandoffClaimEnvelope(
      {
        ...envelope({ ...next, claim_receipt: receipt }, c.trace, next.source_refs),
        etag: buildEtag(next.version),
      },
      binding,
      c.trace,
      false,
    ),
  );
  c.write([
    { key: 'handoff:' + id, value: { kind: 'handoff', value: next } },
    { key: receiptKey, value: { kind: 'handoff-claim', fingerprint: hash, receipt } },
  ]);
  return result;
}

async function resume(c: Context, id: Ulid, lookup: boolean) {
  noVersion(c);
  const query = lookup
    ? parseResumeReceiptQuery(c.request.body)
    : parseResumeReceiptQuery({ ...parseResumeCommand(c.request.body), request_key: writeKey(c) });
  const binding = parseResumeBinding(id, query, c.access.identity, c.scope);
  // Ordinary start and resume share the same original-key namespace.
  const receiptKey = key(c, 'start', query.request_key);
  const hash = fingerprint({
    parent_session_id: id,
    handoff_id: query.handoff_id,
    require_claimed: query.require_claimed,
  });
  const lookupOriginal = () => {
    const previous = c.get(receiptKey);
    if (previous?.kind === 'start') {
      if (previous.receipt.parent_session_id !== id) fail('IDEMPOTENCY_KEY_REUSED', c.trace);
      return previous;
    }
    if (previous && (previous.kind !== 'resume' || previous.fingerprint !== hash))
      fail('IDEMPOTENCY_KEY_REUSED', c.trace);
    return previous;
  };
  if (lookup) {
    const previous = lookupOriginal();
    const base = { parent_session_id: id, handoff_id: query.handoff_id };
    const data =
      previous?.kind === 'resume'
        ? {
            ...base,
            status: 'recorded',
            session_id: previous.session_id,
            checkpoint_id: previous.checkpoint_id,
            require_claimed: query.require_claimed,
            context_pack_state: 'not-checked',
          }
        : { ...base, status: previous?.kind === 'start' ? 'legacy-unverified' : 'not-observed' };
    return c.output(parseResumeReceiptEnvelope(envelope(data, c.trace), binding, c.trace));
  }
  let current = handoff(c, query.handoff_id);
  if (current.session_id !== id) fail('SESSION_SCOPE_MISMATCH', c.trace);
  canClaim(c, current, query.require_claimed);
  const record = checkpoint(c, current.checkpoint_id, id).value;
  const pack =
    record.context_pack_id === undefined ? undefined : await c.readPack(record.context_pack_id);
  freshPack(c, pack, record.context_pack_hash);
  // Another connection may have progressed while a saved pack was being read.
  c.session(id);
  current = handoff(c, query.handoff_id);
  if (current.session_id !== id || current.checkpoint_id !== record.checkpoint_id)
    fail('SESSION_SCOPE_MISMATCH', c.trace);
  canClaim(c, current, query.require_claimed);
  const previous = lookupOriginal();
  if (previous?.kind === 'start') fail('SESSION_RESUME_LEGACY_UNVERIFIED', c.trace);
  const next = claimed(c, current);
  const child: SessionMutationSession =
    previous?.kind === 'resume'
      ? c.session(previous.session_id)
      : {
          ...c.scope,
          schema_version: 1,
          session_id: createUlid(),
          parent_session_id: id,
          actor_id: c.access.identity.actor_id,
          client_id: c.access.identity.client_id,
          resume_origin: {
            handoff_id: query.handoff_id,
            checkpoint_id: record.checkpoint_id,
            require_claimed: query.require_claimed,
          },
          status: 'running',
          version: 1,
          started_at: new Date().toISOString(),
          trace_id: c.trace,
          source_refs: [{ type: 'session', id: c.access.identity.client_id }],
        };
  const result = c.output(
    parseResumeEnvelope(
      envelope(
        {
          session: child,
          checkpoint: record,
          handoff: next,
          context_pack_state: pack
            ? 'checked'
            : record.context_pack_hash
              ? 'legacy-unverified'
              : 'none',
          ...(pack === undefined ? {} : { context_pack: pack }),
        },
        c.trace,
        [...child.source_refs, ...record.source_refs, ...next.source_refs],
      ),
      binding,
      c.trace,
    ),
  );
  freshPack(c, pack, record.context_pack_hash);
  if (!previous) {
    c.write(
      [
        { key: 'handoff:' + next.handoff_id, value: { kind: 'handoff', value: next } },
        { key: 'session:' + child.session_id, value: { kind: 'session', value: child } },
        {
          key: receiptKey,
          value: {
            kind: 'resume',
            fingerprint: hash,
            session_id: child.session_id,
            checkpoint_id: record.checkpoint_id,
          },
        },
      ],
      () => freshPack(c, pack, record.context_pack_hash),
    );
    c.grant(child.session_id);
  }
  return result;
}

function readContinuity(c: Context, match: RegExpExecArray | null) {
  const handoffMatch = /^\/v1\/handoffs\/([^/]+)$/.exec(c.url.pathname);
  if (handoffMatch) {
    if (!isUlid(handoffMatch[1]) || c.url.search) throw new TypeError();
    const current = handoff(c, handoffMatch[1]);
    return c.output(
      parseHandoffReadEnvelope(
        {
          ...envelope(current, c.trace, [{ type: 'handoff', id: current.handoff_id }]),
          session_identity: c.access.identity,
          handoff_permissions: {
            claim: c.access.permissions.claim_handoffs,
            write_sessions: c.access.permissions.write_sessions,
          },
        },
        current.handoff_id,
        c.scope,
        c.trace,
      ),
    );
  }
  if (!match || !isUlid(match[1]) || match[2] !== 'checkpoints')
    fail('MOCK_ROUTE_NOT_FOUND', c.trace);
  const id = match[1];
  c.session(id);
  if (match[3] !== undefined) {
    if (!isUlid(match[3]) || c.url.search) throw new TypeError();
    const selected = checkpoint(c, match[3], id);
    return c.output(
      parseCheckpointReadEnvelope(
        envelope(
          {
            checkpoint: selected.value,
            created_at: selected.created_at,
            context_pack_state: 'not-checked',
          },
          c.trace,
          [{ type: 'checkpoint', id: selected.value.checkpoint_id }],
        ),
        { session_id: id, checkpoint_id: selected.value.checkpoint_id },
        c.scope,
        c.trace,
      ),
    );
  }
  const input: Record<string, unknown> = { session_id: id };
  for (const [name, value] of c.url.searchParams) {
    if (name !== 'before_revision' || Object.hasOwn(input, name) || !/^[1-9][0-9]*$/.test(value))
      throw new TypeError();
    input[name] = Number(value);
  }
  const query = parseCheckpointHistoryQuery(input);
  const candidates: Extract<ContinuityStored, { kind: 'checkpoint' }>[] = [];
  for (const row of c.values())
    if (
      row.kind === 'checkpoint' &&
      row.value.session_id === id &&
      (query.before_revision === undefined || row.value.revision < query.before_revision)
    )
      candidates.push(row);
  candidates.sort((a, b) => b.value.revision - a.value.revision);
  const page = candidates.slice(0, 10);
  return c.output(
    parseCheckpointHistoryEnvelope(
      {
        ...envelope(
          page.map((row) => ({ ...row.value, created_at: row.created_at })),
          c.trace,
          [{ type: 'postgres', id: 'wcp_session_checkpoints' }],
        ),
        ...c.scope,
        session_id: id,
        ...(candidates.length > page.length
          ? { next_before_revision: page.at(-1)!.value.revision }
          : {}),
      },
      query,
      c.scope,
      c.trace,
    ),
  );
}
