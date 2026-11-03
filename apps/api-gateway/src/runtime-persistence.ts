import type { CanonicalEvent } from '@planemem/events';
import { observedEntityKind, type ObservedState } from '@planemem/plane-connector';
import type { SearchHit } from '@planemem/search-service';
import postgres from 'postgres';
import { ContractError, parsePlaneRestoreReference } from '@planemem/contracts';
import { fingerprint } from './idempotency.js';

export type RuntimeSql = ReturnType<typeof postgres>;

export async function persistContextHit(
  db: RuntimeSql,
  hit: SearchHit,
  traceId: string,
): Promise<void> {
  const rows = await db`
    INSERT INTO wcp_context_hits
      (tenant_id, workspace_id, project_id, id, title, snippet, revision, score, rank_source,
       source_refs, trace_id, classification, expires_at)
    VALUES
      (${hit.tenant_id}, ${hit.workspace_id}, ${hit.project_id}, ${hit.id}, ${hit.title},
       ${hit.snippet}, ${hit.revision}, ${hit.score}, ${hit.rank_source},
       ${JSON.stringify(hit.source_refs)}::jsonb, ${traceId}, ${hit.classification ?? 'restricted'}, ${hit.expires_at ?? null})
    ON CONFLICT (tenant_id, workspace_id, project_id, id) DO UPDATE SET
      title = EXCLUDED.title,
      snippet = EXCLUDED.snippet,
      revision = EXCLUDED.revision,
      score = EXCLUDED.score,
      rank_source = EXCLUDED.rank_source,
      source_refs = EXCLUDED.source_refs,
      trace_id = EXCLUDED.trace_id,
      classification = EXCLUDED.classification,
      expires_at = EXCLUDED.expires_at,
      updated_at = now()
    WHERE wcp_context_hits.deleted_at IS NULL
      AND array_position(ARRAY['public','internal','confidential','restricted'], wcp_context_hits.classification)
        <= array_position(ARRAY['public','internal','confidential','restricted'], EXCLUDED.classification)
      AND (wcp_context_hits.revision < EXCLUDED.revision OR
        (wcp_context_hits.revision = EXCLUDED.revision AND wcp_context_hits.title = EXCLUDED.title
          AND wcp_context_hits.snippet = EXCLUDED.snippet AND wcp_context_hits.score = EXCLUDED.score
          AND wcp_context_hits.rank_source = EXCLUDED.rank_source AND wcp_context_hits.source_refs = EXCLUDED.source_refs
          AND wcp_context_hits.classification = EXCLUDED.classification
          AND wcp_context_hits.expires_at IS NOT DISTINCT FROM EXCLUDED.expires_at))
    RETURNING id
  `;
  if (!rows.length)
    throw new ContractError(
      'CONTEXT_INDEX_VERSION_CONFLICT',
      'Context index revision, classification or deletion state has changed',
      { trace_id: traceId },
    );
}

/** Caller owns the inbox/aggregate locks and commits the receipt in this transaction. */
export async function persistPlaneEventInTransaction(
  transaction: RuntimeSql,
  event: CanonicalEvent<Record<string, unknown>>,
  state: ObservedState,
  hit: SearchHit,
): Promise<void> {
  const scopeProject = event.project_id ?? event.aggregate_id;
  const deleted = event.event_type === 'WorkItemDeleted';
  const restore =
    event.event_type === 'WorkItemRestored'
      ? parsePlaneRestoreReference(event.payload.restored_from, event.aggregate_version)
      : undefined;
  if (
    (restore
      ? state.restored_from?.event_id !== restore.event_id ||
        state.restored_from?.aggregate_version !== restore.aggregate_version ||
        event.causation_id !== restore.event_id ||
        event.event_id === restore.event_id
      : state.restored_from !== undefined) ||
    state.schema_version !== (deleted ? 2 : 1) ||
    state.deleted_at !== (deleted ? event.occurred_at : undefined) ||
    state.tenant_id !== event.tenant_id ||
    state.workspace_id !== event.workspace_id ||
    state.project_id !== scopeProject ||
    state.entity_kind !== observedEntityKind(event) ||
    state.aggregate_id !== event.aggregate_id ||
    state.source_event_id !== event.event_id ||
    state.plane_version !== event.aggregate_version ||
    state.authority !== 'plane' ||
    state.observed_at !== event.occurred_at ||
    state.external_id !== (event.payload.external_id ?? event.aggregate_id) ||
    state.status !==
      (typeof event.payload.status === 'string' ? event.payload.status : undefined) ||
    fingerprint(state.fields) !== fingerprint(event.payload) ||
    fingerprint(state.source_refs) !== fingerprint(event.source_refs) ||
    hit.tenant_id !== event.tenant_id ||
    hit.workspace_id !== event.workspace_id ||
    hit.project_id !== scopeProject ||
    hit.id !== `plane:${state.entity_kind}:${state.external_id}` ||
    hit.revision !== state.plane_version ||
    fingerprint(hit.source_refs) !== fingerprint(event.source_refs)
  )
    throw new ContractError(
      'PLANE_PROJECTION_MISMATCH',
      'Plane event, snapshot and index must describe the same scoped revision',
      { trace_id: event.trace_id },
    );
  if (restore) {
    const tombstones = await transaction`
      SELECT s.source_event_id FROM wcp_projection_states s
      JOIN wcp_events d ON d.event_id = s.source_event_id
        AND d.tenant_id = s.tenant_id AND d.workspace_id = s.workspace_id AND d.project_id = s.project_id
        AND d.aggregate_type = 'work_item' AND d.aggregate_id = ${event.aggregate_id}
        AND d.event_type = 'WorkItemDeleted' AND d.schema_version = 1
        AND d.aggregate_version = s.plane_version AND d.occurred_at = s.observed_at
        AND d.payload = s.fields AND d.source_refs = s.source_refs
      JOIN wcp_context_hits h ON h.tenant_id = s.tenant_id AND h.workspace_id = s.workspace_id
        AND h.project_id = s.project_id AND h.id = ${hit.id}
        AND h.revision = s.plane_version AND h.deleted_at = s.deleted_at
        AND h.source_refs = s.source_refs
      WHERE s.tenant_id = ${event.tenant_id} AND s.workspace_id = ${event.workspace_id}
        AND s.project_id = ${scopeProject} AND s.entity_kind = 'WorkItem' AND s.authority = 'plane'
        AND s.external_id = ${state.external_id} AND s.source_event_id = ${restore.event_id}
        AND s.plane_version = ${restore.aggregate_version} AND s.status IS NULL
        AND s.fields = jsonb_build_object('external_id', ${state.external_id}::text)
        AND s.deleted_at IS NOT NULL AND s.deleted_at = s.observed_at
        AND (h.expires_at IS NULL OR h.expires_at > statement_timestamp())
      FOR UPDATE OF s, h`;
    if (tombstones.length !== 1)
      throw new ContractError(
        'PLANE_RESTORE_PRECONDITION_FAILED',
        'Restore requires the matching deletion snapshot and an unexpired deleted index',
        { trace_id: event.trace_id },
      );
  }
  const inserted = await transaction<{ event_id: string }[]>`
      INSERT INTO wcp_events
        (event_id, event_type, schema_version, tenant_id, workspace_id, project_id,
         aggregate_type, aggregate_id, aggregate_version, trace_id, source_refs, payload, occurred_at)
      VALUES
        (${event.event_id}, ${event.event_type}, ${event.schema_version}, ${event.tenant_id},
         ${event.workspace_id}, ${event.project_id ?? null}, ${event.aggregate_type},
         ${event.aggregate_id}, ${event.aggregate_version}, ${event.trace_id},
         ${JSON.stringify(event.source_refs)}::jsonb, ${JSON.stringify(event.payload)}::jsonb,
         ${event.occurred_at})
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
    `;
  if (inserted.length === 0)
    throw new ContractError('PLANE_EVENT_ID_CONFLICT', 'Event ID was committed concurrently', {
      trace_id: event.trace_id,
    });
  const snapshots = await transaction`
      INSERT INTO wcp_projection_states
        (tenant_id, workspace_id, project_id, entity_kind, external_id, authority, plane_version,
         observed_at, source_event_id, source_refs, status, fields, deleted_at)
      VALUES
        (${event.tenant_id}, ${event.workspace_id}, ${event.project_id ?? event.aggregate_id},
         ${state.entity_kind}, ${state.external_id}, ${state.authority}, ${state.plane_version},
         ${state.observed_at}, ${state.source_event_id}, ${JSON.stringify(state.source_refs)}::jsonb,
         ${state.status ?? null}, ${JSON.stringify(state.fields)}::jsonb, ${state.deleted_at ?? null})
      ON CONFLICT (tenant_id, workspace_id, project_id, entity_kind, external_id) DO UPDATE SET
        authority = EXCLUDED.authority,
        plane_version = EXCLUDED.plane_version,
        observed_at = EXCLUDED.observed_at,
        source_event_id = EXCLUDED.source_event_id,
        source_refs = EXCLUDED.source_refs,
        status = EXCLUDED.status,
        fields = EXCLUDED.fields,
        deleted_at = EXCLUDED.deleted_at,
        updated_at = now()
      WHERE wcp_projection_states.plane_version < EXCLUDED.plane_version
        AND (wcp_projection_states.deleted_at IS NULL OR EXCLUDED.deleted_at IS NOT NULL
          OR (${Boolean(restore)}::boolean AND wcp_projection_states.deleted_at IS NOT NULL
            AND wcp_projection_states.source_event_id = ${restore?.event_id ?? null}
            AND wcp_projection_states.plane_version = ${restore?.aggregate_version ?? null}))
      RETURNING external_id
    `;
  if (!snapshots.length)
    throw new ContractError(
      'PLANE_PROJECTION_CONFLICT',
      'Observation version cannot replace the saved snapshot',
      { trace_id: event.trace_id },
    );
  const hits = await transaction`
      INSERT INTO wcp_context_hits
        (tenant_id, workspace_id, project_id, id, title, snippet, revision, score, rank_source,
         source_refs, trace_id, classification, deleted_at)
      VALUES
        (${hit.tenant_id}, ${hit.workspace_id}, ${hit.project_id}, ${hit.id}, ${deleted ? 'Deleted Plane work item' : hit.title},
         ${deleted ? '' : hit.snippet}, ${hit.revision}, ${hit.score}, ${hit.rank_source},
         ${JSON.stringify(hit.source_refs)}::jsonb, ${event.trace_id}, ${event.sensitivity}, ${state.deleted_at ?? null})
      ON CONFLICT (tenant_id, workspace_id, project_id, id) DO UPDATE SET
        title = EXCLUDED.title,
        snippet = EXCLUDED.snippet,
        revision = EXCLUDED.revision,
        score = EXCLUDED.score,
        rank_source = EXCLUDED.rank_source,
        source_refs = EXCLUDED.source_refs,
        trace_id = EXCLUDED.trace_id,
        deleted_at = EXCLUDED.deleted_at,
        classification = (ARRAY['public','internal','confidential','restricted'])[GREATEST(
          COALESCE(array_position(ARRAY['public','internal','confidential','restricted'], wcp_context_hits.classification), 4),
          COALESCE(array_position(ARRAY['public','internal','confidential','restricted'], EXCLUDED.classification), 4))],
        updated_at = now()
      WHERE wcp_context_hits.revision < EXCLUDED.revision
        AND (${deleted}::boolean OR ((wcp_context_hits.deleted_at IS NULL
          OR (${Boolean(restore)}::boolean AND wcp_context_hits.deleted_at IS NOT NULL
            AND wcp_context_hits.revision = ${restore?.aggregate_version ?? null}))
          AND (wcp_context_hits.expires_at IS NULL OR wcp_context_hits.expires_at > statement_timestamp())))
      RETURNING id
    `;
  if (!hits.length)
    throw new ContractError(
      'PLANE_INDEX_CONFLICT',
      'Observation index is deleted, expired or has a conflicting revision',
      { trace_id: event.trace_id },
    );
}
