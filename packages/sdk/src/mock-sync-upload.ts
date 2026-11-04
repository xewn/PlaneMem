import {
  ContractError,
  assertSyncCommandIdentity,
  createUlid,
  isSyncIdentifier,
  isUlid,
  parseSyncEventReceiptEnvelope,
  parseSyncEventReceiptQuery,
  parseSyncUploadEnvelope,
  parseSyncUploadEvent,
  snapshotSyncUploadBatch,
  syncClassifications,
  syncJsonSnapshot,
  validateIdempotencyKey,
  MAX_SYNC_BATCH_BYTES,
  type Classification,
  type ProposedFieldChange,
  type SyncChange,
  type SyncCommandIdentity,
  type SyncRecordedEventReceipt,
  type SyncUploadResult,
} from '@planemem/contracts';

export interface MockSyncFieldSource {
  entity_type: ProposedFieldChange['entity_type'];
  entity_id: string;
  version: number;
  classification: Classification;
  available: boolean;
  fields: Record<string, unknown>;
}
export interface MockSyncUploadAccess {
  read_restricted: boolean;
  include_own_uploads: boolean;
  visible_sources: { entity_type: MockSyncFieldSource['entity_type']; entity_id: string }[];
}
const fields = {
  work_item: ['title', 'status', 'priority', 'owner', 'progress', 'description', 'due_at'],
  context_item: ['title', 'status', 'priority', 'content', 'layer', 'expires_at'],
  session: ['status', 'parent_session_id'],
};
const MAX_RETAINED_BYTES = 16 * 1024 * 1024;
function fail(code: string, trace: string): never {
  throw new ContractError(code, 'Simulated sync request failed: ' + code, {
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
function row(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new TypeError();
  return value as Record<string, unknown>;
}
function canonical(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sort(child)]),
      );
    return item;
  };
  return JSON.stringify(sort(value));
}
function sender(identity: SyncCommandIdentity) {
  return JSON.stringify([
    identity.tenant_id,
    identity.workspace_id,
    identity.project_id,
    identity.actor_id,
    identity.client_id,
  ]);
}
function sourceKey(source: { entity_type: string; entity_id: string }) {
  return JSON.stringify([source.entity_type, source.entity_id]);
}
function fieldChange(payload: Record<string, unknown>): ProposedFieldChange | undefined {
  if (
    typeof payload.entity_type !== 'string' ||
    !Object.hasOwn(fields, payload.entity_type) ||
    !isSyncIdentifier(payload.entity_id) ||
    typeof payload.field !== 'string' ||
    !fields[payload.entity_type as keyof typeof fields].includes(payload.field) ||
    !Object.hasOwn(payload, 'value') ||
    typeof payload.base_version !== 'number' ||
    !Number.isSafeInteger(payload.base_version) ||
    payload.base_version < 1 ||
    payload.base_version >= Number.MAX_SAFE_INTEGER
  )
    return;
  return {
    entity_type: payload.entity_type as ProposedFieldChange['entity_type'],
    entity_id: payload.entity_id,
    field: payload.field,
    base_version: payload.base_version,
    value: payload.value,
  };
}
type Delivery = {
  sender: string;
  fingerprint: string;
  source: string | null;
  sensitivity: Classification;
  receipt: SyncRecordedEventReceipt;
};

/** Internal synchronous ledger. The parent validates the complete response/stream before commit. */
export class MockSyncUploadLedger {
  readonly #sources = new Map<string, MockSyncFieldSource>();
  readonly #batches = new Map<string, { fingerprint: string; result: SyncUploadResult }>();
  readonly #deliveries = new Map<string, Delivery>();
  readonly #serverDeliveries = new Map<string, Delivery>();
  readonly #sequences = new Map<string, number>();
  #retainedBytes = 0;

  constructor(value: unknown) {
    checked('MOCK_SYNC_CONFIGURATION_INVALID', 'trace_mock_sync_configuration', () => {
      const sources: unknown = JSON.parse(syncJsonSnapshot(value, MAX_RETAINED_BYTES));
      if (!Array.isArray(sources) || sources.length > 1000) throw new TypeError();
      for (const raw of sources) {
        const source = row(raw, [
          'entity_type',
          'entity_id',
          'version',
          'classification',
          'available',
          'fields',
        ]);
        if (
          typeof source.entity_type !== 'string' ||
          !Object.hasOwn(fields, source.entity_type) ||
          !isSyncIdentifier(source.entity_id) ||
          typeof source.version !== 'number' ||
          !Number.isSafeInteger(source.version) ||
          source.version < 1 ||
          source.version >= Number.MAX_SAFE_INTEGER ||
          !syncClassifications.includes(source.classification as Classification) ||
          typeof source.available !== 'boolean' ||
          !source.fields ||
          typeof source.fields !== 'object' ||
          Array.isArray(source.fields) ||
          Object.keys(source.fields).some(
            (field) => !fields[source.entity_type as keyof typeof fields].includes(field),
          ) ||
          (source.entity_type === 'session' && source.classification !== 'internal')
        )
          throw new TypeError();
        const item = source as unknown as MockSyncFieldSource;
        const key = sourceKey(item);
        if (this.#sources.has(key)) throw new TypeError();
        this.#sources.set(key, item);
      }
    });
  }

  access(value: unknown): MockSyncUploadAccess {
    return checked('MOCK_SYNC_CONFIGURATION_INVALID', 'trace_mock_sync_configuration', () => {
      const input = row(JSON.parse(syncJsonSnapshot(value, 4 * 1024 * 1024)), [
        'read_restricted',
        'include_own_uploads',
        'visible_sources',
      ]);
      if (
        typeof input.read_restricted !== 'boolean' ||
        typeof input.include_own_uploads !== 'boolean' ||
        !Array.isArray(input.visible_sources) ||
        input.visible_sources.length > 1000
      )
        throw new TypeError();
      const unique = new Set<string>();
      for (const raw of input.visible_sources) {
        const source = row(raw, ['entity_type', 'entity_id']);
        if (typeof source.entity_type !== 'string' || !isSyncIdentifier(source.entity_id))
          throw new TypeError();
        const key = sourceKey({ entity_type: source.entity_type, entity_id: source.entity_id });
        if (!this.#sources.has(key) || unique.has(key)) throw new TypeError();
        unique.add(key);
      }
      return input as unknown as MockSyncUploadAccess;
    });
  }
  private sourceVisible(key: string, access: MockSyncUploadAccess) {
    const source = this.#sources.get(key);
    return (
      !!source?.available &&
      (source.classification !== 'restricted' || access.read_restricted) &&
      access.visible_sources.some((item) => sourceKey(item) === key)
    );
  }
  private readable(delivery: Delivery, access: MockSyncUploadAccess) {
    return (
      (delivery.sensitivity !== 'restricted' || access.read_restricted) &&
      (delivery.source === null || this.sourceVisible(delivery.source, access))
    );
  }
  visible(
    id: string,
    identity: SyncCommandIdentity,
    access: MockSyncUploadAccess | undefined,
    explicitlyVisible: boolean,
  ): boolean | undefined {
    const delivery = this.#serverDeliveries.get(id);
    if (!delivery) return undefined;
    return (
      !!access &&
      this.readable(delivery, access) &&
      (explicitlyVisible || (access.include_own_uploads && delivery.sender === sender(identity)))
    );
  }

  plan(
    body: unknown,
    key: string,
    identity: SyncCommandIdentity,
    access: MockSyncUploadAccess,
    trace: string,
    currentCursor: number,
  ) {
    const original = checked('INVALID_INPUT', trace, () => {
      validateIdempotencyKey(key);
      const input = row(JSON.parse(syncJsonSnapshot(body, MAX_SYNC_BATCH_BYTES)), ['events']);
      return snapshotSyncUploadBatch(input.events);
    });
    // Gateway namespaces batch keys by actor/client; this store also fixes the project scope.
    const senderKey = sender(identity);
    const batchKey = JSON.stringify([senderKey, key]);
    const fingerprint = canonical({ events: original });
    const previous = this.#batches.get(batchKey);
    const envelope = (result: SyncUploadResult) =>
      parseSyncUploadEnvelope(
        {
          schema_version: 1,
          trace_id: trace,
          source_refs: [{ type: 'sync-stream', id: identity.project_id }],
          server_cursor: result.next_cursor,
          data: {
            tenant_id: identity.tenant_id,
            workspace_id: identity.workspace_id,
            project_id: identity.project_id,
            ...result,
          },
        },
        original,
        identity,
        trace,
      );
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED', trace);
      return {
        response: checked('SYNC_UPLOAD_INVALID', trace, () => envelope(previous.result)),
        changes: [] as SyncChange[],
        commit: () => {},
      };
    }
    if (this.#batches.size >= 1000) fail('RATE_LIMITED', trace);
    let last = this.#sequences.get(senderKey) ?? 0;
    const result: SyncUploadResult = { accepted: [], rejected: [], next_cursor: currentCursor };
    const additions: { key: string; delivery: Delivery }[] = [];
    const changes: SyncChange[] = [];
    const deliver = (receipt: SyncRecordedEventReceipt) => {
      const common = {
        event_id: receipt.event_id,
        server_event_id: receipt.server_event_id,
        server_cursor: receipt.server_cursor,
      };
      if (receipt.accepted) result.accepted.push({ ...common, accepted: true });
      else
        result.rejected.push({
          ...common,
          accepted: false,
          code: 'VERSION_CONFLICT',
          conflict_id: receipt.conflict_id!,
          trace_id: trace,
        });
    };
    for (const raw of original) {
      const reject = (
        code: 'VALIDATION_ERROR' | 'EVENT_ID_REUSED' | 'CURSOR_GAP' | 'SOURCE_UNAVAILABLE',
      ) =>
        result.rejected.push({
          event_id: raw.event_id,
          accepted: false,
          code,
          trace_id: trace,
          ...(code === 'CURSOR_GAP' ? { expected_cursor: last + 1 } : {}),
        });
      const event = parseSyncUploadEvent(raw as unknown as Record<string, unknown>)!;
      const rawRow = raw as unknown as Record<string, unknown>;
      if (
        Object.entries(identity).some(
          ([name, value]) => Object.hasOwn(rawRow, name) && rawRow[name] !== value,
        )
      ) {
        reject('VALIDATION_ERROR');
        continue;
      }
      const eventKey = JSON.stringify([senderKey, event.event_id]);
      const normalized = canonical(event);
      const existing = this.#deliveries.get(eventKey);
      if (existing) {
        if (existing.fingerprint !== normalized) reject('EVENT_ID_REUSED');
        else deliver(existing.receipt);
        continue;
      }
      if (event.client_cursor !== undefined && last >= Number.MAX_SAFE_INTEGER)
        fail('RATE_LIMITED', trace);
      if (event.client_cursor !== undefined && event.client_cursor !== last + 1) {
        reject('CURSOR_GAP');
        continue;
      }
      const change =
        event.event_type === 'FieldChangeProposed' ? fieldChange(event.payload) : undefined;
      if (event.event_type === 'FieldChangeProposed' && !change) {
        reject('VALIDATION_ERROR');
        continue;
      }
      const source = change ? this.#sources.get(sourceKey(change)) : undefined;
      if (
        change &&
        (!source ||
          !this.sourceVisible(sourceKey(change), access) ||
          !Object.hasOwn(source.fields, change.field))
      ) {
        reject('SOURCE_UNAVAILABLE');
        continue;
      }
      if (change && source && change.base_version > source.version) {
        reject('VALIDATION_ERROR');
        continue;
      }
      if (
        result.next_cursor >= Number.MAX_SAFE_INTEGER ||
        this.#deliveries.size + additions.length >= 10_000
      )
        fail('RATE_LIMITED', trace);
      const conflict =
        change &&
        source &&
        change.base_version !== source.version &&
        canonical(change.value) !== canonical(source.fields[change.field])
          ? createUlid()
          : undefined;
      const serverId = createUlid();
      const recordedAt = new Date().toISOString();
      const sensitivity =
        syncClassifications[
          Math.max(
            syncClassifications.indexOf(event.sensitivity!),
            syncClassifications.indexOf(source?.classification ?? 'public'),
          )
        ]!;
      const receipt: SyncRecordedEventReceipt = {
        event_id: event.event_id,
        accepted: !conflict,
        server_event_id: serverId,
        server_cursor: ++result.next_cursor,
        ...(conflict ? { conflict_id: conflict } : {}),
        original_trace_id: trace,
        recorded_at: recordedAt,
        source_application: 'not-checked',
      };
      const refs = [
        ...event.source_refs,
        { type: 'client-event', id: event.event_id },
        ...(change ? [{ type: change.entity_type, id: change.entity_id }] : []),
      ];
      changes.push({
        schema_version: 1,
        event_id: serverId,
        event_type: conflict ? 'ConflictDetected' : 'ClientEventRecorded',
        tenant_id: identity.tenant_id,
        workspace_id: identity.workspace_id,
        project_id: identity.project_id,
        aggregate_type: conflict ? 'Conflict' : 'ClientEvent',
        aggregate_id: conflict ?? serverId,
        aggregate_version: 1,
        client_id: identity.client_id,
        ...(isUlid(identity.actor_id) ? { actor_id: identity.actor_id } : {}),
        trace_id: trace,
        occurred_at: recordedAt,
        sensitivity,
        source_refs: refs,
        accepted: true,
        server_cursor: receipt.server_cursor,
        payload: {
          ...(conflict && change && source
            ? {
                conflict_id: conflict,
                entity_type: change.entity_type,
                entity_id: change.entity_id,
                field: change.field,
                base_version: change.base_version,
                local_version: change.base_version + 1,
                server_version: source.version,
              }
            : {
                event_type: event.event_type,
                content: event.payload,
                ...(source ? { observed_version: source.version } : {}),
              }),
          client_event_id: event.event_id,
          actor_id: identity.actor_id,
        },
      });
      additions.push({
        key: eventKey,
        delivery: {
          sender: senderKey,
          fingerprint: normalized,
          source: change ? sourceKey(change) : null,
          sensitivity,
          receipt,
        },
      });
      if (event.client_cursor !== undefined) last = event.client_cursor;
      deliver(receipt);
    }
    const response = checked('SYNC_UPLOAD_INVALID', trace, () => envelope(result));
    const retainedBytes = new TextEncoder().encode(
      JSON.stringify({
        batch_key: batchKey,
        fingerprint,
        result,
        additions,
        sequence: { sender: senderKey, cursor: last },
      }),
    ).byteLength;
    if (this.#retainedBytes + retainedBytes > MAX_RETAINED_BYTES) fail('RATE_LIMITED', trace);
    return {
      response,
      changes,
      commit: () => {
        this.#batches.set(batchKey, { fingerprint, result });
        for (const entry of additions) {
          this.#deliveries.set(entry.key, entry.delivery);
          this.#serverDeliveries.set(entry.delivery.receipt.server_event_id, entry.delivery);
        }
        this.#sequences.set(senderKey, last);
        this.#retainedBytes += retainedBytes;
      },
    };
  }

  receipt(
    body: unknown,
    identity: SyncCommandIdentity,
    access: MockSyncUploadAccess,
    trace: string,
  ) {
    const query = checked('INVALID_INPUT', trace, () => parseSyncEventReceiptQuery(body));
    checked('DENIED', trace, () => assertSyncCommandIdentity(query.identity, identity));
    const delivery = this.#deliveries.get(JSON.stringify([sender(identity), query.event.event_id]));
    if (delivery && !this.readable(delivery, access)) fail('NOT_FOUND', trace);
    if (
      delivery &&
      delivery.fingerprint !==
        canonical(parseSyncUploadEvent(query.event as unknown as Record<string, unknown>)!)
    )
      fail('EVENT_ID_REUSED', trace);
    return checked('SYNC_EVENT_RECEIPT_INVALID', trace, () =>
      parseSyncEventReceiptEnvelope(
        {
          schema_version: 1,
          trace_id: trace,
          source_refs: delivery
            ? [{ type: 'sync-event', id: delivery.receipt.server_event_id }]
            : [],
          data: {
            ...query,
            ...(delivery
              ? { status: 'recorded', receipt: delivery.receipt }
              : { status: 'not-observed' }),
          },
        },
        query,
        trace,
      ),
    );
  }
}
