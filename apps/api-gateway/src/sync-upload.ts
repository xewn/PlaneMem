import { isDeepStrictEqual } from 'node:util';
import {
  isSyncIdentifier,
  ContractError,
  createUlid,
  isUlid,
  parseSyncUploadEvent,
  syncClassifications as levels,
  type Classification,
  type ProposedFieldChange,
  type RejectedUpload,
  type SyncUploadEvent,
  type SyncUploadResult,
  type Ulid,
} from '@planemem/contracts';
import type { CanonicalEvent } from '@planemem/events';
import type { RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { fingerprint } from './idempotency.js';
import { appendSyncEvent, highWater, lockSyncStream } from './sync-stream.js';

const sources = {
  work_item: {
    table: 'wcp_work_items',
    fields: ['title', 'status', 'priority', 'owner', 'progress', 'description', 'due_at'],
  },
  context_item: {
    table: 'wcp_context_items',
    fields: ['title', 'status', 'priority', 'content', 'layer', 'expires_at'],
  },
  session: { table: 'wcp_sessions', fields: ['status', 'parent_session_id'] },
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEvent(raw: unknown, context: RequestContext): SyncUploadEvent | undefined {
  if (!object(raw)) return;
  for (const key of ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id'] as const)
    if (raw[key] !== undefined && raw[key] !== context[key]) return;
  return parseSyncUploadEvent(raw);
}

export function parseSyncFieldChange(
  payload: Record<string, unknown>,
): ProposedFieldChange | undefined {
  if (
    typeof payload.entity_type !== 'string' ||
    !Object.hasOwn(sources, payload.entity_type) ||
    !isSyncIdentifier(payload.entity_id) ||
    typeof payload.field !== 'string' ||
    !Object.hasOwn(payload, 'value') ||
    typeof payload.base_version !== 'number' ||
    !Number.isSafeInteger(payload.base_version) ||
    payload.base_version < 1 ||
    payload.base_version >= Number.MAX_SAFE_INTEGER
  )
    return;
  const entity_type = payload.entity_type as keyof typeof sources;
  if (!sources[entity_type].fields.includes(payload.field)) return;
  return {
    entity_type,
    entity_id: payload.entity_id,
    field: payload.field,
    value: payload.value,
    base_version: payload.base_version,
  };
}

async function lookupField(tx: RuntimeSql, change: ProposedFieldChange, context: RequestContext) {
  const session = change.entity_type === 'session';
  const [row] = await tx<FieldSnapshot[]>`
    SELECT version, to_jsonb(${tx(change.field)}) AS value, ${session ? tx`'internal'::text` : tx`classification`} AS classification
      FROM ${tx(sources[change.entity_type].table)}
     WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id} AND project_id = ${context.project_id}
       AND ${tx(session ? 'session_id' : 'id')} = ${change.entity_id}
       ${session ? tx`` : tx`AND deleted_at IS NULL AND (classification <> 'restricted' OR ${context.capability.includes('data.restricted.read')})`}
     FOR SHARE
  `;
  return row;
}

type Delivery = {
  server_event_id: string;
  server_cursor: number | string;
  conflict_id: string | null;
};

function addDelivery(
  result: SyncUploadResult,
  event_id: string,
  delivery: Delivery,
  trace_id: string,
) {
  const fields = {
    event_id,
    server_event_id: delivery.server_event_id,
    server_cursor: Number(delivery.server_cursor),
  };
  if (delivery.conflict_id)
    result.rejected.push({
      ...fields,
      accepted: false,
      code: 'VERSION_CONFLICT',
      conflict_id: delivery.conflict_id,
      trace_id,
    });
  else result.accepted.push({ ...fields, accepted: true });
}

type FieldSnapshot = { version: number | string; value: unknown; classification: Classification };

async function recordUpload(
  tx: RuntimeSql,
  context: RequestContext,
  event: SyncUploadEvent,
  hash: string,
  cursor: number,
  change?: ProposedFieldChange,
  source?: FieldSnapshot,
): Promise<Delivery> {
  const eventId = event.event_id;
  const conflict =
    change &&
    source &&
    change.base_version !== Number(source.version) &&
    !isDeepStrictEqual(change.value, source.value)
      ? { id: createUlid(), change, source }
      : undefined;
  const serverId = createUlid();
  const sensitivity =
    levels[
      Math.max(
        levels.indexOf(event.sensitivity!),
        levels.indexOf(source?.classification ?? 'public'),
      )
    ]!;
  const refs = [...event.source_refs, { type: 'client-event', id: eventId }];
  if (change) refs.push({ type: change.entity_type, id: change.entity_id });
  const payload = conflict
    ? {
        conflict_id: conflict.id,
        entity_type: conflict.change.entity_type,
        entity_id: conflict.change.entity_id,
        field: conflict.change.field,
        base_version: conflict.change.base_version,
        local_version: conflict.change.base_version + 1,
        server_version: Number(conflict.source.version),
      }
    : {
        event_type: event.event_type,
        content: event.payload,
        ...(source ? { observed_version: Number(source.version) } : {}),
      };
  const canonical: CanonicalEvent = {
    schema_version: 1,
    event_id: serverId,
    event_type: conflict ? 'ConflictDetected' : 'ClientEventRecorded',
    tenant_id: context.tenant_id as Ulid,
    workspace_id: context.workspace_id as Ulid,
    project_id: context.project_id as Ulid,
    aggregate_type: conflict ? 'Conflict' : 'ClientEvent',
    aggregate_id: conflict?.id ?? serverId,
    aggregate_version: 1,
    client_id: context.client_id,
    ...(isUlid(context.actor_id) ? { actor_id: context.actor_id } : {}),
    trace_id: context.trace_id,
    occurred_at: new Date().toISOString(),
    sensitivity,
    source_refs: refs,
    payload: { ...payload, client_event_id: eventId, actor_id: context.actor_id },
  };
  await appendSyncEvent(tx, canonical, cursor);
  if (conflict) {
    const { change, source, id } = conflict;
    await tx`INSERT INTO wcp_conflicts (conflict_id, tenant_id, workspace_id, project_id, entity_type, entity_id, field, base_version,
      local_version, server_version, local_value, server_value, status, actor_id, version, trace_id, source_refs, sensitivity)
      VALUES (${id}, ${context.tenant_id}, ${context.workspace_id}, ${context.project_id}, ${change.entity_type}, ${change.entity_id},
        ${change.field}, ${change.base_version}, ${change.base_version + 1}, ${Number(source.version)}, ${JSON.stringify(change.value)}::jsonb,
        ${JSON.stringify(source.value)}::jsonb, 'open', ${context.actor_id}, 1, ${context.trace_id}, ${JSON.stringify(refs)}::jsonb, ${sensitivity})`;
  }
  await tx`INSERT INTO wcp_sync_uploads (tenant_id, workspace_id, project_id, actor_id, client_id, client_event_id, fingerprint,
    client_cursor, server_event_id, conflict_id, entity_type, entity_id)
    VALUES (${context.tenant_id}, ${context.workspace_id}, ${context.project_id}, ${context.actor_id}, ${context.client_id}, ${eventId},
      ${hash}, ${event.client_cursor ?? null}, ${serverId}, ${conflict?.id ?? null}, ${change?.entity_type ?? null}, ${change?.entity_id ?? null})`;
  return { server_event_id: serverId, server_cursor: cursor, conflict_id: conflict?.id ?? null };
}

export async function appendUploadBatch(
  db: RuntimeSql,
  context: RequestContext,
  events: unknown[],
  receipt: { key: string; fingerprint: string },
) {
  return db.begin(async (tx) => {
    await lockSyncStream(tx, context);
    const scope = tx`tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id} AND project_id = ${context.project_id}`;
    const sender = tx`actor_id = ${context.actor_id} AND client_id = ${context.client_id}`;
    const [prior] = await tx<{ fingerprint: string; result: SyncUploadResult }[]>`
      SELECT fingerprint, result FROM wcp_sync_batch_receipts WHERE ${scope} AND request_key = ${receipt.key}`;
    if (prior) {
      if (prior.fingerprint !== receipt.fingerprint)
        throw new ContractError('IDEMPOTENCY_KEY_REUSED', 'Batch key belongs to another upload', {
          trace_id: context.trace_id,
        });
      return prior.result;
    }
    const [sequence] = await tx<
      { last: string | number }[]
    >`SELECT COALESCE(MAX(client_cursor), 0) AS last FROM wcp_sync_uploads WHERE ${scope} AND ${sender}`;
    let last = Number(sequence!.last);
    const result: SyncUploadResult = {
      accepted: [],
      rejected: [],
      next_cursor: await highWater(tx, context),
    };
    for (const raw of events) {
      const event = parseEvent(raw, context);
      const eventId = object(raw) && isSyncIdentifier(raw.event_id) ? raw.event_id : '';
      const reject = (code: RejectedUpload['code']) =>
        result.rejected.push({
          event_id: eventId,
          accepted: false,
          code,
          trace_id: context.trace_id,
          ...(code === 'CURSOR_GAP' ? { expected_cursor: last + 1 } : {}),
        });
      if (!event) {
        reject('VALIDATION_ERROR');
        continue;
      }
      const hash = fingerprint(event);
      const [existing] = await tx<(Delivery & { fingerprint: string })[]>`
        SELECT u.fingerprint, u.server_event_id, u.conflict_id, e.server_cursor FROM
          (SELECT * FROM wcp_sync_uploads WHERE ${scope} AND ${sender} AND client_event_id = ${eventId}) u
          JOIN wcp_sync_events e ON e.event_id = u.server_event_id`;
      if (existing) {
        if (existing.fingerprint !== hash) reject('EVENT_ID_REUSED');
        else addDelivery(result, eventId, existing, context.trace_id);
        continue;
      }
      if (event.client_cursor !== undefined && event.client_cursor !== last + 1) {
        reject('CURSOR_GAP');
        continue;
      }
      const change =
        event.event_type === 'FieldChangeProposed'
          ? parseSyncFieldChange(event.payload)
          : undefined;
      if (event.event_type === 'FieldChangeProposed' && !change) {
        reject('VALIDATION_ERROR');
        continue;
      }
      const source = change && (await lookupField(tx, change, context));
      if (change && !source) {
        reject('SOURCE_UNAVAILABLE');
        continue;
      }
      if (change && source && change.base_version > Number(source.version)) {
        reject('VALIDATION_ERROR');
        continue;
      }
      const delivery = await recordUpload(
        tx,
        context,
        event,
        hash,
        ++result.next_cursor,
        change,
        source,
      );
      if (event.client_cursor !== undefined) last = event.client_cursor;
      addDelivery(result, eventId, delivery, context.trace_id);
    }
    await tx`INSERT INTO wcp_sync_batch_receipts (tenant_id, workspace_id, project_id, request_key, fingerprint, result)
      VALUES (${context.tenant_id}, ${context.workspace_id}, ${context.project_id}, ${receipt.key}, ${receipt.fingerprint}, ${JSON.stringify(result)}::jsonb)`;
    return result;
  });
}
