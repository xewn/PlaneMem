import {
  ContractError,
  isUlid,
  assertSyncCommandIdentity,
  assertSyncIdentityScope,
  parseSyncAcknowledgement,
  parseSyncAcknowledgementEnvelope,
  parseSyncChangesEnvelope,
  parseSyncChangesQuery,
  parseSyncCommandContextEnvelope,
  parseSyncCommandIdentity,
  parseSyncCursorEnvelope,
  parseSyncCursorNumber,
  syncJsonSnapshot,
  SYNC_CHANGES_QUERY_BYTES,
  SYNC_CHANGES_RESPONSE_BYTES,
  SYNC_COMMAND_CONTEXT_BYTES,
  SYNC_CURSOR_REQUEST_BYTES,
  SYNC_CURSOR_RESPONSE_BYTES,
  SYNC_UPLOAD_RESPONSE_BYTES,
  SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
  type SyncChange,
  type SyncChangesQuery,
  type SyncCommandIdentity,
  type SyncUploadScope,
} from '@planemem/contracts';
import { validateEvent } from '@planemem/events';
import type { WcpRequest, WcpTransport } from './client.js';
import {
  MockSyncUploadLedger,
  type MockSyncFieldSource,
  type MockSyncUploadAccess,
} from './mock-sync-upload.js';

const MAX_CHANGES = 10_000;
const MAX_CONSUMERS = 1_000;
const SEED_BYTES = 16 * 1024 * 1024;
const SESSION_BYTES = 4 * 1024 * 1024;
const configurationTrace = 'trace_mock_sync_configuration';
const routes = new Map([
  ['/v1/sync/changes', 'GET'],
  ['/v1/sync/cursor', 'GET'],
  ['/v1/sync/ack', 'POST'],
  ['/v1/sync/commands/context', 'GET'],
  ['/v1/events:batch', 'POST'],
  ['/v1/sync/events/receipt', 'POST'],
]);

/** A seeded development stream. Gaps may represent events absent from this scenario. */
export interface MockSyncSeed {
  scope: SyncUploadScope;
  server_cursor: number;
  changes: SyncChange[];
  acknowledgements?: { identity: SyncCommandIdentity; cursor: number }[];
  /** Presence explicitly enables uploads; an empty array allows ordinary client events. */
  upload_sources?: MockSyncFieldSource[];
}

/** Explicit simulated authority, never inferred from expected-identity request headers. */
export interface MockSyncSession {
  identity: SyncCommandIdentity;
  expires_at: string;
  read_sync: boolean;
  write_sync: boolean;
  project_readable: boolean;
  visible_event_ids: string[];
  upload_access?: MockSyncUploadAccess;
}

const messages = {
  MOCK_SYNC_CONFIGURATION_INVALID:
    'Supply a complete bounded sync stream and explicit simulated session',
  MOCK_ROUTE_NOT_FOUND: 'Mock route not found',
  INVALID_INPUT: 'Supply a valid sync request without extra parameters or write conditions',
  DENIED: 'The simulated session does not permit this request or original identity',
  NOT_FOUND: 'The simulated project is unavailable to this session',
  CURSOR_GAP: 'The requested cursor is ahead of the simulated stream',
  CURSOR_REGRESSION: 'The simulated acknowledgement cannot move backwards',
  RATE_LIMITED: 'The simulated store reached its consumer limit',
  SYNC_CHANGES_INVALID: 'The complete simulated page cannot be represented within its limit',
  SYNC_CURSOR_INVALID: 'The complete simulated acknowledgement cannot be represented',
  SYNC_COMMAND_CONTEXT_INVALID: 'The complete simulated identity cannot be represented',
  GATEWAY_RESPONSE_INVALID: 'The complete simulated response exceeds the requested byte limit',
  GATEWAY_REQUEST_CANCELED: 'The simulated request was canceled before completion',
} as const;
function fail(code: keyof typeof messages, trace: string) {
  return new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}
function row(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const record = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError();
  return record;
}
function text(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
function consumerKey(identity: SyncCommandIdentity) {
  return JSON.stringify([
    identity.tenant_id,
    identity.workspace_id,
    identity.project_id,
    identity.actor_id,
    identity.client_id,
  ]);
}
function page(
  scope: SyncUploadScope,
  changes: SyncChange[],
  next: number,
  more: boolean,
  trace: string,
) {
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: changes.flatMap((event) => event.source_refs),
    server_cursor: next,
    data: { ...scope, changes, next_cursor: next, has_more: more },
  };
}
function checked<T>(code: keyof typeof messages, trace: string, operation: () => T): T {
  try {
    return operation();
  } catch {
    throw fail(code, trace);
  }
}
export function isMockSyncPath(path: string) {
  return typeof path === 'string' && routes.has(path.split('?')[0]!);
}

/** Shared only when explicitly passed to multiple MockWcpServer instances; never persisted. */
export class MockSyncStore {
  readonly #scope: SyncUploadScope;
  #serverCursor: number;
  readonly #changes: SyncChange[];
  readonly #eventIds: Set<string>;
  readonly #acknowledgements = new Map<string, number>();
  readonly #uploads: MockSyncUploadLedger | undefined;

  constructor(seed: MockSyncSeed) {
    const saved = checked('MOCK_SYNC_CONFIGURATION_INVALID', configurationTrace, () => {
      const input = row(
        JSON.parse(syncJsonSnapshot(seed, SEED_BYTES)),
        ['scope', 'server_cursor', 'changes'],
        ['acknowledgements', 'upload_sources'],
      );
      const rawScope = row(input.scope, ['tenant_id', 'workspace_id', 'project_id']);
      const identity = parseSyncCommandIdentity({
        ...rawScope,
        actor_id: 'mock',
        client_id: 'mock',
      });
      const scope: SyncUploadScope = {
        tenant_id: identity.tenant_id,
        workspace_id: identity.workspace_id,
        project_id: identity.project_id,
      };
      const serverCursor = parseSyncCursorNumber(input.server_cursor);
      if (!Array.isArray(input.changes) || input.changes.length > MAX_CHANGES)
        throw new TypeError();
      const eventIds = new Set<string>();
      let previous = 0;
      const changes = input.changes.map((raw): SyncChange => {
        const event = row(
          raw,
          [
            'event_id',
            'event_type',
            'trace_id',
            'source_refs',
            'accepted',
            'server_cursor',
            'payload',
          ],
          Object.keys(raw),
        );
        // Validate each complete event without assuming the entire stream fits a single page.
        const validated = parseSyncChangesEnvelope(
          page(scope, [event as SyncChange], serverCursor, false, configurationTrace),
          { cursor: previous, limit: 1 },
          scope,
          configurationTrace,
        ).data.changes[0]!;
        if (eventIds.has(validated.event_id)) throw new TypeError();
        previous = validated.server_cursor;
        eventIds.add(validated.event_id);
        return validated;
      });
      const acknowledgements: { identity: SyncCommandIdentity; cursor: number }[] = [];
      if (Object.hasOwn(input, 'acknowledgements')) {
        if (!Array.isArray(input.acknowledgements) || input.acknowledgements.length > MAX_CONSUMERS)
          throw new TypeError();
        const keys = new Set<string>();
        for (const raw of input.acknowledgements) {
          const saved = row(raw, ['identity', 'cursor']);
          const identity = parseSyncCommandIdentity(saved.identity);
          assertSyncIdentityScope(identity, scope);
          const cursor = parseSyncCursorNumber(saved.cursor);
          const key = consumerKey(identity);
          if (cursor > serverCursor || keys.has(key)) throw new TypeError();
          keys.add(key);
          acknowledgements.push({ identity, cursor });
        }
      }
      const uploads = Object.hasOwn(input, 'upload_sources')
        ? new MockSyncUploadLedger(input.upload_sources)
        : undefined;
      if (uploads && ![scope.tenant_id, scope.workspace_id, scope.project_id].every(isUlid))
        throw new TypeError();
      return { scope, serverCursor, eventIds, changes, acknowledgements, uploads };
    });
    this.#scope = saved.scope;
    this.#serverCursor = saved.serverCursor;
    this.#changes = saved.changes;
    this.#eventIds = saved.eventIds;
    this.#uploads = saved.uploads;
    for (const entry of saved.acknowledgements)
      this.#acknowledgements.set(consumerKey(entry.identity), entry.cursor);
  }

  /** Capture a detached session; create another connection to model another account or permissions. */
  connect(session: MockSyncSession): WcpTransport {
    const saved = checked('MOCK_SYNC_CONFIGURATION_INVALID', configurationTrace, () => {
      const input = row(
        JSON.parse(syncJsonSnapshot(session, SESSION_BYTES)),
        [
          'identity',
          'expires_at',
          'read_sync',
          'write_sync',
          'project_readable',
          'visible_event_ids',
        ],
        ['upload_access'],
      );
      const identity = parseSyncCommandIdentity(input.identity);
      assertSyncIdentityScope(identity, this.#scope);
      if (
        typeof input.expires_at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expires_at) ||
        !Number.isFinite(Date.parse(input.expires_at)) ||
        new Date(input.expires_at).toISOString() !== input.expires_at ||
        typeof input.read_sync !== 'boolean' ||
        typeof input.write_sync !== 'boolean' ||
        typeof input.project_readable !== 'boolean' ||
        !Array.isArray(input.visible_event_ids) ||
        input.visible_event_ids.length > MAX_CHANGES
      )
        throw new TypeError();
      const visible = new Set<string>();
      for (const id of input.visible_event_ids) {
        if (typeof id !== 'string' || !this.#eventIds.has(id) || visible.has(id))
          throw new TypeError();
        visible.add(id);
      }
      if (Object.hasOwn(input, 'upload_access') && !this.#uploads) throw new TypeError();
      const upload_access = Object.hasOwn(input, 'upload_access')
        ? this.#uploads!.access(input.upload_access)
        : undefined;
      return {
        identity,
        expires_at: input.expires_at,
        read_sync: input.read_sync,
        write_sync: input.write_sync,
        project_readable: input.project_readable,
        visible,
        upload_access,
      };
    });
    return {
      request: async <T = unknown>(request: WcpRequest): Promise<T> =>
        this.respond(request, saved) as T,
    };
  }

  private respond(
    request: WcpRequest,
    session: {
      identity: SyncCommandIdentity;
      expires_at: string;
      read_sync: boolean;
      write_sync: boolean;
      project_readable: boolean;
      visible: Set<string>;
      upload_access: MockSyncUploadAccess | undefined;
    },
  ): unknown {
    let trace = 'trace_unknown';
    const headers = checked('INVALID_INPUT', trace, () => {
      const input = row(
        JSON.parse(syncJsonSnapshot(request.headers, 16 * 1024)),
        [],
        Object.keys(request.headers),
      );
      const result = new Map<string, string>();
      for (const [key, value] of Object.entries(input)) {
        const name = key.toLowerCase();
        if (result.has(name) || typeof value !== 'string') throw new TypeError();
        result.set(name, value);
      }
      return result;
    });
    const suppliedTrace = headers.get('x-trace-id') ?? headers.get('traceparent');
    if (!text(suppliedTrace)) throw fail('INVALID_INPUT', trace);
    trace = suppliedTrace;
    const checkLive = () => {
      if (request.signal?.aborted) throw fail('GATEWAY_REQUEST_CANCELED', trace);
      if (Date.parse(session.expires_at) <= Date.now()) throw fail('DENIED', trace);
    };
    checkLive();
    if (typeof request.path !== 'string') throw fail('INVALID_INPUT', trace);
    const path = request.path.split('?')[0]!;
    const method = routes.get(path);
    if (method === undefined || method !== request.method)
      throw fail('MOCK_ROUTE_NOT_FOUND', trace);
    if (request.path.length > SYNC_CHANGES_QUERY_BYTES || request.path.includes('#'))
      throw fail('INVALID_INPUT', trace);
    const isIdentity = path === '/v1/sync/commands/context';
    const isAck = path === '/v1/sync/ack';
    const isUpload = path === '/v1/events:batch';
    const isReceipt = path === '/v1/sync/events/receipt';
    if ((isUpload || isReceipt) && !this.#uploads) throw fail('MOCK_ROUTE_NOT_FOUND', trace);
    if (!(isIdentity || isUpload || isReceipt ? session.write_sync : session.read_sync))
      throw fail('DENIED', trace);
    if ((isUpload || isReceipt) && !session.upload_access) throw fail('DENIED', trace);
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (headers.get('x-' + field.replaceAll('_', '-')) !== session.identity[field])
        throw fail('DENIED', trace);
    for (const [header, field] of [
      ['x-expected-actor-id', 'actor_id'],
      ['x-expected-client-id', 'client_id'],
    ] as const)
      if (headers.has(header) && headers.get(header) !== session.identity[field])
        throw fail('DENIED', trace);
    if (isAck && headers.has('x-expected-actor-id') !== headers.has('x-expected-client-id'))
      throw fail('DENIED', trace);
    if (
      ['if-match', 'x-expected-version'].some((key) => headers.has(key)) ||
      (!isUpload && headers.has('idempotency-key')) ||
      ((isUpload || isReceipt) &&
        [
          'if-none-match',
          'if-modified-since',
          'if-unmodified-since',
          'range',
          'content-encoding',
        ].some((key) => headers.has(key)))
    )
      throw fail('INVALID_INPUT', trace);
    if (
      request.response_type !== undefined &&
      !['json', 'bounded-json'].includes(request.response_type)
    )
      throw fail('INVALID_INPUT', trace);
    const maximum = request.max_response_bytes;
    if (
      (request.response_type === 'bounded-json' && maximum === undefined) ||
      (maximum !== undefined && (!Number.isSafeInteger(maximum) || maximum < 1))
    )
      throw fail('INVALID_INPUT', trace);
    const parameters = new URLSearchParams(
      request.path.includes('?') ? request.path.slice(request.path.indexOf('?') + 1) : '',
    );
    if (path !== '/v1/sync/changes' && parameters.size) throw fail('INVALID_INPUT', trace);
    if (!isAck && !isUpload && !isReceipt && request.body !== undefined)
      throw fail('INVALID_INPUT', trace);
    // Every response is detached and bounded before its synchronous state mutations below.
    const finish = (value: unknown, cap: number) => {
      const result = checked(
        'GATEWAY_RESPONSE_INVALID',
        trace,
        () => JSON.parse(syncJsonSnapshot(value, Math.min(maximum ?? cap, cap))) as unknown,
      );
      checkLive();
      return result;
    };
    if (isIdentity) {
      const result = checked('SYNC_COMMAND_CONTEXT_INVALID', trace, () =>
        parseSyncCommandContextEnvelope(
          {
            schema_version: 1,
            trace_id: trace,
            source_refs: [],
            data: {
              identity: session.identity,
              expires_at: session.expires_at,
              permissions: { upload_events: true },
            },
          },
          this.#scope,
          trace,
          session.identity,
        ),
      );
      return finish(result, SYNC_COMMAND_CONTEXT_BYTES);
    }
    if (!session.project_readable) throw fail('NOT_FOUND', trace);
    if (isReceipt) {
      return finish(
        this.#uploads!.receipt(request.body, session.identity, session.upload_access!, trace),
        SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
      );
    }
    if (isUpload) {
      const batchKey = headers.get('idempotency-key');
      if (batchKey === undefined) throw fail('INVALID_INPUT', trace);
      const plan = this.#uploads!.plan(
        request.body,
        batchKey,
        session.identity,
        session.upload_access!,
        trace,
        this.#serverCursor,
      );
      if (this.#changes.length + plan.changes.length > MAX_CHANGES)
        throw fail('RATE_LIMITED', trace);
      const ids = new Set<string>();
      let cursor = this.#serverCursor;
      const additions = checked('SYNC_CHANGES_INVALID', trace, () =>
        plan.changes.map((change) => {
          if (!validateEvent(change).valid) throw new TypeError();
          const result = parseSyncChangesEnvelope(
            page(this.#scope, [change], plan.response.data.next_cursor, false, trace),
            { cursor, limit: 1 },
            this.#scope,
            trace,
          ).data.changes[0]!;
          if (this.#eventIds.has(result.event_id) || ids.has(result.event_id))
            throw new TypeError();
          ids.add(result.event_id);
          cursor = result.server_cursor;
          return result;
        }),
      );
      if (
        new TextEncoder().encode(JSON.stringify([...this.#changes, ...additions])).byteLength >
        SEED_BYTES
      )
        throw fail('RATE_LIMITED', trace);
      const response = finish(plan.response, SYNC_UPLOAD_RESPONSE_BYTES);
      // No await or caller callback between validation and committing the ledger and stream.
      plan.commit();
      this.#changes.push(...additions);
      for (const change of additions) this.#eventIds.add(change.event_id);
      // A replay returns its historical watermark; it cannot move the live stream backwards.
      if (additions.length) this.#serverCursor = cursor;
      return response;
    }
    const key = consumerKey(session.identity);
    const savedCursor = this.#acknowledgements.get(key);
    if (path === '/v1/sync/cursor') {
      const cursor = savedCursor ?? 0;
      const result = checked('SYNC_CURSOR_INVALID', trace, () =>
        parseSyncCursorEnvelope(
          {
            schema_version: 1,
            trace_id: trace,
            source_refs:
              savedCursor === undefined
                ? []
                : [{ type: 'sync-cursor', id: session.identity.client_id + ':' + cursor }],
            server_cursor: cursor,
            data: {
              identity: session.identity,
              cursor,
              recorded: savedCursor !== undefined,
              expires_at: session.expires_at,
              permissions: { acknowledge_sync: true },
            },
          },
          this.#scope,
          trace,
          session.identity,
        ),
      );
      return finish(result, SYNC_CURSOR_RESPONSE_BYTES);
    }
    if (isAck) {
      const command = checked('INVALID_INPUT', trace, () =>
        parseSyncAcknowledgement(
          JSON.parse(syncJsonSnapshot(request.body, SYNC_CURSOR_REQUEST_BYTES)),
        ),
      );
      checked('DENIED', trace, () =>
        assertSyncCommandIdentity(command.expected_identity, session.identity),
      );
      if (command.cursor > this.#serverCursor) throw fail('CURSOR_GAP', trace);
      if (command.cursor < (savedCursor ?? 0)) throw fail('CURSOR_REGRESSION', trace);
      if (savedCursor === undefined && this.#acknowledgements.size >= MAX_CONSUMERS)
        throw fail('RATE_LIMITED', trace);
      const result = checked('SYNC_CURSOR_INVALID', trace, () =>
        parseSyncAcknowledgementEnvelope(
          {
            schema_version: 1,
            trace_id: trace,
            source_refs: [
              { type: 'sync-cursor', id: session.identity.client_id + ':' + command.cursor },
            ],
            server_cursor: command.cursor,
            data: {
              identity: session.identity,
              client_id: session.identity.client_id,
              cursor: command.cursor,
            },
          },
          command,
          trace,
        ),
      );
      const response = finish(result, SYNC_CURSOR_RESPONSE_BYTES);
      this.#acknowledgements.set(key, command.cursor);
      return response;
    }
    const query = checked('INVALID_INPUT', trace, () => {
      const input: SyncChangesQuery = {};
      for (const [name, value] of parameters) {
        if (
          (name !== 'cursor' && name !== 'limit') ||
          Object.hasOwn(input, name) ||
          !/^(0|[1-9][0-9]*)$/.test(value)
        )
          throw new TypeError();
        input[name] = Number(value);
      }
      return parseSyncChangesQuery(input);
    });
    const after = query.cursor ?? savedCursor ?? 0;
    if (after > this.#serverCursor) throw fail('CURSOR_GAP', trace);
    const limit = query.limit ?? 100;
    const selected: SyncChange[] = [];
    for (const event of this.#changes) {
      const explicitlyVisible = session.visible.has(event.event_id);
      const visible =
        this.#uploads?.visible(
          event.event_id,
          session.identity,
          session.upload_access,
          explicitlyVisible,
        ) ?? explicitlyVisible;
      if (event.server_cursor > after && visible) selected.push(event);
      if (selected.length > limit) break;
    }
    const more = selected.length > limit;
    const changes = selected.slice(0, limit);
    const next = more ? changes[changes.length - 1]!.server_cursor : this.#serverCursor;
    const result = checked('SYNC_CHANGES_INVALID', trace, () =>
      parseSyncChangesEnvelope(
        page(this.#scope, changes, next, more, trace),
        { ...query, cursor: after },
        this.#scope,
        trace,
      ),
    );
    return finish(result, SYNC_CHANGES_RESPONSE_BYTES);
  }
}
