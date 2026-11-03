import {
  EventConsumerLedger,
  validateEvent,
  type CanonicalEvent,
  type EventConsumerResult,
} from '@planemem/events';
import {
  ContractError,
  parseObservedRecordId,
  parsePlaneRestoreReference,
  type PlaneRestoreReference,
  validateSourceRef,
  type SourceRef,
} from '@planemem/contracts';

/** Only authoritative Plane observations belong in this projection. */
export function observedEntityKind(
  event: Pick<CanonicalEvent, 'event_type' | 'aggregate_type'>,
): 'Project' | 'WorkItem' | undefined {
  if (
    event.aggregate_type === 'project' &&
    ['ProjectCreated', 'ProjectUpdated'].includes(event.event_type)
  )
    return 'Project';
  if (
    event.aggregate_type === 'work_item' &&
    [
      'WorkItemCreated',
      'WorkItemUpdated',
      'WorkItemStatusConfirmed',
      'WorkItemDeleted',
      'WorkItemRestored',
    ].includes(event.event_type)
  )
    return 'WorkItem';
  return undefined;
}

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
  schema_version: 1 | 2;
  /** Present only on a version-2 deletion observation. */
  deleted_at?: string;
  restored_from?: PlaneRestoreReference;
  entity_kind: string;
  external_id: string;
  aggregate_id: string;
  authority: 'plane';
  plane_version: number;
  observed_at: string;
  source_event_id: string;
  source_refs: SourceRef[];
  status?: string;
  fields: Record<string, unknown>;
}

/** Build a snapshot without advancing a consumer or publishing it to an in-memory cache. */
export function buildPlaneObservedState(
  event: CanonicalEvent<Record<string, unknown>>,
): ObservedState {
  const validation = validateEvent(event);
  if (!validation.valid)
    throw new ContractError(validation.error.code, validation.error.message, validation.error);
  const entity_kind = observedEntityKind(event);
  if (!entity_kind)
    throw new ContractError('PLANE_EVENT_UNSUPPORTED', 'Expected a supported Plane observation', {
      trace_id: event.trace_id,
    });
  const external_id = parseObservedRecordId(
    event.payload.external_id === undefined ? event.aggregate_id : event.payload.external_id,
  );
  const source_refs = event.source_refs.map((raw) => {
    const ref = validateSourceRef(raw);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
  return {
    schema_version: event.event_type === 'WorkItemDeleted' ? 2 : 1,
    ...(event.event_type === 'WorkItemDeleted' ? { deleted_at: event.occurred_at } : {}),
    ...(event.event_type === 'WorkItemRestored'
      ? {
          restored_from: parsePlaneRestoreReference(
            event.payload.restored_from,
            event.aggregate_version,
          ),
        }
      : {}),
    tenant_id: event.tenant_id,
    workspace_id: event.workspace_id,
    project_id: event.project_id ?? event.aggregate_id,
    entity_kind,
    external_id,
    aggregate_id: event.aggregate_id,
    authority: 'plane',
    plane_version: event.aggregate_version,
    observed_at: event.occurred_at,
    source_event_id: event.event_id,
    source_refs,
    ...(typeof event.payload.status === 'string' ? { status: event.payload.status } : {}),
    fields: structuredClone(event.payload),
  };
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
    const entityKind = observedEntityKind(event);
    if (!entityKind)
      return {
        status: 'rejected',
        effect_applied: false,
        error: new ContractError(
          'PLANE_EVENT_UNSUPPORTED',
          'This event does not describe an observed Plane project or work item',
          {
            trace_id: event.trace_id,
          },
        ).envelope,
      };
    return this.consumer.consume(event, (accepted) => {
      const state = buildPlaneObservedState(accepted as CanonicalEvent<Record<string, unknown>>);
      const externalId = state.external_id;
      const scope: ProjectionScope = {
        tenant_id: accepted.tenant_id,
        workspace_id: accepted.workspace_id,
        project_id: accepted.project_id ?? accepted.aggregate_id,
      };
      const previous = this.states.get(this.key(entityKind, accepted.aggregate_id, scope));
      if (
        state.restored_from &&
        (previous?.schema_version !== 2 ||
          previous.deleted_at === undefined ||
          previous.source_event_id !== state.restored_from.event_id ||
          previous.plane_version !== state.restored_from.aggregate_version ||
          previous.external_id !== state.external_id)
      )
        throw new ContractError(
          'PLANE_RESTORE_PRECONDITION_FAILED',
          'Restore requires the referenced deletion observation',
          { trace_id: accepted.trace_id },
        );
      if (
        previous?.deleted_at !== undefined &&
        state.deleted_at === undefined &&
        !state.restored_from
      )
        throw new ContractError(
          'PLANE_RECORD_DELETED',
          'A deleted observation requires an explicit restore protocol',
          { trace_id: accepted.trace_id },
        );
      const ref: ExternalRef = {
        ...scope,
        entity_kind: entityKind,
        external_id: externalId,
        internal_ref: `plane:${entityKind}:${externalId}`,
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
