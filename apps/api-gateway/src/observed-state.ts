import {
  ContractError,
  parseObservedRecordId,
  parseObservedSnapshot,
  parsePlaneRestoreReference,
  type ObservedSnapshot,
} from '@planemem/contracts';
import type { RequestContext } from './router.js';
import type { WorkbenchDatabase } from './workbench/repository.js';

export type PersistedObservedState = ObservedSnapshot;

/** Read the committed Plane snapshot together with its event and current visibility record. */
export class PostgresObservedState {
  constructor(private readonly db: WorkbenchDatabase | undefined) {}

  async read(
    kind: 'Project' | 'WorkItem',
    id: unknown,
    context: RequestContext,
  ): Promise<PersistedObservedState> {
    let recordId: string;
    try {
      recordId = parseObservedRecordId(id);
    } catch {
      throw new ContractError('INVALID_INPUT', 'Expected a valid observed record ID', {
        trace_id: context.trace_id,
      });
    }
    const missing = () =>
      new ContractError('NOT_FOUND', 'Observed record is unavailable in this project', {
        trace_id: context.trace_id,
      });
    if (kind === 'Project' && recordId !== context.project_id) throw missing();
    if (!this.db) throw unavailable(context);
    let rows: Record<string, unknown>[];
    try {
      rows = await this.db.query<Record<string, unknown>>(
        `SELECT s.tenant_id, s.workspace_id, s.project_id, s.entity_kind, s.external_id,
          e.aggregate_id, s.authority, s.plane_version::text AS plane_version, s.observed_at,
          s.source_event_id, e.event_type AS source_event_type, e.source_refs, s.status, s.fields, s.deleted_at, h.classification
        FROM wcp_projection_states s
        JOIN wcp_events e ON e.event_id = s.source_event_id AND e.tenant_id = s.tenant_id
          AND e.workspace_id = s.workspace_id AND COALESCE(e.project_id, e.aggregate_id) = s.project_id
          AND e.aggregate_version = s.plane_version AND e.payload = s.fields AND e.occurred_at = s.observed_at
          AND ((s.entity_kind = 'Project' AND e.aggregate_type = 'project'
            AND e.event_type IN ('ProjectCreated', 'ProjectUpdated'))
            OR (s.entity_kind = 'WorkItem' AND e.aggregate_type = 'work_item'
              AND e.event_type IN ('WorkItemCreated', 'WorkItemUpdated', 'WorkItemStatusConfirmed', 'WorkItemDeleted', 'WorkItemRestored')))
        JOIN wcp_context_hits h ON h.tenant_id = s.tenant_id AND h.workspace_id = s.workspace_id
          AND h.project_id = s.project_id AND h.id = 'plane:' || s.entity_kind || ':' || s.external_id
          AND h.revision = s.plane_version
          AND ((s.deleted_at IS NULL AND e.event_type <> 'WorkItemDeleted' AND h.deleted_at IS NULL
            AND (h.expires_at IS NULL OR h.expires_at > statement_timestamp()))
            OR (e.event_type = 'WorkItemDeleted' AND s.deleted_at = s.observed_at AND h.deleted_at = s.deleted_at))
        JOIN wcp_projects p ON p.tenant_id = s.tenant_id AND p.workspace_id = s.workspace_id
          AND p.id = s.project_id AND p.deleted_at IS NULL
        WHERE s.tenant_id = $1 AND s.workspace_id = $2 AND s.project_id = $3 AND s.entity_kind = $4
          AND (s.external_id = $5 OR e.aggregate_id = $5) AND s.authority = 'plane'
          AND ($6::boolean OR (h.classification <> 'restricted' AND p.classification <> 'restricted'))
        LIMIT 2`,
        [
          context.tenant_id,
          context.workspace_id,
          context.project_id,
          kind,
          recordId,
          context.capability.includes('data.restricted.read'),
        ],
      );
    } catch {
      throw unavailable(context);
    }
    if (!rows.length) throw missing();
    try {
      if (rows.length !== 1) throw new Error('Ambiguous observed identity');
      const row = rows[0]!;
      if (typeof row.plane_version !== 'string' || !/^[1-9][0-9]*$/.test(row.plane_version))
        throw new Error('Invalid observed snapshot');
      if (!(row.observed_at instanceof Date) && typeof row.observed_at !== 'string')
        throw new Error();
      const observed_at = new Date(row.observed_at).toISOString();
      const deleted = row.deleted_at !== null;
      if (deleted && !(row.deleted_at instanceof Date) && typeof row.deleted_at !== 'string')
        throw new Error();
      return parseObservedSnapshot(
        {
          ...row,
          schema_version: deleted ? 2 : 1,
          ...(row.source_event_type === 'WorkItemRestored'
            ? {
                restored_from: parsePlaneRestoreReference(
                  (row.fields as Record<string, unknown> | null)?.restored_from,
                  Number(row.plane_version),
                ),
              }
            : {}),
          deleted_at: deleted ? new Date(row.deleted_at as string | Date).toISOString() : undefined,
          plane_version: Number(row.plane_version),
          observed_at,
          status: row.status === null ? undefined : row.status,
        },
        kind,
        recordId,
        context,
      );
    } catch {
      throw new ContractError(
        'OBSERVED_STATE_INVALID',
        'Stored observed snapshot is invalid or ambiguous',
        {
          trace_id: context.trace_id,
        },
      );
    }
  }
}

function unavailable(context: RequestContext) {
  return new ContractError('OBSERVED_STATE_UNAVAILABLE', 'Observed state storage is unavailable', {
    trace_id: context.trace_id,
    retryable: true,
  });
}
