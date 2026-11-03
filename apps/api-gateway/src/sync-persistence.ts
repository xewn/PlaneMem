import { ContractError, parseSyncCursorNumber, type SourceRef } from '@planemem/contracts';
import { syncReaderIdentity } from './sync-reader.js';
import { validateEvent } from '@planemem/events';
import type { RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { sourceClassification, visibleConflicts } from './workbench/repository.js';
import { highWater } from './sync-stream.js';
import { proposalVisibility } from './proposals.js';

interface SyncRow {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  trace_id: string;
  source_refs: SourceRef[];
  server_cursor: string | number;
}

export async function withSyncDatabase<T>(
  db: RuntimeSql | undefined,
  trace_id: string,
  operation: (db: RuntimeSql) => Promise<T>,
): Promise<T> {
  try {
    if (db) return await operation(db);
  } catch (error) {
    if (error instanceof ContractError) throw error;
  }
  throw new ContractError('SYNC_STORAGE_UNAVAILABLE', 'Sync storage is unavailable', {
    trace_id,
    retryable: true,
  });
}

function checkCursor(cursor: number, current: number, trace_id: string) {
  if (cursor > current)
    throw new ContractError('CURSOR_GAP', 'Cursor is ahead of the server', {
      requested_cursor: cursor,
      current_cursor: current,
      trace_id,
    });
}

export async function readSyncChanges(
  db: RuntimeSql,
  context: RequestContext,
  after: number | undefined,
  limit: number,
) {
  return db.begin('isolation level repeatable read read only', async (tx) => {
    const current = await highWater(tx, context);
    let cursor = after;
    if (cursor === undefined) {
      const [ack] = await tx<{ server_cursor: string | number }[]>`
        SELECT server_cursor FROM wcp_sync_acknowledgements WHERE tenant_id = ${context.tenant_id}
          AND workspace_id = ${context.workspace_id} AND project_id = ${context.project_id}
          AND actor_id = ${context.actor_id} AND client_id = ${context.client_id}
      `;
      cursor = Number(ack?.server_cursor ?? 0);
    }
    checkCursor(cursor, current, context.trace_id);
    const restricted = context.capability.includes('data.restricted.read');
    const rows = await tx<SyncRow[]>`
      SELECT e.event_id, e.event_type, e.payload, e.trace_id, e.source_refs, e.server_cursor FROM wcp_sync_events e
       WHERE e.tenant_id = ${context.tenant_id} AND e.workspace_id = ${context.workspace_id} AND e.project_id = ${context.project_id}
         AND e.server_cursor > ${cursor} AND CASE
           WHEN e.event_type = 'ConflictResolved' THEN
             (${restricted} OR e.payload->>'sensitivity' IN ('public', 'internal', 'confidential')) AND EXISTS (
               SELECT 1 FROM wcp_conflicts c WHERE c.resolution_event_id = e.event_id AND c.tenant_id = e.tenant_id
                 AND c.workspace_id = e.workspace_id AND c.project_id = e.project_id
                 ${tx.unsafe(visibleConflicts({ ...context, read_restricted: restricted }))})
           WHEN e.event_type IN ('ClientEventRecorded', 'ConflictDetected') THEN
             (${restricted} OR e.payload->>'sensitivity' IN ('public', 'internal', 'confidential')) AND EXISTS (
               SELECT 1 FROM wcp_sync_uploads u WHERE u.server_event_id = e.event_id AND u.tenant_id = e.tenant_id
                 AND u.workspace_id = e.workspace_id AND u.project_id = e.project_id
                 AND (u.entity_type IS NULL OR (${tx.unsafe(sourceClassification('u'))})
                   ${tx.unsafe(restricted ? 'IS NOT NULL' : "<> 'restricted'")}))
           WHEN e.event_type = 'ContextPackIssued' THEN EXISTS (
             SELECT 1 FROM wcp_context_packs p WHERE p.pack_id = e.payload->'payload'->>'pack_id'
               AND p.tenant_id = e.tenant_id AND p.workspace_id = e.workspace_id AND p.project_id = e.project_id
               AND p.pack_document IS NOT NULL AND (${restricted} OR NOT p.read_restricted))
           WHEN e.event_type IN ('ContextItemCreated', 'ContextItemUpdated', 'ContextItemArchived', 'ContextItemRestored', 'ContextItemConfirmed') THEN
             (${restricted} OR e.payload->>'sensitivity' IN ('public', 'internal', 'confidential')) AND EXISTS (
               SELECT 1 FROM wcp_context_items i WHERE i.id = e.payload->'payload'->>'item_id'
                 AND i.tenant_id = e.tenant_id AND i.workspace_id = e.workspace_id AND i.project_id = e.project_id
                 AND (${restricted} OR i.classification <> 'restricted'))
           WHEN e.event_type IN ('ApprovalRequested', 'ApprovalCompleted') AND e.payload->>'aggregate_type' = 'Proposal' THEN
             (${restricted} OR e.payload->>'sensitivity' IN ('public', 'internal', 'confidential')) AND EXISTS (
               SELECT 1 FROM wcp_proposals p WHERE p.proposal_id = e.payload->'payload'->>'proposal_id'
                 AND p.tenant_id = e.tenant_id AND p.workspace_id = e.workspace_id AND p.project_id = e.project_id
                 AND ${tx.unsafe(proposalVisibility(context))})
           WHEN ${restricted} THEN true
           WHEN e.event_type = 'work_item.updated' THEN EXISTS (
             SELECT 1 FROM wcp_work_items w WHERE w.id = e.payload->>'work_item_id' AND w.tenant_id = e.tenant_id
               AND w.workspace_id = e.workspace_id AND w.project_id = e.project_id AND w.deleted_at IS NULL AND w.classification <> 'restricted')
           WHEN e.event_type = 'context.proposed' THEN EXISTS (
             SELECT 1 FROM wcp_context_items i WHERE i.id = e.payload->>'context_id' AND i.tenant_id = e.tenant_id
               AND i.workspace_id = e.workspace_id AND i.project_id = e.project_id AND i.deleted_at IS NULL AND i.classification <> 'restricted')
           WHEN e.event_type = 'handoff.offered' THEN EXISTS (
             SELECT 1 FROM wcp_handoffs h WHERE h.handoff_id = e.payload->>'handoff_id' AND h.tenant_id = e.tenant_id
               AND h.workspace_id = e.workspace_id AND h.project_id = e.project_id)
           ELSE false END
       ORDER BY e.server_cursor LIMIT ${limit + 1}
    `;
    const changes = rows.slice(0, limit).map((row) => {
      const canonical = validateEvent(row.payload);
      if (
        canonical.valid &&
        (canonical.event.tenant_id !== context.tenant_id ||
          canonical.event.workspace_id !== context.workspace_id ||
          canonical.event.project_id !== context.project_id ||
          canonical.event.event_id !== row.event_id ||
          canonical.event.event_type !== row.event_type)
      )
        throw new ContractError(
          'SYNC_EVENT_INVALID',
          'Stored event metadata does not match its stream',
          { trace_id: context.trace_id },
        );
      return {
        ...(canonical.valid ? canonical.event : { payload: row.payload }),
        event_id: row.event_id,
        event_type: row.event_type,
        trace_id: row.trace_id,
        source_refs: row.source_refs,
        accepted: true,
        server_cursor: Number(row.server_cursor),
      };
    });
    const has_more = rows.length > limit;
    const next_cursor = has_more ? changes[changes.length - 1]!.server_cursor : current;
    return { changes, next_cursor, has_more };
  });
}

export async function acknowledgeSyncCursor(
  db: RuntimeSql,
  original: RequestContext,
  cursor: number,
) {
  const context = structuredClone(original);
  syncReaderIdentity(context);
  try {
    parseSyncCursorNumber(cursor);
  } catch {
    throw new ContractError('INVALID_INPUT', 'Supply a safe acknowledgement cursor', {
      trace_id: context.trace_id,
    });
  }
  return db.begin(async (tx) => {
    const [project] = await tx`
      SELECT 1 FROM wcp_projects p WHERE p.id = ${context.project_id} AND p.tenant_id = ${context.tenant_id}
        AND p.workspace_id = ${context.workspace_id} AND p.deleted_at IS NULL
        AND p.classification IN ('public', 'internal', 'confidential', 'restricted')
        AND (p.classification <> 'restricted' OR ${context.capability.includes('data.restricted.read')}) FOR SHARE`;
    if (!project)
      throw new ContractError('NOT_FOUND', 'The project is unavailable in the current scope', {
        trace_id: context.trace_id,
      });
    const current = await highWater(tx, context);
    if (!Number.isSafeInteger(current) || current < 0)
      throw new ContractError('SYNC_CURSOR_INVALID', 'The stored stream cursor is invalid', {
        trace_id: context.trace_id,
      });
    checkCursor(cursor, current, context.trace_id);
    syncReaderIdentity(context);
    const saved = await tx<{ server_cursor: string }[]>`
      INSERT INTO wcp_sync_acknowledgements (tenant_id, workspace_id, project_id, actor_id, client_id, server_cursor)
      VALUES (${context.tenant_id}, ${context.workspace_id}, ${context.project_id}, ${context.actor_id}, ${context.client_id}, ${cursor})
      ON CONFLICT (tenant_id, workspace_id, project_id, actor_id, client_id) DO UPDATE SET
        server_cursor = EXCLUDED.server_cursor,
        updated_at = CASE WHEN wcp_sync_acknowledgements.server_cursor < EXCLUDED.server_cursor THEN now() ELSE wcp_sync_acknowledgements.updated_at END
      WHERE wcp_sync_acknowledgements.server_cursor <= EXCLUDED.server_cursor
      RETURNING server_cursor::text AS server_cursor
    `;
    if (!saved.length)
      throw new ContractError('CURSOR_REGRESSION', 'An acknowledgement cannot move backwards', {
        cursor,
        trace_id: context.trace_id,
      });
    if (saved.length !== 1 || saved[0]!.server_cursor !== String(cursor))
      throw new ContractError(
        'SYNC_CURSOR_INVALID',
        'The saved cursor differs from the requested acknowledgement',
        { trace_id: context.trace_id },
      );
    syncReaderIdentity(context);
    return { client_id: context.client_id, cursor };
  });
}
