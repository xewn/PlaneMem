import { isSyncIdentifier, isUlid } from '@planemem/contracts';
import { EventBusDeliveryRejected, type DurableEventConsumer } from './event-bus.js';
import type { RuntimeSql } from './runtime-persistence.js';
import type { RequestContext } from './router.js';

const itemEvents = new Set([
  'ContextItemCreated',
  'ContextItemUpdated',
  'ContextItemArchived',
  'ContextItemRestored',
  'ContextItemConfirmed',
]);

/** The compiler owns the project stream lock and the pack's creation transaction. */
export async function saveContextPackDependencies(
  tx: RuntimeSql,
  scope: Pick<RequestContext, 'tenant_id' | 'workspace_id' | 'project_id'>,
  packId: string,
  revisions: ReadonlyMap<string, number>,
): Promise<void> {
  if (!isUlid(packId) || revisions.size > 4096) throw new TypeError('Invalid pack dependencies');
  const entries = [...revisions].map(([source_id, source_version]) => {
    if (!isSyncIdentifier(source_id) || !Number.isSafeInteger(source_version) || source_version < 1)
      throw new TypeError('Invalid context source revision');
    return { source_id, source_version };
  });
  if (!entries.length) return;
  await tx`INSERT INTO wcp_context_pack_dependencies
    (tenant_id, workspace_id, project_id, pack_id, source_id, source_version)
    SELECT ${scope.tenant_id}, ${scope.workspace_id}, ${scope.project_id}, ${packId},
      source_id, source_version FROM jsonb_to_recordset(${JSON.stringify(entries)}::jsonb)
      AS dependency(source_id text, source_version bigint)`;
}

/** Versioned service consumer; never borrow an end-user identity for background processing. */
export function contextPackInvalidationConsumer(): DurableEventConsumer {
  return {
    name: 'context_pack_invalidation_v1',
    async checkStorage(db) {
      await db`SELECT tenant_id, workspace_id, project_id, pack_id, source_id, source_version
        FROM wcp_context_pack_dependencies LIMIT 0`;
      await db`SELECT tenant_id, workspace_id, project_id, pack_id, source_id, saved_source_version,
        changed_source_version, event_id, event_type, trace_id, stream_name, stream_sequence,
        occurred_at, recorded_at FROM wcp_context_pack_invalidations LIMIT 0`;
    },
    async handle({ event, stream, sequence }, tx, signal) {
      signal.throwIfAborted();
      if (!itemEvents.has(event.event_type)) return;
      const item = event.payload.item_id;
      if (
        !event.project_id ||
        event.aggregate_type !== 'ContextItem' ||
        !isSyncIdentifier(item) ||
        event.payload.version !== event.aggregate_version ||
        event.aggregate_id !== (isUlid(item) ? item : event.event_id) ||
        !event.source_refs.some(
          (ref) =>
            ref.type === 'context-item' &&
            ref.id === item &&
            ref.revision === event.aggregate_version,
        )
      )
        throw new EventBusDeliveryRejected('EVENT_BUS_PAYLOAD_INVALID');

      // Compare the saved revision, not delivery time: delayed older events must not invalidate new packs.
      // All effects and the bus consumption receipt share tx. A duplicate leaves the original reason intact.
      await tx`INSERT INTO wcp_context_pack_invalidations
        (pack_id, tenant_id, workspace_id, project_id, source_id, saved_source_version,
          changed_source_version, event_id, event_type, trace_id, stream_name, stream_sequence, occurred_at)
        SELECT d.pack_id, d.tenant_id, d.workspace_id, d.project_id, d.source_id, d.source_version,
          ${event.aggregate_version}, ${event.event_id}, ${event.event_type}, ${event.trace_id},
          ${stream}, ${sequence}, ${event.occurred_at}
        FROM wcp_context_pack_dependencies d
        WHERE d.tenant_id = ${event.tenant_id} AND d.workspace_id = ${event.workspace_id}
          AND d.project_id = ${event.project_id} AND d.source_id = ${item}
          AND d.source_version < ${event.aggregate_version}
        ORDER BY d.pack_id COLLATE "C"
        ON CONFLICT (pack_id) DO NOTHING`;
      signal.throwIfAborted();
    },
  };
}
