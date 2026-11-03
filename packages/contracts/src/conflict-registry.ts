import { isSyncIdentifier } from './sync.js';
import {
  parseConflictReadQuery,
  parseConflictVersion,
  assertConflictReadBytes,
  type ConflictReadRecord,
  type ConflictReadScope,
} from './conflict-read.js';

export const CONFLICT_REGISTRY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const CONFLICT_REGISTRY_RECORD_BYTES = 16 * 1024;
export interface ConflictRegistryQuery {
  query?: string;
  status?: 'open' | 'resolved';
  entity_type?: string;
  conflict_id?: string;
  limit?: number;
  cursor?: string;
}
export type ConflictRegistryRecord = Pick<
  ConflictReadRecord,
  | 'conflict_id'
  | 'entity_type'
  | 'entity_id'
  | 'field'
  | 'base_version'
  | 'local_version'
  | 'server_version'
  | 'version'
  | 'status'
  | 'resolution'
  | 'actor_id'
  | 'trace_id'
>;
export interface ConflictRegistryPage {
  data: ConflictRegistryRecord[];
  has_more: boolean;
  next_cursor?: string;
}
export interface ConflictRegistryEnvelope extends ConflictRegistryPage {
  schema_version: 1;
  scope: ConflictReadScope;
  trace_id: string;
  source_refs: { type: string; id: string }[];
  conflict_permissions: { resolve: boolean };
}
const fields = [
  'conflict_id',
  'entity_type',
  'entity_id',
  'field',
  'base_version',
  'local_version',
  'server_version',
  'version',
  'status',
  'resolution',
  'actor_id',
  'trace_id',
];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected conflict registry object');
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new TypeError('Unknown conflict registry field');
}
function text(value: unknown, max = 1024): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid conflict metadata');
  return value;
}
export function foldConflictQuery(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
/** Unicode scalar order matches PostgreSQL UTF-8 text COLLATE C, including non-BMP IDs. */
export function compareConflictIds(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const delta = a[i]!.codePointAt(0)! - b[i]!.codePointAt(0)!;
    if (delta) return delta;
  }
  return a.length - b.length;
}
export function parseConflictRegistryQuery(value: unknown): ConflictRegistryQuery {
  const row = object(value);
  only(row, ['query', 'status', 'entity_type', 'conflict_id', 'limit', 'cursor']);
  const query: ConflictRegistryQuery = {};
  if (row.query !== undefined) {
    if (
      typeof row.query !== 'string' ||
      row.query.length > 500 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(row.query)
    )
      throw new TypeError('Invalid conflict search');
    if (row.query.trim()) query.query = row.query.trim();
  }
  if (row.status !== undefined && row.status !== '') {
    if (row.status !== 'open' && row.status !== 'resolved')
      throw new TypeError('Invalid conflict status');
    query.status = row.status;
  }
  if (row.entity_type !== undefined && row.entity_type !== '') {
    if (!isSyncIdentifier(row.entity_type)) throw new TypeError('Invalid conflict entity type');
    query.entity_type = row.entity_type;
  }
  if (row.conflict_id !== undefined)
    query.conflict_id = parseConflictReadQuery({ conflict_id: row.conflict_id }).conflict_id;
  if (row.limit !== undefined) {
    if (
      typeof row.limit !== 'number' ||
      !Number.isSafeInteger(row.limit) ||
      row.limit < 1 ||
      row.limit > 100
    )
      throw new TypeError('Conflict page limit must be 1..100');
    query.limit = row.limit;
  }
  if (row.cursor !== undefined) {
    parseConflictRegistryCursor(row.cursor);
    query.cursor = row.cursor as string;
  }
  return query;
}
export function encodeConflictRegistryCursor(key: string, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Invalid conflict cursor binding');
  const conflict_id = parseConflictReadQuery({ conflict_id: id }).conflict_id;
  const bytes = new TextEncoder().encode(JSON.stringify([1, key, conflict_id]));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function parseConflictRegistryCursor(value: unknown): { key: string; conflict_id: string } {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(value))
    throw new TypeError('Invalid conflict cursor');
  const encoded = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(
    atob(encoded + '='.repeat((4 - (encoded.length % 4)) % 4)),
    (char) => char.charCodeAt(0),
  );
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    parsed[0] !== 1 ||
    typeof parsed[1] !== 'string' ||
    typeof parsed[2] !== 'string' ||
    encodeConflictRegistryCursor(parsed[1], parsed[2]) !== value
  )
    throw new TypeError('Invalid conflict cursor');
  return { key: parsed[1], conflict_id: parsed[2] };
}
export function parseConflictRegistryRecord(value: unknown): ConflictRegistryRecord {
  assertConflictReadBytes(value, CONFLICT_REGISTRY_RECORD_BYTES);
  const row = object(value);
  only(row, fields);
  if (
    fields.some((field) => !Object.hasOwn(row, field)) ||
    !isSyncIdentifier(row.entity_type) ||
    !isSyncIdentifier(row.entity_id) ||
    !isSyncIdentifier(row.field) ||
    (row.status !== 'open' && row.status !== 'resolved') ||
    (row.resolution !== null && !['local', 'server', 'merge'].includes(row.resolution as string)) ||
    (row.status === 'open' && row.resolution !== null)
  )
    throw new TypeError('Invalid conflict registry entry');
  return {
    conflict_id: parseConflictReadQuery({ conflict_id: row.conflict_id }).conflict_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    field: row.field,
    status: row.status,
    base_version: parseConflictVersion(row.base_version),
    local_version: parseConflictVersion(row.local_version),
    server_version: parseConflictVersion(row.server_version),
    version: parseConflictVersion(row.version, true),
    resolution: row.resolution as ConflictRegistryRecord['resolution'],
    actor_id: row.actor_id === null ? null : text(row.actor_id),
    trace_id: text(row.trace_id),
  };
}
export function parseConflictRegistryPage(
  value: unknown,
  input: ConflictRegistryQuery,
): ConflictRegistryPage {
  const query = parseConflictRegistryQuery(input);
  const row = object(value);
  const limit = query.limit ?? 25;
  assertConflictReadBytes(value, CONFLICT_REGISTRY_RESPONSE_BYTES);
  if (
    !Array.isArray(row.data) ||
    Object.keys(row.data).length !== row.data.length ||
    row.data.length > limit ||
    typeof row.has_more !== 'boolean' ||
    (query.conflict_id !== undefined && row.has_more)
  )
    throw new TypeError('Invalid conflict page');
  const before = query.cursor === undefined ? undefined : parseConflictRegistryCursor(query.cursor);
  let previous = before?.conflict_id;
  const data = Array.from(row.data, (raw: unknown) => {
    const item = parseConflictRegistryRecord(raw);
    if (
      (previous !== undefined && compareConflictIds(previous, item.conflict_id) >= 0) ||
      (query.conflict_id !== undefined && item.conflict_id !== query.conflict_id) ||
      (query.status !== undefined && item.status !== query.status) ||
      (query.entity_type !== undefined && item.entity_type !== query.entity_type) ||
      (query.query !== undefined &&
        ![
          item.conflict_id,
          item.entity_type,
          item.entity_id,
          item.field,
          item.actor_id ?? '',
          item.trace_id,
        ].some((field) => foldConflictQuery(field).includes(foldConflictQuery(query.query!))))
    )
      throw new TypeError('Conflict entry does not match the requested position or filters');
    previous = item.conflict_id;
    return item;
  });
  if (!row.has_more) {
    if (row.next_cursor !== undefined) throw new TypeError('Unexpected conflict cursor');
    return { data, has_more: false };
  }
  const next = parseConflictRegistryCursor(row.next_cursor);
  if (
    data.length !== limit ||
    next.conflict_id !== data.at(-1)?.conflict_id ||
    row.next_cursor === query.cursor ||
    (before && before.key !== next.key)
  )
    throw new TypeError('Invalid conflict continuation');
  return { data, has_more: true, next_cursor: row.next_cursor as string };
}
export function parseConflictRegistryEnvelope(
  value: unknown,
  query: ConflictRegistryQuery,
  scope: ConflictReadScope,
  trace: string,
): ConflictRegistryEnvelope {
  const row = object(value);
  only(row, [
    'schema_version',
    'scope',
    'trace_id',
    'source_refs',
    'data',
    'has_more',
    'next_cursor',
    'conflict_permissions',
  ]);
  if (row.schema_version !== 1 || text(row.trace_id) !== trace)
    throw new TypeError('Conflict registry trace differs');
  const returned = object(row.scope);
  only(returned, ['tenant_id', 'workspace_id', 'project_id']);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (text(returned[field]) !== text(scope[field]))
      throw new TypeError('Conflict registry scope differs');
  if (!Array.isArray(row.source_refs) || row.source_refs.length !== 1)
    throw new TypeError('Invalid conflict registry sources');
  const source = object(row.source_refs[0]);
  only(source, ['type', 'id']);
  if (source.type !== 'postgres' || source.id !== 'wcp_conflicts')
    throw new TypeError('Invalid conflict registry source');
  const permissions = object(row.conflict_permissions);
  only(permissions, ['resolve']);
  if (typeof permissions.resolve !== 'boolean')
    throw new TypeError('Invalid conflict permission hint');
  return {
    schema_version: 1,
    scope: {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
    },
    trace_id: trace,
    source_refs: [{ type: 'postgres', id: 'wcp_conflicts' }],
    ...parseConflictRegistryPage(row, query),
    conflict_permissions: { resolve: permissions.resolve },
  };
}
