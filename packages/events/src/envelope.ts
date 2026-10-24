import {
  ContractError,
  assertUlid,
  assertUtcTimestamp,
  type Classification,
  type ErrorEnvelope,
  type SourceRef,
  type Ulid,
} from '@planemem/contracts';

export const CANONICAL_EVENT_TYPES = [
  'ProjectCreated',
  'ProjectUpdated',
  'WorkItemCreated',
  'WorkItemUpdated',
  'WorkItemStatusProposed',
  'WorkItemStatusConfirmed',
  'PlanCreated',
  'PlanRevisionCreated',
  'DecisionRecorded',
  'RiskRaised',
  'RiskResolved',
  'ArtifactCreated',
  'ArtifactUpdated',
  'SessionStarted',
  'SessionEnded',
  'AgentRunStarted',
  'AgentRunCompleted',
  'ToolCallStarted',
  'ToolCallCompleted',
  'CheckpointCreated',
  'HandoffCreated',
  'HandoffAccepted',
  'ContextPackIssued',
  'ConflictDetected',
  'ConflictResolved',
  'ClientConnected',
  'ClientDisconnected',
  'PolicyDenied',
  'ApprovalRequested',
  'ApprovalCompleted',
] as const;

export type EventType = (typeof CANONICAL_EVENT_TYPES)[number];

export interface CanonicalEvent<T = Record<string, unknown>> {
  event_id: Ulid;
  event_type: EventType;
  schema_version: number;
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id?: Ulid;
  aggregate_type: string;
  aggregate_id: Ulid;
  aggregate_version: number;
  actor_id?: Ulid;
  client_id?: string;
  session_id?: Ulid;
  correlation_id?: Ulid;
  causation_id?: Ulid;
  occurred_at: string;
  trace_id: string;
  source_refs: SourceRef[];
  sensitivity: Classification;
  payload: T;
}

export type EventValidationResult<T = Record<string, unknown>> =
  | { valid: true; event: CanonicalEvent<T> }
  | { valid: false; error: ErrorEnvelope };

export type EventConsumerStatus = 'accepted' | 'duplicate' | 'out_of_order' | 'rejected';

export interface EventConsumerResult {
  status: EventConsumerStatus;
  event_id?: string;
  effect_applied: boolean;
  error?: ErrorEnvelope;
}

export class EventTypeRegistry {
  private readonly versions = new Map<string, number>();

  constructor() {
    for (const eventType of CANONICAL_EVENT_TYPES) {
      this.versions.set(eventType, 1);
    }
  }

  register(eventType: string, schemaVersion = 1): void {
    if (!/^[A-Z][A-Za-z0-9]+$/.test(eventType)) {
      throw new TypeError('Event type must be PascalCase');
    }
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      throw new RangeError('Event schema version must be a positive integer');
    }
    this.versions.set(eventType, schemaVersion);
  }

  has(eventType: string): boolean {
    return this.versions.has(eventType);
  }

  versionOf(eventType: string): number | undefined {
    return this.versions.get(eventType);
  }

  listTypes(): string[] {
    return [...this.versions.keys()];
  }
}

export function validateEvent<T = Record<string, unknown>>(
  input: unknown,
  registry = new EventTypeRegistry(),
): EventValidationResult<T> {
  const traceId = getTraceId(input);
  if (!isRecord(input)) {
    return invalid('EVENT_SCHEMA_VALIDATION_FAILED', traceId, {
      field_errors: ['$ must be an object'],
    });
  }
  const errors: string[] = [];
  const required = [
    'event_id',
    'event_type',
    'schema_version',
    'tenant_id',
    'workspace_id',
    'aggregate_type',
    'aggregate_id',
    'aggregate_version',
    'occurred_at',
    'trace_id',
    'source_refs',
    'sensitivity',
    'payload',
  ];
  for (const field of required) {
    if (!(field in input)) {
      errors.push(`${field} is required`);
    }
  }
  const eventType = input.event_type;
  if (typeof eventType !== 'string' || !registry.has(eventType)) {
    return invalid('EVENT_TYPE_UNSUPPORTED', traceId, { event_type: eventType });
  }
  const expectedVersion = registry.versionOf(eventType);
  if (input.schema_version !== expectedVersion) {
    return invalid('EVENT_SCHEMA_VERSION_UNSUPPORTED', traceId, {
      event_type: eventType,
      expected_version: expectedVersion,
      received_version: input.schema_version,
    });
  }
  if (errors.length > 0) {
    return invalid('EVENT_SCHEMA_VALIDATION_FAILED', traceId, { field_errors: errors });
  }
  try {
    assertUlid(input.event_id);
    assertUlid(input.tenant_id);
    assertUlid(input.workspace_id);
    if (input.project_id !== undefined) assertUlid(input.project_id);
    assertUlid(input.aggregate_id);
    if (input.actor_id !== undefined) assertUlid(input.actor_id);
    if (input.session_id !== undefined) assertUlid(input.session_id);
    if (input.correlation_id !== undefined) assertUlid(input.correlation_id);
    if (input.causation_id !== undefined) assertUlid(input.causation_id);
    if (typeof input.aggregate_type !== 'string' || input.aggregate_type.length === 0) {
      throw new TypeError('aggregate_type must be a non-empty string');
    }
    if (
      typeof input.aggregate_version !== 'number' ||
      !Number.isSafeInteger(input.aggregate_version) ||
      input.aggregate_version < 1
    ) {
      throw new TypeError('aggregate_version must be a positive integer');
    }
    assertUtcTimestamp(input.occurred_at);
    if (typeof input.trace_id !== 'string' || input.trace_id.length === 0) {
      throw new TypeError('trace_id must be a non-empty string');
    }
    validateSourceRefs(input.source_refs);
    if (!isClassification(input.sensitivity)) {
      throw new TypeError('sensitivity is invalid');
    }
    if (!isRecord(input.payload)) {
      throw new TypeError('payload must be an object');
    }
  } catch (error) {
    return invalid('EVENT_SCHEMA_VALIDATION_FAILED', traceId, {
      field_errors: [error instanceof Error ? error.message : 'invalid event'],
    });
  }
  return { valid: true, event: input as unknown as CanonicalEvent<T> };
}

export class EventConsumerLedger {
  private readonly seen = new Set<string>();
  private readonly aggregateVersions = new Map<string, number>();

  consume<T>(
    input: unknown,
    effect: (event: CanonicalEvent<T>) => void,
    registry?: EventTypeRegistry,
  ): EventConsumerResult {
    const result = validateEvent<T>(input, registry);
    if (!result.valid) {
      return { status: 'rejected', effect_applied: false, error: result.error };
    }
    const event = result.event;
    if (this.seen.has(event.event_id)) {
      return { status: 'duplicate', event_id: event.event_id, effect_applied: false };
    }
    const aggregateKey = `${event.aggregate_type}:${event.aggregate_id}`;
    const lastVersion = this.aggregateVersions.get(aggregateKey);
    if (lastVersion !== undefined && event.aggregate_version !== lastVersion + 1) {
      const code =
        event.aggregate_version > lastVersion
          ? 'AGGREGATE_VERSION_GAP'
          : 'AGGREGATE_VERSION_OUT_OF_ORDER';
      return {
        status: 'out_of_order',
        event_id: event.event_id,
        effect_applied: false,
        error: new ContractError(code, 'Aggregate version is not the next expected version', {
          aggregate_type: event.aggregate_type,
          aggregate_id: event.aggregate_id,
          expected_version: lastVersion + 1,
          received_version: event.aggregate_version,
          trace_id: event.trace_id,
          retryable: true,
        }).envelope,
      };
    }
    try {
      effect(event);
    } catch (error) {
      return {
        status: 'rejected',
        event_id: event.event_id,
        effect_applied: false,
        error: new ContractError(
          'EVENT_CONSUMER_FAILED',
          error instanceof Error ? error.message : 'Event consumer failed',
          { trace_id: event.trace_id, retryable: true },
        ).envelope,
      };
    }
    this.seen.add(event.event_id);
    this.aggregateVersions.set(aggregateKey, event.aggregate_version);
    return { status: 'accepted', event_id: event.event_id, effect_applied: true };
  }
}

function validateSourceRefs(value: unknown): asserts value is SourceRef[] {
  if (!Array.isArray(value)) {
    throw new TypeError('source_refs must be an array');
  }
  for (const ref of value) {
    if (
      !isRecord(ref) ||
      typeof ref.type !== 'string' ||
      ref.type.length === 0 ||
      typeof ref.id !== 'string' ||
      ref.id.length === 0
    ) {
      throw new TypeError('source_refs entries require type and id');
    }
  }
}

function invalid(
  code: string,
  traceId: string,
  details: Record<string, unknown>,
): EventValidationResult<never> {
  return {
    valid: false,
    error: new ContractError(code, 'Event failed schema validation', {
      ...details,
      trace_id: traceId,
      retryable: code === 'EVENT_SCHEMA_VERSION_UNSUPPORTED',
    }).envelope,
  };
}

function getTraceId(input: unknown): string {
  return isRecord(input) && typeof input.trace_id === 'string' && input.trace_id.length > 0
    ? input.trace_id
    : 'trace_unknown';
}

function isClassification(value: unknown): value is Classification {
  return (
    value === 'public' || value === 'internal' || value === 'confidential' || value === 'restricted'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
