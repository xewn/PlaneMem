import { ContractError, type ErrorEnvelope } from './errors.js';
import type { CommonMetadata } from './metadata.js';
import type { Ulid } from './ids.js';
import { validateCommonMetadata } from './metadata.js';

export const ENTITY_KINDS = [
  'Tenant',
  'Project',
  'WorkItem',
  'Session',
  'Checkpoint',
  'Handoff',
  'ContextPack',
  'Artifact',
  'Decision',
  'Risk',
  'Conflict',
  'Approval',
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntityBase extends CommonMetadata {
  schema_version: 1;
}

export interface ProjectScopedEntity extends EntityBase {
  project_id: Ulid;
}

export interface TenantEntity extends EntityBase {
  name: string;
  status: 'active' | 'suspended' | 'archived';
}

export interface ProjectEntity extends ProjectScopedEntity {
  title: string;
  status: 'active' | 'archived';
  external_id: string;
}

export interface WorkItemEntity extends ProjectScopedEntity {
  title: string;
  status: 'proposed' | 'observed' | 'verified' | 'blocked' | 'done';
  external_id: string;
}

export interface SessionEntity extends ProjectScopedEntity {
  client_id: string;
  status: 'active' | 'ended' | 'abandoned';
}

export interface CheckpointEntity extends ProjectScopedEntity {
  session_id: Ulid;
  summary: string;
  state_hash: string;
}

export interface HandoffEntity extends ProjectScopedEntity {
  session_id: Ulid;
  checkpoint_id: Ulid;
  status: 'offered' | 'accepted' | 'expired' | 'rejected';
}

export interface ContextPackEntity extends ProjectScopedEntity {
  pack_hash: string;
  budget_tokens: number;
  sections: Record<string, unknown>[];
}

export interface ArtifactEntity extends ProjectScopedEntity {
  name: string;
  media_type: string;
  sha256: string;
  size_bytes: number;
  uri: string;
}

export interface DecisionEntity extends ProjectScopedEntity {
  title: string;
  decision: string;
  status: 'proposed' | 'accepted' | 'superseded';
}

export interface RiskEntity extends ProjectScopedEntity {
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'mitigated' | 'accepted' | 'closed';
}

export interface ConflictEntity extends ProjectScopedEntity {
  entity_type: string;
  entity_id: Ulid;
  expected_version: number;
  current_version: number;
  status: 'open' | 'resolved' | 'dismissed';
}

export interface ApprovalEntity extends ProjectScopedEntity {
  target_type: string;
  target_id: Ulid;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

export interface EntityPayloadMap {
  Tenant: TenantEntity;
  Project: ProjectEntity;
  WorkItem: WorkItemEntity;
  Session: SessionEntity;
  Checkpoint: CheckpointEntity;
  Handoff: HandoffEntity;
  ContextPack: ContextPackEntity;
  Artifact: ArtifactEntity;
  Decision: DecisionEntity;
  Risk: RiskEntity;
  Conflict: ConflictEntity;
  Approval: ApprovalEntity;
}

export type EntityPayload<K extends EntityKind> = EntityPayloadMap[K];
type PropertyType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';

export interface EntitySchemaProperty {
  type: PropertyType;
  pattern?: string;
  minLength?: number;
  minimum?: number;
  enum?: readonly string[];
  items?: EntitySchemaProperty;
  properties?: Record<string, EntitySchemaProperty>;
  required?: readonly string[];
}

export interface EntitySchema {
  $id: string;
  title: string;
  schema_version: number;
  type: 'object';
  required: readonly string[];
  properties: Record<string, EntitySchemaProperty>;
  additionalProperties: false;
}

const ulid: EntitySchemaProperty = {
  type: 'string',
  pattern: '^[0-9A-HJKMNP-TV-Z]{26}$',
};
const nonEmptyString: EntitySchemaProperty = { type: 'string', minLength: 1 };
const version: EntitySchemaProperty = { type: 'integer', minimum: 0 };
const classification: EntitySchemaProperty = {
  type: 'string',
  enum: ['public', 'internal', 'confidential', 'restricted'],
};
const sourceRefs: EntitySchemaProperty = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      type: nonEmptyString,
      id: nonEmptyString,
      revision: version,
      uri: nonEmptyString,
    },
    required: ['type', 'id'],
  },
};

const COMMON_PROPERTIES: Record<string, EntitySchemaProperty> = {
  schema_version: version,
  id: ulid,
  tenant_id: ulid,
  workspace_id: ulid,
  version,
  etag: { type: 'string', pattern: '^W/"version-[0-9]+"$' },
  source_refs: sourceRefs,
  classification,
  created_at: { type: 'string', pattern: '^.+Z$' },
  updated_at: { type: 'string', pattern: '^.+Z$' },
  trace_id: nonEmptyString,
};

const COMMON_REQUIRED = [
  'schema_version',
  'id',
  'tenant_id',
  'workspace_id',
  'version',
  'etag',
  'source_refs',
  'classification',
  'created_at',
  'updated_at',
  'trace_id',
] as const;

function makeSchema(
  kind: EntityKind,
  fields: Record<string, EntitySchemaProperty>,
  projectScoped = true,
): EntitySchema {
  const properties = {
    ...COMMON_PROPERTIES,
    ...(projectScoped ? { project_id: ulid } : {}),
    ...fields,
  };
  return {
    $id: `https://planemem.local/schemas/entities/${kind}.json`,
    title: `${kind} entity`,
    schema_version: 1,
    type: 'object',
    required: [
      ...COMMON_REQUIRED,
      ...(projectScoped ? ['project_id'] : []),
      ...Object.keys(fields),
    ],
    properties,
    additionalProperties: false,
  };
}

export const ENTITY_SCHEMAS: Record<EntityKind, EntitySchema> = {
  Tenant: makeSchema(
    'Tenant',
    {
      name: nonEmptyString,
      status: { type: 'string', enum: ['active', 'suspended', 'archived'] },
    },
    false,
  ),
  Project: makeSchema('Project', {
    title: nonEmptyString,
    status: { type: 'string', enum: ['active', 'archived'] },
    external_id: nonEmptyString,
  }),
  WorkItem: makeSchema('WorkItem', {
    title: nonEmptyString,
    status: { type: 'string', enum: ['proposed', 'observed', 'verified', 'blocked', 'done'] },
    external_id: nonEmptyString,
  }),
  Session: makeSchema('Session', {
    client_id: nonEmptyString,
    status: { type: 'string', enum: ['active', 'ended', 'abandoned'] },
  }),
  Checkpoint: makeSchema('Checkpoint', {
    session_id: ulid,
    summary: nonEmptyString,
    state_hash: nonEmptyString,
  }),
  Handoff: makeSchema('Handoff', {
    session_id: ulid,
    checkpoint_id: ulid,
    status: { type: 'string', enum: ['offered', 'accepted', 'expired', 'rejected'] },
  }),
  ContextPack: makeSchema('ContextPack', {
    pack_hash: nonEmptyString,
    budget_tokens: { type: 'integer', minimum: 1 },
    sections: { type: 'array', items: { type: 'object' } },
  }),
  Artifact: makeSchema('Artifact', {
    name: nonEmptyString,
    media_type: nonEmptyString,
    sha256: nonEmptyString,
    size_bytes: { type: 'integer', minimum: 0 },
    uri: nonEmptyString,
  }),
  Decision: makeSchema('Decision', {
    title: nonEmptyString,
    decision: nonEmptyString,
    status: { type: 'string', enum: ['proposed', 'accepted', 'superseded'] },
  }),
  Risk: makeSchema('Risk', {
    title: nonEmptyString,
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    status: { type: 'string', enum: ['open', 'mitigated', 'accepted', 'closed'] },
  }),
  Conflict: makeSchema('Conflict', {
    entity_type: nonEmptyString,
    entity_id: ulid,
    expected_version: version,
    current_version: version,
    status: { type: 'string', enum: ['open', 'resolved', 'dismissed'] },
  }),
  Approval: makeSchema('Approval', {
    target_type: nonEmptyString,
    target_id: ulid,
    status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'expired'] },
  }),
};

export type EntityValidationSuccess = {
  valid: true;
  kind: EntityKind;
  schema_version: number;
  data: Record<string, unknown>;
};

export type EntityValidationFailure = {
  valid: false;
  kind: string;
  error: ErrorEnvelope;
};

export type EntityValidationResult = EntityValidationSuccess | EntityValidationFailure;

export class EntitySchemaRegistry {
  constructor(private readonly schemas: Record<EntityKind, EntitySchema> = ENTITY_SCHEMAS) {}

  listKinds(): EntityKind[] {
    return [...ENTITY_KINDS];
  }

  getSchema(kind: EntityKind): EntitySchema {
    const schema = this.schemas[kind];
    if (!schema) {
      throw new ContractError('ENTITY_KIND_UNSUPPORTED', `Unsupported entity kind: ${kind}`, {
        kind,
        retryable: false,
      });
    }
    return schema;
  }

  validateEntity(kind: string, payload: unknown): EntityValidationResult {
    const schema = this.schemas[kind as EntityKind];
    if (!schema) {
      return {
        valid: false,
        kind,
        error: errorEnvelope('ENTITY_KIND_UNSUPPORTED', kind, payload, { kind }),
      };
    }
    const fieldErrors: string[] = [];
    if (!isRecord(payload)) {
      fieldErrors.push('$ must be an object');
    } else {
      for (const required of schema.required) {
        if (!(required in payload)) {
          fieldErrors.push(`${required} is required`);
        }
      }
      for (const key of Object.keys(payload)) {
        if (!(key in schema.properties)) {
          fieldErrors.push(`${key} is not allowed`);
          continue;
        }
        validateProperty(payload[key], schema.properties[key], key, fieldErrors);
      }
      if (payload.schema_version !== schema.schema_version) {
        fieldErrors.push(`schema_version must be ${schema.schema_version}`);
      }
      try {
        validateCommonMetadata(payload);
      } catch (error) {
        fieldErrors.push(error instanceof Error ? error.message : 'invalid common metadata');
      }
    }
    if (fieldErrors.length > 0) {
      return {
        valid: false,
        kind,
        error: errorEnvelope('ENTITY_SCHEMA_VALIDATION_FAILED', kind, payload, {
          kind,
          field_errors: fieldErrors,
        }),
      };
    }
    return {
      valid: true,
      kind: kind as EntityKind,
      schema_version: schema.schema_version,
      data: payload as Record<string, unknown>,
    };
  }
}

const defaultRegistry = new EntitySchemaRegistry();

export function validateEntity(kind: string, payload: unknown): EntityValidationResult {
  return defaultRegistry.validateEntity(kind, payload);
}

export function assertEntity<T extends Record<string, unknown>>(
  kind: EntityKind,
  payload: unknown,
): T {
  const result = defaultRegistry.validateEntity(kind, payload);
  if (!result.valid) {
    throw new ContractError(result.error.code, result.error.message, {
      ...result.error.details,
      trace_id: result.error.trace_id,
      retryable: result.error.retryable,
    });
  }
  return result.data as T;
}

function errorEnvelope(
  code: string,
  kind: string,
  payload: unknown,
  details: Record<string, unknown>,
): ErrorEnvelope {
  const traceId =
    isRecord(payload) && typeof payload.trace_id === 'string' && payload.trace_id.length > 0
      ? payload.trace_id
      : 'trace_unknown';
  return new ContractError(code, `Entity ${kind} failed schema validation`, {
    ...details,
    trace_id: traceId,
    retryable: false,
  }).envelope;
}

function validateProperty(
  value: unknown,
  property: EntitySchemaProperty | undefined,
  path: string,
  errors: string[],
): void {
  if (!property) {
    errors.push(`${path} has no schema`);
    return;
  }
  const validType =
    property.type === 'array'
      ? Array.isArray(value)
      : property.type === 'object'
        ? isRecord(value)
        : property.type === 'integer'
          ? typeof value === 'number' && Number.isSafeInteger(value)
          : typeof value === property.type;
  if (!validType) {
    errors.push(`${path} must be ${property.type}`);
    return;
  }
  if (property.type === 'string') {
    if (property.minLength !== undefined && (value as string).length < property.minLength) {
      errors.push(`${path} must not be empty`);
    }
    if (property.pattern !== undefined && !new RegExp(property.pattern).test(value as string)) {
      errors.push(`${path} has an invalid format`);
    }
    if (property.enum !== undefined && !property.enum.includes(value as string)) {
      errors.push(`${path} has an invalid enum value`);
    }
  }
  if (
    (property.type === 'integer' || property.type === 'number') &&
    (!Number.isFinite(value) ||
      (property.type === 'integer' && !Number.isSafeInteger(value)) ||
      (property.minimum !== undefined && (value as number) < property.minimum))
  ) {
    errors.push(`${path} has an invalid numeric value`);
  }
  if (property.type === 'array' && property.items !== undefined) {
    (value as unknown[]).forEach((item, index) =>
      validateProperty(item, property.items, `${path}[${index}]`, errors),
    );
  }
  if (property.type === 'object' && property.properties !== undefined && isRecord(value)) {
    for (const required of property.required ?? []) {
      if (!(required in value)) {
        errors.push(`${path}.${required} is required`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key in property.properties) {
        validateProperty(child, property.properties[key], `${path}.${key}`, errors);
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
