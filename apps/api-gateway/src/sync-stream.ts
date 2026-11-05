import { ContractError } from '@planemem/contracts';
import { validateEvent, type CanonicalEvent } from '@planemem/events';
import type { RuntimeSql } from './runtime-persistence.js';
import { enqueueEventBus } from './event-bus-outbox.js';

type Scope = { tenant_id: string; workspace_id: string; project_id: string };

/** All writers take this project lock inside their transaction before allocating cursors. */
export async function lockSyncStream(tx: RuntimeSql, scope: Scope): Promise<void> {
  const key = JSON.stringify([scope.tenant_id, scope.workspace_id, scope.project_id]);
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export async function highWater(db: RuntimeSql, scope: Scope): Promise<number> {
  const [row] = await db<{ cursor: string | number }[]>`
    SELECT COALESCE(MAX(server_cursor), 0) AS cursor FROM wcp_sync_events
     WHERE tenant_id = ${scope.tenant_id} AND workspace_id = ${scope.workspace_id} AND project_id = ${scope.project_id}
  `;
  return Number(row!.cursor);
}

export async function appendSyncEvent(
  tx: RuntimeSql,
  event: CanonicalEvent,
  cursor: number,
): Promise<void> {
  if (
    !event.project_id ||
    !Number.isSafeInteger(cursor) ||
    cursor < 1 ||
    !validateEvent(event).valid
  )
    throw new ContractError('SYNC_EVENT_INVALID', 'Cannot store this event in the project stream', {
      trace_id: event.trace_id,
    });
  await tx`INSERT INTO wcp_sync_events (event_id, tenant_id, workspace_id, project_id, server_cursor, event_type, payload, source_refs, trace_id)
    VALUES (${event.event_id}, ${event.tenant_id}, ${event.workspace_id}, ${event.project_id}, ${cursor},
      ${event.event_type}, ${JSON.stringify(event)}::jsonb, ${JSON.stringify(event.source_refs)}::jsonb, ${event.trace_id})`;
  await enqueueEventBus(tx, event);
}
