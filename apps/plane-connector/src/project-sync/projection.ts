import {
  EventConsumerLedger,
  type CanonicalEvent,
  type EventConsumerResult,
} from '@planemem/events';

export interface ProjectionScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}

export interface ExternalRef extends ProjectionScope {
  entity_kind: string;
  external_id: string;
  internal_ref: string;
}

export interface ObservedState extends ProjectionScope {
  schema_version: 1;
  entity_kind: string;
  external_id: string;
  aggregate_id: string;
  authority: 'plane';
  plane_version: number;
  observed_at: string;
  source_event_id: string;
  source_refs: Array<{ type: string; id: string }>;
  status?: string;
  fields: Record<string, unknown>;
}

export class PlaneProjection {
  private readonly refs = new Map<string, ExternalRef>();
  private readonly states = new Map<string, ObservedState>();
  private readonly consumer = new EventConsumerLedger();

  resolveExternalRef(
    entity_kind: string,
    external_id: string,
    scope?: ProjectionScope,
  ): ExternalRef | undefined {
    if (scope !== undefined) return this.refs.get(this.key(entity_kind, external_id, scope));
    return [...this.refs.values()].find(
      (ref) => ref.entity_kind === entity_kind && ref.external_id === external_id,
    );
  }

  applyPlaneEvent(event: CanonicalEvent<Record<string, unknown>>): EventConsumerResult {
    return this.consumer.consume(event, (accepted) => {
      const payload = accepted.payload as Record<string, unknown>;
      const entityKind = accepted.aggregate_type === 'project' ? 'Project' : 'WorkItem';
      const externalId =
        typeof payload.external_id === 'string' ? payload.external_id : accepted.aggregate_id;
      const scope: ProjectionScope = {
        tenant_id: accepted.tenant_id,
        workspace_id: accepted.workspace_id,
        project_id: accepted.project_id ?? accepted.aggregate_id,
      };
      const ref: ExternalRef = {
        ...scope,
        entity_kind: entityKind,
        external_id: externalId,
        internal_ref: `plane:${entityKind}:${externalId}`,
      };
      const state: ObservedState = {
        schema_version: 1,
        ...scope,
        entity_kind: entityKind,
        external_id: externalId,
        aggregate_id: accepted.aggregate_id,
        authority: 'plane',
        plane_version: accepted.aggregate_version,
        observed_at: accepted.occurred_at,
        source_event_id: accepted.event_id,
        source_refs: accepted.source_refs.map((source) => ({ type: source.type, id: source.id })),
        ...(typeof payload.status === 'string' ? { status: payload.status } : {}),
        fields: { ...payload },
      };
      this.refs.set(this.key(entityKind, externalId, scope), ref);
      this.refs.set(this.key(entityKind, accepted.aggregate_id, scope), ref);
      this.states.set(this.key(entityKind, externalId, scope), state);
      this.states.set(this.key(entityKind, accepted.aggregate_id, scope), state);
    });
  }

  getObservedState(
    entity_kind: string,
    external_id: string,
    scope?: ProjectionScope,
  ): ObservedState | undefined {
    if (scope !== undefined) return this.states.get(this.key(entity_kind, external_id, scope));
    return [...this.states.values()].find(
      (state) => state.entity_kind === entity_kind && state.external_id === external_id,
    );
  }

  listObservedStates(entity_kind: string, scope: ProjectionScope): ObservedState[] {
    return [...this.states.values()]
      .filter(
        (state) =>
          state.entity_kind === entity_kind &&
          state.tenant_id === scope.tenant_id &&
          state.workspace_id === scope.workspace_id &&
          state.project_id === scope.project_id,
      )
      .filter(
        (state, index, states) =>
          states.findIndex(
            (candidate) =>
              candidate.entity_kind === state.entity_kind &&
              candidate.external_id === state.external_id &&
              candidate.aggregate_id === state.aggregate_id,
          ) === index,
      );
  }

  private key(entity_kind: string, external_id: string, scope: ProjectionScope): string {
    return `${scope.tenant_id}:${scope.workspace_id}:${scope.project_id}:${entity_kind}:${external_id}`;
  }
}
