import { isSyncIdentifier } from './sync.js';
import { isUlid } from './ids.js';
import { validateSourceRef, type SourceRef } from './metadata.js';

export const CONFLICT_READ_RESPONSE_BYTES = 2 * 1024 * 1024;
export const CONFLICT_READ_METADATA_BYTES = 16 * 1024;
export const CONFLICT_READ_ERROR_BYTES = 16 * 1024;
export interface ConflictReadQuery {
  conflict_id: string;
}
export interface ConflictReadScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}
export type ConflictValueState = 'recorded' | 'not-recorded';
export interface ConflictReadRecord {
  conflict_id: string;
  entity_type: string;
  entity_id: string;
  field: string;
  base_version: string;
  local_version: string;
  server_version: string;
  version: string;
  local_value_json: string | null;
  local_value_state: ConflictValueState;
  server_value_json: string | null;
  server_value_state: ConflictValueState;
  status: 'open' | 'resolved';
  decision_state: 'none' | 'recorded' | 'legacy';
  resolution: 'local' | 'server' | 'merge' | null;
  resolved_value_json: string | null;
  resolved_value_state: ConflictValueState;
  actor_id: string | null;
  resolved_at: string | null;
  resolved_by_client: string | null;
  resolution_event_id: string | null;
  trace_id: string;
  source_refs: SourceRef[];
}
export interface ConflictReadEnvelope {
  schema_version: 1;
  scope: ConflictReadScope;
  trace_id: string;
  source_refs: SourceRef[];
  data: ConflictReadRecord;
}
export class ConflictReadLimitError extends TypeError {
  constructor() {
    super('Complete conflict detail exceeds its read limit');
    this.name = 'ConflictReadLimitError';
  }
}
export function assertConflictReadBytes(value: unknown, maximum = CONFLICT_READ_RESPONSE_BYTES) {
  const raw = JSON.stringify(value);
  if (raw === undefined) throw new TypeError('Expected conflict JSON');
  if (new TextEncoder().encode(raw).byteLength > maximum) throw new ConflictReadLimitError();
}
export function parseConflictReadQuery(value: unknown): ConflictReadQuery {
  const row = object(value);
  only(row, ['conflict_id']);
  if (!isSyncIdentifier(row.conflict_id) || row.conflict_id === '.' || row.conflict_id === '..')
    throw new TypeError('Supply a conflict identifier');
  return { conflict_id: row.conflict_id };
}

/** A current stored snapshot, not an original command receipt or source-application proof. */
export function parseConflictReadEnvelope(
  value: unknown,
  input: ConflictReadQuery,
  scope: ConflictReadScope,
  trace: string,
): ConflictReadEnvelope {
  const query = parseConflictReadQuery(input);
  assertConflictReadBytes(value);
  const row = object(value);
  only(row, ['schema_version', 'scope', 'trace_id', 'source_refs', 'data']);
  if (row.schema_version !== 1 || text(row.trace_id) !== trace)
    throw new TypeError('Conflict trace differs');
  const returnedScope = object(row.scope);
  only(returnedScope, ['tenant_id', 'workspace_id', 'project_id']);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (text(returnedScope[field]) !== text(scope[field]))
      throw new TypeError('Conflict scope differs');
  if (!Array.isArray(row.source_refs) || row.source_refs.length !== 1)
    throw new TypeError('Invalid conflict source');
  const source = object(row.source_refs[0]);
  only(source, ['type', 'id']);
  if (source.type !== 'conflict' || source.id !== query.conflict_id)
    throw new TypeError('Conflict source differs');
  const data = object(row.data);
  only(data, [
    'conflict_id',
    'entity_type',
    'entity_id',
    'field',
    'base_version',
    'local_version',
    'server_version',
    'version',
    'local_value_json',
    'local_value_state',
    'server_value_json',
    'server_value_state',
    'status',
    'decision_state',
    'resolution',
    'resolved_value_json',
    'resolved_value_state',
    'actor_id',
    'resolved_at',
    'resolved_by_client',
    'resolution_event_id',
    'trace_id',
    'source_refs',
  ]);
  if (
    data.conflict_id !== query.conflict_id ||
    !isSyncIdentifier(data.entity_type) ||
    !isSyncIdentifier(data.entity_id) ||
    !isSyncIdentifier(data.field)
  )
    throw new TypeError('Invalid conflict target');
  if (data.status !== 'open' && data.status !== 'resolved')
    throw new TypeError('Invalid conflict status');
  if (data.resolution !== null && !['local', 'server', 'merge'].includes(data.resolution as string))
    throw new TypeError('Invalid decision');
  for (const name of ['local', 'server', 'resolved'] as const) {
    const state = data[`${name}_value_state`];
    if (
      (state !== 'recorded' && state !== 'not-recorded') ||
      (state === 'not-recorded' && data[`${name}_value_json`] !== null) ||
      (state === 'recorded' && typeof data[`${name}_value_json`] !== 'string')
    )
      throw new TypeError('Invalid conflict value availability');
  }
  const actor = nullableText(data.actor_id);
  const client = nullableText(data.resolved_by_client);
  const event = data.resolution_event_id;
  if (event !== null && !isUlid(event)) throw new TypeError('Invalid conflict event');
  const resolvedAt = data.resolved_at;
  if (
    resolvedAt !== null &&
    (typeof resolvedAt !== 'string' ||
      resolvedAt.length > 128 ||
      !Number.isFinite(Date.parse(resolvedAt)))
  )
    throw new TypeError('Invalid conflict decision time');
  if (data.status === 'open') {
    if (
      data.decision_state !== 'none' ||
      data.resolution !== null ||
      event !== null ||
      resolvedAt !== null ||
      client !== null ||
      data.resolved_value_state !== 'not-recorded'
    )
      throw new TypeError('Open conflict contains a decision');
  } else if (event !== null) {
    if (
      data.decision_state !== 'recorded' ||
      data.resolution === null ||
      actor === null ||
      client === null ||
      resolvedAt === null ||
      data.resolved_value_state !== 'recorded'
    )
      throw new TypeError('Incomplete persisted conflict decision');
  } else if (data.decision_state !== 'legacy')
    throw new TypeError('Legacy decision must be explicit');
  if (
    !Array.isArray(data.source_refs) ||
    Object.keys(data.source_refs).length !== data.source_refs.length
  )
    throw new TypeError('Invalid stored conflict sources');
  return {
    schema_version: 1,
    scope: {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
    },
    trace_id: trace,
    source_refs: [{ type: 'conflict', id: query.conflict_id }],
    data: {
      conflict_id: query.conflict_id,
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      field: data.field,
      base_version: parseConflictVersion(data.base_version),
      local_version: parseConflictVersion(data.local_version),
      server_version: parseConflictVersion(data.server_version),
      version: parseConflictVersion(data.version, true),
      local_value_json: jsonText(data.local_value_json),
      local_value_state: data.local_value_state as ConflictValueState,
      server_value_json: jsonText(data.server_value_json),
      server_value_state: data.server_value_state as ConflictValueState,
      status: data.status,
      decision_state: data.decision_state as ConflictReadRecord['decision_state'],
      resolution: data.resolution as ConflictReadRecord['resolution'],
      resolved_value_json: jsonText(data.resolved_value_json),
      resolved_value_state: data.resolved_value_state as ConflictValueState,
      actor_id: actor,
      resolved_at: resolvedAt as string | null,
      resolved_by_client: client,
      resolution_event_id: event,
      trace_id: text(data.trace_id),
      source_refs: data.source_refs.map((value: unknown) => {
        const source = validateSourceRef(value);
        if (Object.keys(source).some((key) => !['type', 'id', 'revision', 'uri'].includes(key)))
          throw new TypeError('Invalid stored conflict source fields');
        return {
          type: source.type,
          id: source.id,
          ...(source.revision === undefined ? {} : { revision: source.revision }),
          ...(source.uri === undefined ? {} : { uri: source.uri }),
        };
      }),
    },
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected conflict object');
  return value as Record<string, unknown>;
}
function only(row: Record<string, unknown>, fields: string[]) {
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  )
    throw new TypeError('Invalid conflict fields');
}
function text(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid conflict metadata');
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
export function parseConflictVersion(value: unknown, positive = false): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
    (positive && value === '0') ||
    (value.length === 19 && value > '9223372036854775807')
  )
    throw new TypeError('Invalid conflict version');
  return value;
}
function jsonText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError('Expected saved JSON text');
  // Validate JSON grammar, but retain the original text so large numeric tokens are not rounded.
  JSON.parse(value);
  return value;
}
