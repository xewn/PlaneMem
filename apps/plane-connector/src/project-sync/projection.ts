import {
  EventConsumerLedger,
  type CanonicalEvent,
  type EventConsumerResult,
} from '@planemem/events';

export interface ExternalRef {
  entity_kind: string;
  external_id: string;
  internal_ref: string;
}

export interface ObservedState {
  entity_kind: string;
  external_id: string;
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

  resolveExternalRef(entity_kind: string, external_id: string): ExternalRef | undefined {
    return this.refs.get(this.key(entity_kind, external_id));
  }

  applyPlaneEvent(event: CanonicalEvent<Record<string, unknown>>): EventConsumerResult {
    return this.consumer.consume(event, (accepted) => {
      const payload = accepted.payload as Record<string, unknown>;
      const entityKind = accepted.aggregate_type === 'project' ? 'Project' : 'WorkItem';
      const externalId =
        typeof payload.external_id === 'string' ? payload.external_id : accepted.aggregate_id;
      const ref: ExternalRef = {
        entity_kind: entityKind,
        external_id: externalId,
        internal_ref: `plane:${entityKind}:${externalId}`,
      };
      this.refs.set(this.key(entityKind, externalId), ref);
      this.states.set(this.key(entityKind, externalId), {
        entity_kind: entityKind,
        external_id: externalId,
        authority: 'plane',
        plane_version: accepted.aggregate_version,
        observed_at: accepted.occurred_at,
        source_event_id: accepted.event_id,
        source_refs: accepted.source_refs.map((source) => ({ type: source.type, id: source.id })),
        ...(typeof payload.status === 'string' ? { status: payload.status } : {}),
        fields: { ...payload },
      });
    });
  }

  getObservedState(entity_kind: string, external_id: string): ObservedState | undefined {
    return this.states.get(this.key(entity_kind, external_id));
  }

  private key(entity_kind: string, external_id: string): string {
    return `${entity_kind}:${external_id}`;
  }
}
