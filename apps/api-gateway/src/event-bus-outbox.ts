import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { validateEvent, type CanonicalEvent } from '@planemem/events';
import type { RuntimeSql } from './runtime-persistence.js';

/** Caller must own a business transaction. Persist the original event, never rebuild missing metadata. */
export async function enqueueEventBus(tx: RuntimeSql, event: CanonicalEvent): Promise<void> {
  const body = syncJsonSnapshot(event, 16 * 1024 * 1024);
  const valid = validateEvent(JSON.parse(body));
  if (!valid.valid)
    throw new ContractError('EVENT_BUS_EVENT_INVALID', 'Cannot queue this canonical event', {
      trace_id: event.trace_id,
    });
  const original = valid.event;
  const aggregate = JSON.stringify([
    original.tenant_id,
    original.workspace_id,
    original.project_id ?? null,
    original.aggregate_type,
    original.aggregate_id,
  ]);
  const rows = await tx`INSERT INTO wcp_event_bus_outbox (event_id, aggregate_key, event_body)
    VALUES (${original.event_id}, ${aggregate}, ${body}::jsonb)
    ON CONFLICT (event_id) DO UPDATE SET event_id = EXCLUDED.event_id
      WHERE wcp_event_bus_outbox.event_body = EXCLUDED.event_body
        AND wcp_event_bus_outbox.aggregate_key = EXCLUDED.aggregate_key
    RETURNING event_id`;
  if (rows.length !== 1)
    throw new ContractError('EVENT_BUS_ID_CONFLICT', 'Event ID already names different content', {
      trace_id: original.trace_id,
    });
}
