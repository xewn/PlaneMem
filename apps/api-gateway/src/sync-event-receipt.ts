import { isDeepStrictEqual } from 'node:util';
import {
  ContractError,
  parseSyncEventReceiptQuery,
  parseSyncEventReceiptEnvelope,
  assertSyncCommandIdentity,
  parseSyncUploadEvent,
  syncJsonSnapshot,
  SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
  syncClassifications,
  isUlid,
  type SyncEventReceiptQuery,
  type SyncEventReceiptView,
} from '@planemem/contracts';
import { validateEvent } from '@planemem/events';
import type { CommandRouter, RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { fingerprint } from './idempotency.js';
import { canReadSyncCommandContext } from './sync-command-context.js';
import { parseSyncFieldChange } from './sync-upload.js';
import { sourceClassification, visibleConflicts } from './workbench/repository.js';

const unavailable = (trace: string) =>
  new ContractError('SYNC_STORAGE_UNAVAILABLE', 'Original sync receipt storage is unavailable', {
    trace_id: trace,
  });
const invalid = (trace: string) =>
  new ContractError(
    'SYNC_EVENT_RECEIPT_INVALID',
    'Stored delivery cannot confirm the complete original event',
    { trace_id: trace },
  );
const hidden = (trace: string) =>
  new ContractError(
    'NOT_FOUND',
    'The original project or delivery is unavailable in the current readable scope',
    { trace_id: trace },
  );

function recorded(
  value: unknown,
  query: SyncEventReceiptQuery,
  context: RequestContext,
): SyncEventReceiptView {
  if (
    typeof value === 'string' &&
    new TextEncoder().encode(value).byteLength > SYNC_EVENT_RECEIPT_RESPONSE_BYTES
  )
    throw invalid(context.trace_id);
  const metadata = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  syncJsonSnapshot(metadata, SYNC_EVENT_RECEIPT_RESPONSE_BYTES);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    throw invalid(context.trace_id);
  const row = metadata as Record<string, unknown>;
  const keys = [
    'fingerprint',
    'server_event_id',
    'server_cursor',
    'client_cursor',
    'conflict_id',
    'entity_type',
    'entity_id',
    'event_type',
    'event_trace',
    'event',
    'refs_match',
    'source_visible',
    'history_visible',
    'conflict_visible',
    'conflict_matches',
  ];
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key)) ||
    [
      'refs_match',
      'source_visible',
      'history_visible',
      'conflict_visible',
      'conflict_matches',
    ].some((key) => typeof row[key] !== 'boolean')
  )
    throw invalid(context.trace_id);
  if (!row.event) throw invalid(context.trace_id);
  if (!row.source_visible || !row.history_visible || !row.conflict_visible)
    throw hidden(context.trace_id);
  const original = parseSyncUploadEvent(query.event as unknown as Record<string, unknown>)!;
  if (typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint))
    throw invalid(context.trace_id);
  if (row.fingerprint !== fingerprint(original))
    throw new ContractError(
      'EVENT_ID_REUSED',
      'This original event ID is bound to different content; preserve the original event',
      { trace_id: context.trace_id },
    );
  const parsed = validateEvent(row.event);
  if (!parsed.valid) throw invalid(context.trace_id);
  const event = parsed.event;
  const conflict = row.conflict_id !== null;
  const change =
    original.event_type === 'FieldChangeProposed'
      ? parseSyncFieldChange(original.payload)
      : undefined;
  if (original.event_type === 'FieldChangeProposed' && !change) throw invalid(context.trace_id);
  const expectedRefs = [
    ...original.source_refs,
    { type: 'client-event', id: original.event_id },
    ...(change ? [{ type: change.entity_type, id: change.entity_id }] : []),
  ];
  if (
    event.schema_version !== 1 ||
    event.event_id !== row.server_event_id ||
    event.event_type !== row.event_type ||
    event.trace_id !== row.event_trace ||
    event.event_type !== (conflict ? 'ConflictDetected' : 'ClientEventRecorded') ||
    event.aggregate_type !== (conflict ? 'Conflict' : 'ClientEvent') ||
    event.aggregate_id !== (conflict ? row.conflict_id : row.server_event_id) ||
    event.aggregate_version !== 1 ||
    event.tenant_id !== query.identity.tenant_id ||
    event.workspace_id !== query.identity.workspace_id ||
    event.project_id !== query.identity.project_id ||
    event.client_id !== query.identity.client_id ||
    event.actor_id !== (isUlid(query.identity.actor_id) ? query.identity.actor_id : undefined) ||
    event.payload.actor_id !== query.identity.actor_id ||
    event.payload.client_event_id !== original.event_id ||
    row.client_cursor !==
      (original.client_cursor === undefined ? null : String(original.client_cursor)) ||
    row.entity_type !== (change?.entity_type ?? null) ||
    row.entity_id !== (change?.entity_id ?? null) ||
    !row.refs_match ||
    !isDeepStrictEqual(event.source_refs, expectedRefs) ||
    syncClassifications.indexOf(event.sensitivity) <
      syncClassifications.indexOf(original.sensitivity!)
  )
    throw invalid(context.trace_id);
  const payload = event.payload;
  if (conflict) {
    if (
      !change ||
      !row.conflict_matches ||
      Object.keys(payload).length !== 9 ||
      payload.conflict_id !== row.conflict_id ||
      payload.entity_type !== change.entity_type ||
      payload.entity_id !== change.entity_id ||
      payload.field !== change.field ||
      payload.base_version !== change.base_version ||
      payload.local_version !== change.base_version + 1 ||
      typeof payload.server_version !== 'number' ||
      !Number.isSafeInteger(payload.server_version) ||
      payload.server_version <= change.base_version
    )
      throw invalid(context.trace_id);
  } else if (
    Object.keys(payload).length !== (change ? 5 : 4) ||
    payload.event_type !== original.event_type ||
    !isDeepStrictEqual(payload.content, original.payload) ||
    (change &&
      (typeof payload.observed_version !== 'number' ||
        !Number.isSafeInteger(payload.observed_version) ||
        payload.observed_version < change.base_version)) ||
    (!change && Object.hasOwn(payload, 'observed_version'))
  )
    throw invalid(context.trace_id);
  if (
    typeof row.server_cursor !== 'string' ||
    !/^[1-9][0-9]{0,15}$/.test(row.server_cursor) ||
    !Number.isSafeInteger(Number(row.server_cursor))
  )
    throw invalid(context.trace_id);
  return {
    ...query,
    status: 'recorded',
    receipt: {
      event_id: original.event_id,
      accepted: !conflict,
      server_event_id: event.event_id,
      server_cursor: Number(row.server_cursor),
      ...(conflict ? { conflict_id: String(row.conflict_id) } : {}),
      original_trace_id: event.trace_id,
      recorded_at: event.occurred_at,
      source_application: 'not-checked',
    },
  };
}

async function readReceipt(
  db: RuntimeSql,
  query: SyncEventReceiptQuery,
  context: RequestContext,
): Promise<SyncEventReceiptView> {
  return db.begin('isolation level repeatable read read only', async (tx) => {
    const restricted = context.capability.includes('data.restricted.read');
    const [project] = await tx`
      SELECT 1 FROM wcp_projects p WHERE p.id = ${context.project_id} AND p.tenant_id = ${context.tenant_id}
        AND p.workspace_id = ${context.workspace_id} AND p.deleted_at IS NULL
        AND p.classification IN ('public', 'internal', 'confidential', 'restricted')
        AND (p.classification <> 'restricted' OR ${restricted})`;
    if (!project) throw hidden(context.trace_id);
    const [row] = await tx<Record<string, unknown>[]>`
      WITH saved AS MATERIALIZED (
        SELECT jsonb_build_object(
          'fingerprint', u.fingerprint, 'server_event_id', u.server_event_id, 'server_cursor', e.server_cursor::text,
          'client_cursor', u.client_cursor::text, 'conflict_id', u.conflict_id, 'entity_type', u.entity_type, 'entity_id', u.entity_id,
          'event_type', e.event_type, 'event_trace', e.trace_id, 'event', e.payload,
          'refs_match', (e.source_refs = e.payload->'source_refs') IS TRUE,
          'source_visible', ((u.entity_type IS NULL AND u.entity_id IS NULL) OR
            (u.entity_type IN ('work_item', 'context_item', 'session') AND
             (${tx.unsafe(sourceClassification('u'))}) IN ('public', 'internal', 'confidential', 'restricted') AND
             ((${tx.unsafe(sourceClassification('u'))}) <> 'restricted' OR ${restricted}))) IS TRUE,
          'history_visible', (e.payload->>'sensitivity' IN ('public', 'internal', 'confidential', 'restricted') AND
            (e.payload->>'sensitivity' <> 'restricted' OR ${restricted})) IS TRUE,
          'conflict_visible', (u.conflict_id IS NULL OR EXISTS (
            SELECT 1 FROM wcp_conflicts c WHERE c.conflict_id = u.conflict_id AND c.tenant_id = u.tenant_id
              AND c.workspace_id = u.workspace_id AND c.project_id = u.project_id
              AND c.sensitivity IN ('public', 'internal', 'confidential', 'restricted')
              ${tx.unsafe(visibleConflicts({ ...context, read_restricted: restricted }))})),
          'conflict_matches', (u.conflict_id IS NULL OR EXISTS (
            SELECT 1 FROM wcp_conflicts c WHERE c.conflict_id = u.conflict_id AND c.tenant_id = u.tenant_id
              AND c.workspace_id = u.workspace_id AND c.project_id = u.project_id
              AND c.entity_type = u.entity_type AND c.entity_id = u.entity_id
              AND c.field = e.payload->'payload'->>'field'
              AND to_jsonb(c.base_version) = e.payload->'payload'->'base_version'
              AND to_jsonb(c.local_version) = e.payload->'payload'->'local_version'
              AND to_jsonb(c.server_version) = e.payload->'payload'->'server_version'
              AND c.local_value = ${JSON.stringify(query.event.payload.value ?? null)}::jsonb))
        ) AS metadata
        FROM wcp_sync_uploads u LEFT JOIN wcp_sync_events e ON e.event_id = u.server_event_id
          AND e.tenant_id = u.tenant_id AND e.workspace_id = u.workspace_id AND e.project_id = u.project_id
        WHERE u.tenant_id = ${context.tenant_id} AND u.workspace_id = ${context.workspace_id} AND u.project_id = ${context.project_id}
          AND u.actor_id = ${context.actor_id} AND u.client_id = ${context.client_id} AND u.client_event_id = ${query.event.event_id}
      ) SELECT CASE WHEN octet_length(metadata::text) <= ${SYNC_EVENT_RECEIPT_RESPONSE_BYTES} THEN metadata ELSE NULL END AS metadata FROM saved`;
    if (!row) return { ...query, status: 'not-observed' };
    try {
      return recorded(row.metadata, query, context);
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw invalid(context.trace_id);
    }
  });
}

export function registerSyncEventReceipt(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('sync.event.receipt', async (request) => {
    const context = structuredClone(request.context);
    if (!canReadSyncCommandContext(context))
      throw new ContractError('DENIED', 'A verified unexpired original sync writer is required', {
        trace_id: context.trace_id,
      });
    let query;
    try {
      if (context.idempotency_key !== undefined || context.expected_version !== undefined)
        throw new TypeError();
      query = parseSyncEventReceiptQuery(request.input);
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Supply the complete original identity and event without a batch key or write conditions',
        { trace_id: context.trace_id },
      );
    }
    try {
      assertSyncCommandIdentity(query.identity, context);
    } catch {
      throw new ContractError(
        'DENIED',
        'Use the original verified account, client and project for this receipt',
        { trace_id: context.trace_id },
      );
    }
    if (!db) throw unavailable(context.trace_id);
    let data;
    try {
      data = await readReceipt(db, query, context);
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw unavailable(context.trace_id);
    }
    if (!canReadSyncCommandContext(context))
      throw new ContractError(
        'DENIED',
        'The original verified sync writer expired while reading its receipt',
        { trace_id: context.trace_id },
      );
    try {
      return parseSyncEventReceiptEnvelope(
        {
          schema_version: 1,
          trace_id: context.trace_id,
          source_refs:
            data.status === 'recorded'
              ? [{ type: 'sync-event', id: data.receipt.server_event_id }]
              : [],
          data,
        },
        query,
        context.trace_id,
      );
    } catch {
      throw invalid(context.trace_id);
    }
  });
}
