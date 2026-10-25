import type { CanonicalEvent } from '@planemem/events';
import type { PlaneProjection, ObservedState } from '@planemem/plane-connector';
import type { SearchHit, SearchService } from '@planemem/search-service';
import postgres from 'postgres';

export type RuntimeSql = ReturnType<typeof postgres>;
export type RuntimeResourceRegistrar = (hit: SearchHit) => void;

export interface RuntimePersistenceState {
  db: RuntimeSql;
  search: SearchService;
  projection: PlaneProjection;
  registerResource: RuntimeResourceRegistrar;
}

export async function hydrateRuntimeState(state: RuntimePersistenceState): Promise<void> {
  const events = await state.db<
    {
      event_id: string;
      event_type: string;
      schema_version: number;
      tenant_id: string;
      workspace_id: string;
      project_id: string | null;
      aggregate_type: string;
      aggregate_id: string;
      aggregate_version: number;
      trace_id: string;
      source_refs: unknown;
      payload: unknown;
      occurred_at: string;
    }[]
  >`
    SELECT event_id, event_type, schema_version, tenant_id, workspace_id, project_id,
           aggregate_type, aggregate_id, aggregate_version, trace_id, source_refs, payload,
           occurred_at::text AS occurred_at
    FROM wcp_events
    ORDER BY aggregate_type, aggregate_id, aggregate_version, occurred_at, event_id
  `;
  for (const row of events) {
    const event = {
      event_id: row.event_id as CanonicalEvent['event_id'],
      event_type: row.event_type as CanonicalEvent['event_type'],
      schema_version: row.schema_version,
      tenant_id: row.tenant_id as CanonicalEvent['tenant_id'],
      workspace_id: row.workspace_id as CanonicalEvent['workspace_id'],
      aggregate_type: row.aggregate_type,
      aggregate_id: row.aggregate_id as CanonicalEvent['aggregate_id'],
      aggregate_version: Number(row.aggregate_version),
      occurred_at: normalizeUtcTimestamp(row.occurred_at),
      trace_id: row.trace_id,
      source_refs: parseJson<Array<{ type: string; id: string }>>(row.source_refs),
      sensitivity: 'internal',
      payload: parseJson<Record<string, unknown>>(row.payload),
    } as CanonicalEvent<Record<string, unknown>>;
    if (row.project_id !== null) {
      event.project_id = row.project_id as NonNullable<CanonicalEvent['project_id']>;
    }
    const result = state.projection.applyPlaneEvent(event);
    if (result.status !== 'accepted' && result.status !== 'duplicate') {
      throw new Error(`Unable to hydrate Plane event ${row.event_id}: ${result.status}`);
    }
  }

  const hits = await state.db<
    {
      tenant_id: string;
      workspace_id: string;
      project_id: string;
      id: string;
      title: string;
      snippet: string;
      revision: number;
      score: number;
      rank_source: SearchHit['rank_source'];
      source_refs: unknown;
    }[]
  >`
    SELECT tenant_id, workspace_id, project_id, id, title, snippet, revision, score,
           rank_source, source_refs
    FROM wcp_context_hits
    ORDER BY updated_at, id
  `;
  for (const row of hits) {
    const hit = state.search.index({
      tenant_id: row.tenant_id,
      workspace_id: row.workspace_id,
      project_id: row.project_id,
      id: row.id,
      title: row.title,
      snippet: row.snippet,
      revision: row.revision,
      score: row.score,
      rank_source: row.rank_source,
      source_refs: parseJson<Array<{ type: string; id: string }>>(row.source_refs),
    });
    state.registerResource(hit);
  }
}

function normalizeUtcTimestamp(value: string): string {
  return value.endsWith('+00') ? `${value.slice(0, -3)}Z` : value;
}

function parseJson<T>(value: unknown): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);
}

export async function eventExists(db: RuntimeSql, eventId: string): Promise<boolean> {
  const rows = await db<{ event_id: string }[]>`
    SELECT event_id FROM wcp_events WHERE event_id = ${eventId} LIMIT 1
  `;
  return rows.length > 0;
}

export async function persistContextHit(
  db: RuntimeSql,
  hit: SearchHit,
  traceId: string,
): Promise<void> {
  await db`
    INSERT INTO wcp_context_hits
      (tenant_id, workspace_id, project_id, id, title, snippet, revision, score, rank_source,
       source_refs, trace_id)
    VALUES
      (${hit.tenant_id}, ${hit.workspace_id}, ${hit.project_id}, ${hit.id}, ${hit.title},
       ${hit.snippet}, ${hit.revision}, ${hit.score}, ${hit.rank_source},
       ${JSON.stringify(hit.source_refs)}::jsonb, ${traceId})
    ON CONFLICT (tenant_id, workspace_id, project_id, id) DO UPDATE SET
      title = EXCLUDED.title,
      snippet = EXCLUDED.snippet,
      revision = EXCLUDED.revision,
      score = EXCLUDED.score,
      rank_source = EXCLUDED.rank_source,
      source_refs = EXCLUDED.source_refs,
      trace_id = EXCLUDED.trace_id,
      updated_at = now()
  `;
}

export async function persistPlaneEvent(
  db: RuntimeSql,
  event: CanonicalEvent<Record<string, unknown>>,
  state: ObservedState,
  hit: SearchHit,
): Promise<boolean> {
  return db.begin(async (transaction) => {
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
    if (inserted.length === 0) return false;
    await transaction`
      INSERT INTO wcp_projection_states
        (tenant_id, workspace_id, project_id, entity_kind, external_id, authority, plane_version,
         observed_at, source_event_id, source_refs, status, fields)
      VALUES
        (${event.tenant_id}, ${event.workspace_id}, ${event.project_id ?? event.aggregate_id},
         ${state.entity_kind}, ${state.external_id}, ${state.authority}, ${state.plane_version},
         ${state.observed_at}, ${state.source_event_id}, ${JSON.stringify(state.source_refs)}::jsonb,
         ${state.status ?? null}, ${JSON.stringify(state.fields)}::jsonb)
      ON CONFLICT (tenant_id, workspace_id, project_id, entity_kind, external_id) DO UPDATE SET
        authority = EXCLUDED.authority,
        plane_version = EXCLUDED.plane_version,
        observed_at = EXCLUDED.observed_at,
        source_event_id = EXCLUDED.source_event_id,
        source_refs = EXCLUDED.source_refs,
        status = EXCLUDED.status,
        fields = EXCLUDED.fields,
        updated_at = now()
    `;
    await transaction`
      INSERT INTO wcp_context_hits
        (tenant_id, workspace_id, project_id, id, title, snippet, revision, score, rank_source,
         source_refs, trace_id)
      VALUES
        (${hit.tenant_id}, ${hit.workspace_id}, ${hit.project_id}, ${hit.id}, ${hit.title},
         ${hit.snippet}, ${hit.revision}, ${hit.score}, ${hit.rank_source},
         ${JSON.stringify(hit.source_refs)}::jsonb, ${event.trace_id})
      ON CONFLICT (tenant_id, workspace_id, project_id, id) DO UPDATE SET
        title = EXCLUDED.title,
        snippet = EXCLUDED.snippet,
        revision = EXCLUDED.revision,
        score = EXCLUDED.score,
        rank_source = EXCLUDED.rank_source,
        source_refs = EXCLUDED.source_refs,
        trace_id = EXCLUDED.trace_id,
        updated_at = now()
    `;
    return true;
  });
}
