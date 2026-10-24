import { assertUlid, type Ulid } from './ids.js';
import { parseEtag } from './versioning.js';

export type Classification = 'public' | 'internal' | 'confidential' | 'restricted';

export interface SourceRef {
  type: string;
  id: string;
  revision?: number;
  uri?: string;
}

export interface CommonMetadata {
  id: Ulid;
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id?: Ulid;
  version: number;
  etag: string;
  source_refs: SourceRef[];
  classification: Classification;
  created_at: string;
  updated_at: string;
  trace_id: string;
}

export interface RequestContext {
  trace_id: string;
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id?: Ulid;
  actor_id?: Ulid;
  client_id?: string;
  idempotency_key?: string;
  expected_version?: number;
  if_match?: string;
}

const CLASSIFICATIONS = new Set<Classification>([
  'public',
  'internal',
  'confidential',
  'restricted',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

export function assertUtcTimestamp(value: unknown): asserts value is string {
  assertString(value, 'UTC timestamp');
  if (!/Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('Timestamp must be a valid UTC ISO-8601 value ending in Z');
  }
}

function validateSourceRef(value: unknown): SourceRef {
  if (!isRecord(value)) {
    throw new TypeError('source_refs entries must be objects');
  }
  assertString(value.type, 'source_ref.type');
  assertString(value.id, 'source_ref.id');
  if (
    value.revision !== undefined &&
    (typeof value.revision !== 'number' ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0)
  ) {
    throw new TypeError('source_ref.revision must be a non-negative integer');
  }
  if (value.uri !== undefined) {
    assertString(value.uri, 'source_ref.uri');
  }
  return value as unknown as SourceRef;
}

function assertVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError('version must be a non-negative integer');
  }
}

export function validateCommonMetadata(input: unknown): CommonMetadata {
  if (!isRecord(input)) {
    throw new TypeError('Common metadata must be an object');
  }
  assertUlid(input.id);
  assertUlid(input.tenant_id);
  assertUlid(input.workspace_id);
  if (input.project_id !== undefined) {
    assertUlid(input.project_id);
  }
  assertVersion(input.version);
  assertString(input.etag, 'etag');
  if (parseEtag(input.etag) !== input.version) {
    throw new TypeError('etag version must match metadata version');
  }
  if (!Array.isArray(input.source_refs)) {
    throw new TypeError('source_refs must be an array');
  }
  const sourceRefs = input.source_refs.map(validateSourceRef);
  if (!CLASSIFICATIONS.has(input.classification as Classification)) {
    throw new TypeError('classification is invalid');
  }
  assertUtcTimestamp(input.created_at);
  assertUtcTimestamp(input.updated_at);
  assertString(input.trace_id, 'trace_id');
  return {
    id: input.id,
    tenant_id: input.tenant_id,
    workspace_id: input.workspace_id,
    ...(input.project_id === undefined ? {} : { project_id: input.project_id }),
    version: input.version,
    etag: input.etag,
    source_refs: sourceRefs,
    classification: input.classification as Classification,
    created_at: input.created_at,
    updated_at: input.updated_at,
    trace_id: input.trace_id,
  };
}

export function validateRequestContext(input: unknown): RequestContext {
  if (!isRecord(input)) {
    throw new TypeError('Request context must be an object');
  }
  assertString(input.trace_id, 'trace_id');
  assertUlid(input.tenant_id);
  assertUlid(input.workspace_id);
  if (input.project_id !== undefined) {
    assertUlid(input.project_id);
  }
  if (input.actor_id !== undefined) {
    assertUlid(input.actor_id);
  }
  if (input.client_id !== undefined) {
    assertString(input.client_id, 'client_id');
  }
  if (input.idempotency_key !== undefined) {
    validateIdempotencyKey(input.idempotency_key);
  }
  if (input.expected_version !== undefined) {
    assertVersion(input.expected_version);
  }
  if (input.if_match !== undefined) {
    parseEtag(input.if_match);
  }
  return input as unknown as RequestContext;
}

export function validateIdempotencyKey(key: unknown): string {
  assertString(key, 'Idempotency-Key');
  if (key.length > 255 || /\s/.test(key)) {
    throw new TypeError('Idempotency-Key must be 1-255 non-whitespace characters');
  }
  return key;
}
