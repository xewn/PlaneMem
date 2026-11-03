import {
  ContractError,
  createUlid,
  isUlid,
  conflictReceiptJson,
  CONFLICT_RECEIPT_RESPONSE_BYTES,
  type Classification,
} from '@planemem/contracts';
import { validateEvent, type CanonicalEvent } from '@planemem/events';
import { appendSyncEvent, highWater, lockSyncStream } from './sync-stream.js';
import {
  resolveConflictRecord,
  type ConflictRecord,
  type ResolveConflictInput,
} from '@planemem/sync-service';
import type { RuntimeSql } from './runtime-persistence.js';
import { conflictClassification, visibleConflicts } from './workbench/repository.js';

type Decision = ResolveConflictInput<string> & {
  client_id: string;
  read_restricted: boolean;
  receipt: { key: string; fingerprint: string };
};

type StoredConflict = Pick<
  ConflictRecord,
  | 'entity_type'
  | 'entity_id'
  | 'field'
  | 'local_value'
  | 'server_value'
  | 'status'
  | 'trace_id'
  | 'source_refs'
> & {
  base_version: number | string;
  local_version: number | string;
  server_version: number | string;
  version: number | string;
  resolution_request_key: string | null;
  resolution_fingerprint: string | null;
  resolution_event_id: string | null;
  resolution: string | null;
  resolved_by_client: string | null;
  actor_id: string | null;
  resolved_value: unknown;
  resolved_at_iso: string | null;
  sensitivity: Classification;
};

export async function persistConflictDecision(db: RuntimeSql, input: Decision) {
  if (
    !Number.isSafeInteger(input.expected_version) ||
    input.expected_version < 1 ||
    !Number.isSafeInteger(input.expected_version + 1)
  )
    throw new ContractError(
      'INVALID_INPUT',
      'Decision version must be a positive safely incrementable integer',
      {
        trace_id: input.trace_id,
      },
    );
  try {
    return await db.begin(async (tx) => {
      const [project] = await tx<{ id: string }[]>`SELECT id FROM wcp_projects
        WHERE id = ${input.project_id} AND tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id}
          AND deleted_at IS NULL AND classification IN ('public', 'internal', 'confidential', 'restricted')
          AND (${input.read_restricted === true} OR classification <> 'restricted') FOR SHARE`;
      if (!project)
        throw new ContractError('CONFLICT_NOT_FOUND', 'Conflict is unavailable in this project', {
          trace_id: input.trace_id,
        });
      const [row] = await tx<StoredConflict[]>`
        SELECT c.*, ${tx.unsafe(conflictClassification)} AS sensitivity,
          to_char(c.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS resolved_at_iso
        FROM wcp_conflicts c
        WHERE c.conflict_id = ${input.conflict_id} AND c.tenant_id = ${input.tenant_id}
          AND c.workspace_id = ${input.workspace_id} AND c.project_id = ${input.project_id}
          ${tx.unsafe(visibleConflicts(input))}
        FOR UPDATE OF c
      `;
      if (!row)
        throw new ContractError('CONFLICT_NOT_FOUND', 'Conflict is unavailable in this project', {
          trace_id: input.trace_id,
        });
      if (row.status === 'resolved') {
        if (input.receipt.key !== row.resolution_request_key)
          throw new ContractError(
            'CONFLICT_ALREADY_RESOLVED',
            'This conflict already has a decision. Refresh to review it.',
            { trace_id: input.trace_id },
          );
        if (input.receipt.fingerprint !== row.resolution_fingerprint)
          throw new ContractError(
            'IDEMPOTENCY_KEY_REUSED',
            'This request key belongs to a different decision',
            { trace_id: input.trace_id },
          );
        const [previous] = await tx<
          { payload: CanonicalEvent; server_cursor: string | number; trace_id: string }[]
        >`
          SELECT payload, server_cursor, trace_id FROM wcp_sync_events WHERE event_id = ${row.resolution_event_id}
            AND tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id}
            AND event_type = 'ConflictResolved'
        `;
        if (!previous) throw new Error('Resolution event is missing');
        const event = previous.payload;
        if (
          !event ||
          !['public', 'internal', 'confidential', 'restricted'].includes(event.sensitivity) ||
          (event.sensitivity === 'restricted' && !input.read_restricted)
        )
          throw new ContractError('CONFLICT_NOT_FOUND', 'Conflict is unavailable in this project', {
            trace_id: input.trace_id,
          });
        conflictReceiptJson(event, CONFLICT_RECEIPT_RESPONSE_BYTES);
        if (
          !validateEvent(event).valid ||
          event.event_type !== 'ConflictResolved' ||
          event.event_id !== row.resolution_event_id ||
          event.tenant_id !== input.tenant_id ||
          event.workspace_id !== input.workspace_id ||
          event.project_id !== input.project_id ||
          event.aggregate_type !== 'Conflict' ||
          event.aggregate_id !== (isUlid(input.conflict_id) ? input.conflict_id : event.event_id) ||
          event.aggregate_version !== safeVersion(row.version, true) ||
          event.aggregate_version !== input.expected_version + 1 ||
          event.client_id !== input.client_id ||
          row.resolved_by_client !== input.client_id ||
          row.actor_id !== input.actor_id ||
          event.payload.actor_id !== input.actor_id ||
          event.actor_id !== (isUlid(input.actor_id) ? input.actor_id : undefined) ||
          event.payload.conflict_id !== input.conflict_id ||
          event.payload.entity_type !== row.entity_type ||
          event.payload.entity_id !== row.entity_id ||
          event.payload.field !== row.field ||
          event.payload.resolution !== input.resolution ||
          row.resolution !== input.resolution ||
          event.trace_id !== row.trace_id ||
          previous.trace_id !== row.trace_id ||
          event.occurred_at !== row.resolved_at_iso ||
          event.payload.base_version !== safeVersion(row.base_version) ||
          event.payload.local_version !== safeVersion(row.local_version) ||
          event.payload.server_version !== safeVersion(row.server_version) ||
          !event.source_refs.some(
            (ref) => ref.type === 'conflict' && ref.id === input.conflict_id,
          ) ||
          conflictReceiptJson(event.source_refs, CONFLICT_RECEIPT_RESPONSE_BYTES) !==
            conflictReceiptJson(
              [{ type: 'conflict', id: input.conflict_id }, ...row.source_refs],
              CONFLICT_RECEIPT_RESPONSE_BYTES,
            ) ||
          conflictReceiptJson(event.payload.resolved_value, CONFLICT_RECEIPT_RESPONSE_BYTES) !==
            conflictReceiptJson(row.resolved_value, CONFLICT_RECEIPT_RESPONSE_BYTES) ||
          conflictReceiptJson(row.resolved_value, CONFLICT_RECEIPT_RESPONSE_BYTES) !==
            conflictReceiptJson(
              input.resolution === 'merge'
                ? input.merged_value
                : input.resolution === 'local'
                  ? row.local_value
                  : row.server_value,
              CONFLICT_RECEIPT_RESPONSE_BYTES,
            )
        )
          throw new Error('Resolution event does not match its saved decision');
        return { event, server_cursor: safeVersion(previous.server_cursor, true) };
      }
      const resolved = resolveConflictRecord(
        {
          schema_version: 1,
          tenant_id: input.tenant_id,
          workspace_id: input.workspace_id,
          project_id: input.project_id,
          conflict_id: input.conflict_id,
          entity_id: row.entity_id,
          entity_type: row.entity_type,
          field: row.field,
          base_version: safeVersion(row.base_version),
          local_version: safeVersion(row.local_version),
          server_version: safeVersion(row.server_version),
          version: safeVersion(row.version, true),
          local_value: row.local_value,
          server_value: row.server_value,
          status: row.status,
          trace_id: row.trace_id,
          source_refs: row.source_refs,
        },
        input,
      );
      const eventId = createUlid();
      const event: CanonicalEvent = {
        schema_version: 1,
        event_id: eventId,
        event_type: 'ConflictResolved',
        tenant_id: input.tenant_id,
        workspace_id: input.workspace_id,
        project_id: input.project_id,
        aggregate_type: 'Conflict',
        // Older conflict IDs are external strings. Preserve them in the payload and source references.
        aggregate_id: isUlid(input.conflict_id) ? input.conflict_id : eventId,
        aggregate_version: resolved.version,
        ...(isUlid(input.actor_id) ? { actor_id: input.actor_id } : {}),
        client_id: input.client_id,
        occurred_at: new Date().toISOString(),
        sensitivity: row.sensitivity,
        trace_id: input.trace_id,
        source_refs: [{ type: 'conflict', id: input.conflict_id }, ...resolved.source_refs],
        payload: {
          conflict_id: input.conflict_id,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
          field: row.field,
          base_version: resolved.base_version,
          local_version: resolved.local_version,
          server_version: resolved.server_version,
          resolution: resolved.resolution,
          resolved_value: resolved.resolved_value,
          actor_id: input.actor_id,
        },
      };
      await lockSyncStream(tx, input);
      const cursor = (await highWater(tx, input)) + 1;
      await appendSyncEvent(tx, event, cursor);
      await tx`
        UPDATE wcp_conflicts SET status = 'resolved', resolution = ${input.resolution},
          resolved_value = ${JSON.stringify(resolved.resolved_value)}::jsonb, version = ${resolved.version},
          actor_id = ${input.actor_id}, resolved_by_client = ${input.client_id}, resolved_at = ${event.occurred_at},
          trace_id = ${input.trace_id}, resolution_event_id = ${eventId},
          resolution_request_key = ${input.receipt.key}, resolution_fingerprint = ${input.receipt.fingerprint}
        WHERE conflict_id = ${input.conflict_id}
      `;
      return { event, server_cursor: cursor };
    });
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError(
      'CONFLICT_STORAGE_UNAVAILABLE',
      'Conflict decision could not be confirmed. Retry with the same request key.',
      { trace_id: input.trace_id, retryable: true },
    );
  }
}

function safeVersion(value: string | number, positive = false): number {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < (positive ? 1 : 0)
  )
    throw new TypeError('Stored conflict version or cursor exceeds the supported range');
  return Number(value);
}
