import {
  ContractError,
  assertConflictReceiptIdentity,
  buildEtag,
  compareConflictIds,
  conflictReceiptJson,
  createUlid,
  encodeConflictRegistryCursor,
  foldConflictQuery,
  isUlid,
  parseConflictCommandContextEnvelope,
  parseConflictReadEnvelope,
  parseConflictReadQuery,
  parseConflictReceiptEnvelope,
  parseConflictReceiptQuery,
  parseConflictRegistryCursor,
  parseConflictRegistryEnvelope,
  parseConflictRegistryQuery,
  parseConflictRegistryRecord,
  parseConflictSubmissionResponse,
  parseEtag,
  type Classification,
  type ConflictReadRecord,
  type ConflictReceiptQuery,
  type SyncChange,
  type SyncCommandIdentity,
  type SyncUploadScope,
} from '@planemem/contracts';
import { validateEvent, type CanonicalEvent } from '@planemem/events';

export interface MockSyncConflictAccess {
  read: boolean;
  resolve: boolean;
}
export interface MockSyncConflictSeed {
  record: ConflictReadRecord;
  source: string;
  sensitivity: Classification;
  origin: SyncCommandIdentity;
}
type Decision = {
  original: ConflictReceiptQuery;
  fingerprint: string;
  event: CanonicalEvent;
  cursor: number;
};
type Stored = MockSyncConflictSeed & { decision: Decision | null; bytes: number };
type Visible = (source: string, sensitivity: Classification) => boolean;
export interface MockSyncMutationPlan {
  response: unknown;
  changes: SyncChange[];
  commit: () => void;
}
type Route =
  | { kind: 'list'; method: 'GET' }
  | { kind: 'identity'; method: 'GET' }
  | { kind: 'receipt'; method: 'POST' }
  | { kind: 'get'; method: 'GET'; encodedId: string }
  | { kind: 'resolve'; method: 'POST'; encodedId: string };
const MAX_BYTES = 16 * 1024 * 1024;
function fail(code: string, trace: string): never {
  throw new ContractError(code, 'Simulated conflict request failed: ' + code, {
    trace_id: trace,
    retryable: false,
  });
}
function checked<T>(code: string, trace: string, operation: () => T): T {
  try {
    return operation();
  } catch {
    return fail(code, trace);
  }
}
function scope(identity: SyncCommandIdentity): SyncUploadScope {
  return {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  };
}
function commandFingerprint(original: ConflictReceiptQuery) {
  const { idempotency_key: _key, ...command } = original.command;
  return conflictReceiptJson(command);
}
function sameKey(left: ConflictReceiptQuery, right: ConflictReceiptQuery) {
  return (
    left.request_key === right.request_key &&
    conflictReceiptJson(left.identity) === conflictReceiptJson(right.identity)
  );
}
export function mockConflictRoute(path: string): Route | undefined {
  if (path === '/v1/conflicts') return { kind: 'list', method: 'GET' };
  if (path === '/v1/conflicts/commands/context') return { kind: 'identity', method: 'GET' };
  if (path === '/v1/conflicts/receipt') return { kind: 'receipt', method: 'POST' };
  const match = /^\/v1\/conflicts\/([^/]+)(\/resolve)?$/.exec(path);
  if (match)
    return match[2]
      ? { kind: 'resolve', method: 'POST', encodedId: match[1]! }
      : { kind: 'get', method: 'GET', encodedId: match[1]! };
  return undefined;
}
export function mockConflictId(encoded: string, trace: string) {
  return checked('INVALID_INPUT', trace, () => {
    const id = decodeURIComponent(encoded);
    if (encodeURIComponent(id) !== encoded) throw new TypeError();
    return parseConflictReadQuery({ conflict_id: id }).conflict_id;
  });
}
export function parseMockSyncConflictAccess(value: unknown): MockSyncConflictAccess {
  return checked('MOCK_SYNC_CONFIGURATION_INVALID', 'trace_mock_sync_configuration', () => {
    const row: unknown = JSON.parse(conflictReceiptJson(value, 1024));
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).length !== 2 ||
      !Object.hasOwn(row, 'read') ||
      !Object.hasOwn(row, 'resolve')
    )
      throw new TypeError();
    const access = row as Record<string, unknown>;
    if (typeof access.read !== 'boolean' || typeof access.resolve !== 'boolean')
      throw new TypeError();
    return { read: access.read, resolve: access.resolve };
  });
}

/** In-memory conflicts created by this store's uploads; seeded stream events are not records. */
export class MockSyncConflictLedger {
  readonly #records = new Map<string, Stored>();
  readonly #resolutionEvents = new Map<string, Stored>();
  readonly #cursorNamespace = createUlid();
  #bytes = 0;

  prepareCreated(input: MockSyncConflictSeed[], trace: string) {
    if (this.#records.size + input.length > 10_000) fail('RATE_LIMITED', trace);
    const ids = new Set<string>();
    const rows = input.map((item): Stored => {
      const record = checked(
        'CONFLICT_READ_INVALID',
        trace,
        () =>
          parseConflictReadEnvelope(
            {
              schema_version: 1,
              scope: scope(item.origin),
              trace_id: trace,
              source_refs: [{ type: 'conflict', id: item.record.conflict_id }],
              data: item.record,
            },
            { conflict_id: item.record.conflict_id },
            scope(item.origin),
            trace,
          ).data,
      );
      if (ids.has(record.conflict_id) || this.#records.has(record.conflict_id))
        fail('CONFLICT_READ_INVALID', trace);
      ids.add(record.conflict_id);
      const saved = { ...item, record, decision: null };
      const bytes = new TextEncoder().encode(JSON.stringify(saved)).byteLength;
      return { ...saved, bytes };
    });
    const bytes = rows.reduce((total, item) => total + item.bytes, 0);
    if (this.#bytes + bytes > MAX_BYTES) fail('RATE_LIMITED', trace);
    return () => {
      for (const item of rows) this.#records.set(item.record.conflict_id, item);
      this.#bytes += bytes;
    };
  }
  private get(id: string, visible: Visible, trace: string) {
    const item = this.#records.get(id);
    if (!item || !visible(item.source, item.sensitivity)) fail('CONFLICT_NOT_FOUND', trace);
    return item;
  }
  detail(id: string, identity: SyncCommandIdentity, visible: Visible, trace: string) {
    const item = this.get(id, visible, trace);
    return checked('CONFLICT_READ_INVALID', trace, () =>
      parseConflictReadEnvelope(
        {
          schema_version: 1,
          scope: scope(identity),
          trace_id: trace,
          source_refs: [{ type: 'conflict', id }],
          data: item.record,
        },
        { conflict_id: id },
        scope(identity),
        trace,
      ),
    );
  }
  identity(identity: SyncCommandIdentity, expires: string, trace: string) {
    return checked('CONFLICT_COMMAND_CONTEXT_INVALID', trace, () =>
      parseConflictCommandContextEnvelope(
        {
          schema_version: 1,
          trace_id: trace,
          source_refs: [],
          data: { identity, expires_at: expires, permissions: { resolve_conflicts: true } },
        },
        scope(identity),
        trace,
        identity,
      ),
    );
  }
  async list(
    parameters: URLSearchParams,
    identity: SyncCommandIdentity,
    access: MockSyncConflictAccess,
    visibilityBinding: unknown,
    visible: Visible,
    trace: string,
  ) {
    const query = checked('INVALID_INPUT', trace, () => {
      const raw: Record<string, unknown> = {};
      for (const [key, value] of parameters) {
        if (
          !['query', 'status', 'entity_type', 'conflict_id', 'limit', 'cursor'].includes(key) ||
          Object.hasOwn(raw, key)
        )
          throw new TypeError();
        if (key === 'limit' && !/^[1-9][0-9]{0,2}$/.test(value)) throw new TypeError();
        raw[key] = key === 'limit' ? Number(value) : value;
      }
      return parseConflictRegistryQuery(raw);
    });
    const { cursor, ...filters } = query;
    const binding = checked('INVALID_INPUT', trace, () =>
      conflictReceiptJson(
        {
          namespace: this.#cursorNamespace,
          identity,
          access,
          visibility: visibilityBinding,
          filters: {
            ...filters,
            query: foldConflictQuery(query.query ?? ''),
            limit: query.limit ?? 25,
          },
        },
        4 * 1024 * 1024,
      ),
    );
    let key: string;
    try {
      const bytes = new TextEncoder().encode(binding);
      const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
      key = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      return fail('CONFLICT_REGISTRY_INVALID', trace);
    }
    const after = checked('INVALID_INPUT', trace, () => {
      if (cursor === undefined) return undefined;
      const parsed = parseConflictRegistryCursor(cursor);
      if (parsed.key !== key) throw new TypeError();
      return parsed.conflict_id;
    });
    // Hashing may yield; take the actual bounded directory observation only after it completes.
    const matching = [...this.#records.values()]
      .filter((item) => {
        const row = item.record;
        return (
          visible(item.source, item.sensitivity) &&
          (after === undefined || compareConflictIds(after, row.conflict_id) < 0) &&
          (query.conflict_id === undefined || query.conflict_id === row.conflict_id) &&
          (query.status === undefined || query.status === row.status) &&
          (query.entity_type === undefined || query.entity_type === row.entity_type) &&
          (query.query === undefined ||
            [
              row.conflict_id,
              row.entity_type,
              row.entity_id,
              row.field,
              row.actor_id ?? '',
              row.trace_id,
            ].some((value) => foldConflictQuery(value).includes(foldConflictQuery(query.query!))))
        );
      })
      .sort((a, b) => compareConflictIds(a.record.conflict_id, b.record.conflict_id));
    const limit = query.limit ?? 25;
    const selected = matching.slice(0, limit);
    const more = matching.length > selected.length;
    return checked('CONFLICT_REGISTRY_INVALID', trace, () =>
      parseConflictRegistryEnvelope(
        {
          schema_version: 1,
          scope: scope(identity),
          trace_id: trace,
          source_refs: [{ type: 'postgres', id: 'wcp_conflicts' }],
          conflict_permissions: { resolve: access.resolve },
          data: selected.map(({ record }) => {
            const {
              conflict_id,
              entity_type,
              entity_id,
              field,
              base_version,
              local_version,
              server_version,
              version,
              status,
              resolution,
              actor_id,
              trace_id,
            } = record;
            return parseConflictRegistryRecord({
              conflict_id,
              entity_type,
              entity_id,
              field,
              base_version,
              local_version,
              server_version,
              version,
              status,
              resolution,
              actor_id,
              trace_id,
            });
          }),
          has_more: more,
          ...(more
            ? {
                next_cursor: encodeConflictRegistryCursor(
                  key,
                  selected[selected.length - 1]!.record.conflict_id,
                ),
              }
            : {}),
        },
        query,
        scope(identity),
        trace,
      ),
    );
  }
  receipt(body: unknown, identity: SyncCommandIdentity, visible: Visible, trace: string) {
    const original = checked('INVALID_INPUT', trace, () => parseConflictReceiptQuery(body));
    checked('DENIED', trace, () => assertConflictReceiptIdentity(original.identity, identity));
    const saved = this.get(original.command.conflict_id, visible, trace).decision;
    const found = saved && sameKey(saved.original, original) ? saved : null;
    if (found && found.fingerprint !== commandFingerprint(original))
      fail('IDEMPOTENCY_KEY_REUSED', trace);
    return checked('CONFLICT_RECEIPT_INVALID', trace, () =>
      parseConflictReceiptEnvelope(
        {
          schema_version: 1,
          trace_id: trace,
          source_refs: found ? [{ type: 'event', id: found.event.event_id }] : [],
          data: {
            ...original,
            ...(found
              ? {
                  status: 'recorded',
                  receipt: {
                    conflict_id: original.command.conflict_id,
                    version: String(found.event.aggregate_version),
                    resolution: original.command.resolution,
                    event_id: found.event.event_id,
                    server_cursor: String(found.cursor),
                    actor_id: original.identity.actor_id,
                    client_id: original.identity.client_id,
                    recorded_at: found.event.occurred_at,
                    original_trace_id: found.event.trace_id,
                    source_application: 'not-checked',
                  },
                }
              : { status: 'not-observed' }),
          },
        },
        original,
        trace,
      ),
    );
  }
  resolve(
    id: string,
    body: unknown,
    headers: Map<string, string>,
    identity: SyncCommandIdentity,
    visible: Visible,
    trace: string,
    cursor: number,
  ): MockSyncMutationPlan {
    const original = checked('INVALID_INPUT', trace, () => {
      const raw: unknown = JSON.parse(conflictReceiptJson(body));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError();
      const command = raw as Record<string, unknown>;
      const version = parseEtag(headers.get('if-match'));
      if (
        (command.conflict_id !== undefined && command.conflict_id !== id) ||
        (command.expected_version !== undefined && command.expected_version !== version)
      )
        throw new TypeError();
      return parseConflictReceiptQuery({
        identity,
        request_key: headers.get('idempotency-key'),
        command: { ...command, conflict_id: id, expected_version: version },
      });
    });
    const item = this.get(id, visible, trace);
    const fingerprint = commandFingerprint(original);
    const response = (decision: Decision) => {
      const event = decision.event;
      const result = {
        schema_version: 1,
        trace_id: trace,
        source_refs: event.source_refs,
        revision: event.aggregate_version,
        etag: buildEtag(event.aggregate_version),
        server_cursor: decision.cursor,
        data: {
          conflict_id: id,
          version: event.aggregate_version,
          resolution: event.payload.resolution,
          event,
        },
      };
      checked('CONFLICT_SUBMISSION_INVALID', trace, () =>
        parseConflictSubmissionResponse(result, original, trace),
      );
      return result;
    };
    if (item.decision) {
      if (!sameKey(item.decision.original, original)) fail('CONFLICT_ALREADY_RESOLVED', trace);
      if (item.decision.fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED', trace);
      return { response: response(item.decision), changes: [], commit: () => {} };
    }
    if (String(original.command.expected_version) !== item.record.version)
      fail('VERSION_CONFLICT', trace);
    if (cursor >= Number.MAX_SAFE_INTEGER) fail('RATE_LIMITED', trace);
    const version = original.command.expected_version + 1;
    const resolution = original.command.resolution;
    const value: unknown =
      resolution === 'merge'
        ? original.command.merged_value
        : JSON.parse(
            resolution === 'local' ? item.record.local_value_json! : item.record.server_value_json!,
          );
    const event: CanonicalEvent = {
      schema_version: 1,
      event_id: createUlid(),
      event_type: 'ConflictResolved',
      tenant_id: identity.tenant_id as CanonicalEvent['tenant_id'],
      workspace_id: identity.workspace_id as CanonicalEvent['workspace_id'],
      project_id: identity.project_id as CanonicalEvent['tenant_id'],
      aggregate_type: 'Conflict',
      aggregate_id: id as CanonicalEvent['aggregate_id'],
      aggregate_version: version,
      ...(isUlid(identity.actor_id) ? { actor_id: identity.actor_id } : {}),
      client_id: identity.client_id,
      occurred_at: new Date().toISOString(),
      trace_id: trace,
      sensitivity: item.sensitivity,
      source_refs: [{ type: 'conflict', id }, ...item.record.source_refs],
      payload: {
        conflict_id: id,
        entity_type: item.record.entity_type,
        entity_id: item.record.entity_id,
        field: item.record.field,
        base_version: Number(item.record.base_version),
        local_version: Number(item.record.local_version),
        server_version: Number(item.record.server_version),
        resolution,
        resolved_value: value,
        actor_id: identity.actor_id,
      },
    };
    if (!validateEvent(event).valid) fail('CONFLICT_SUBMISSION_INVALID', trace);
    const decision = { original, fingerprint, event, cursor: cursor + 1 };
    const record: ConflictReadRecord = {
      ...item.record,
      version: String(version),
      status: 'resolved',
      decision_state: 'recorded',
      resolution,
      resolved_value_json: JSON.stringify(value),
      resolved_value_state: 'recorded',
      actor_id: identity.actor_id,
      resolved_at: event.occurred_at,
      resolved_by_client: identity.client_id,
      resolution_event_id: event.event_id,
      trace_id: trace,
    };
    checked('CONFLICT_READ_INVALID', trace, () =>
      parseConflictReadEnvelope(
        {
          schema_version: 1,
          scope: scope(identity),
          trace_id: trace,
          source_refs: [{ type: 'conflict', id }],
          data: record,
        },
        { conflict_id: id },
        scope(identity),
        trace,
      ),
    );
    const { bytes: _bytes, ...previous } = item;
    const updated = { ...previous, record, decision };
    const bytes = new TextEncoder().encode(JSON.stringify(updated)).byteLength;
    if (this.#bytes - item.bytes + bytes > MAX_BYTES) fail('RATE_LIMITED', trace);
    const saved = { ...updated, bytes };
    return {
      response: response(decision),
      changes: [{ ...event, accepted: true, server_cursor: decision.cursor }],
      commit: () => {
        this.#records.set(id, saved);
        this.#resolutionEvents.set(event.event_id, saved);
        this.#bytes += bytes - item.bytes;
      },
    };
  }
  visibleEvent(
    id: string,
    identity: SyncCommandIdentity,
    explicitlyVisible: boolean,
    includeOwn: boolean,
    visible: Visible,
  ): boolean | undefined {
    const item = this.#resolutionEvents.get(id);
    if (!item) return undefined;
    return (
      visible(item.source, item.sensitivity) &&
      (explicitlyVisible ||
        (includeOwn && conflictReceiptJson(item.origin) === conflictReceiptJson(identity)))
    );
  }
}
