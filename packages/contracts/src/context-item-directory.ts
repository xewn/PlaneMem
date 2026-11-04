import { isUlid } from './ids.js';
import { isSyncIdentifier } from './sync.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import { validateSourceRef, type SourceRef } from './metadata.js';
import {
  parseContextItemListQuery,
  type ContextItemListQuery,
  type ContextItemDocument,
} from './context-items.js';

export const CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const CONTEXT_ITEM_DIRECTORY_ERROR_BYTES = 16 * 1024;
export type ContextItemDirectoryQuery = ContextItemListQuery & { archived: boolean; limit: number };
export type ContextItemDirectoryRecord = Pick<
  ContextItemDocument,
  | 'id'
  | 'title'
  | 'item_type'
  | 'layer'
  | 'classification'
  | 'status'
  | 'source_ref'
  | 'expires_at'
  | 'confidence'
  | 'priority'
  | 'content'
  | 'source_refs'
  | 'trace_id'
  | 'updated_at'
  | 'version'
> & { archived_at: string | null };
export interface ContextItemDirectoryScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}
export interface ContextItemDirectoryPosition {
  rank: number;
  updated: string;
  id: string;
}
export interface ContextItemDirectoryEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  scope: ContextItemDirectoryScope;
  query: ContextItemDirectoryQuery;
  data: ContextItemDirectoryRecord[];
  next_cursor?: string;
  context_permissions: { compile: boolean; write: boolean; restricted: boolean; propose: boolean };
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected context directory fields');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !fields.includes(key)))
    throw new TypeError('Unknown context directory field');
  return row;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000\p{Cs}]/u.test(value))
    throw new TypeError('Invalid context directory text');
  return value;
}
function identifier(value: unknown): string {
  if (!isSyncIdentifier(value) || value === '.' || value === '..')
    throw new TypeError('Invalid context directory ID');
  return value;
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) ||
    value.startsWith('0000') ||
    new Date(value.slice(0, 23) + 'Z').toISOString() !== value.slice(0, 23) + 'Z'
  )
    throw new TypeError('Invalid context directory timestamp');
  return value;
}
function refs(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) throw new TypeError('Expected complete context sources');
  return value.map((raw: unknown) => {
    const ref = validateSourceRef(object(raw, ['type', 'id', 'revision', 'uri']));
    return {
      type: text(ref.type),
      id: text(ref.id),
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: text(ref.uri) }),
    };
  });
}
export function parseContextItemDirectoryQuery(value: unknown): ContextItemDirectoryQuery {
  const input = parseContextItemListQuery(JSON.parse(syncJsonSnapshot(value, 8192)));
  if (input.cursor !== undefined) parseContextItemDirectoryCursor(input.cursor);
  return {
    ...(input.query === undefined ? {} : { query: input.query }),
    ...(input.layer === undefined ? {} : { layer: input.layer }),
    ...(input.classification === undefined ? {} : { classification: input.classification }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.item_type === undefined ? {} : { item_type: input.item_type }),
    archived: input.archived === true,
    limit: input.limit ?? 25,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}
function position(value: ContextItemDirectoryPosition): ContextItemDirectoryPosition {
  if (![0, 1, 2].includes(value.rank)) throw new TypeError('Invalid context priority position');
  return { rank: value.rank, updated: timestamp(value.updated), id: identifier(value.id) };
}
export function contextItemDirectoryPosition(
  item: ContextItemDirectoryRecord,
): ContextItemDirectoryPosition {
  return position({
    rank: ['High', 'Medium', 'Low'].indexOf(item.priority),
    updated: item.updated_at,
    id: item.id,
  });
}
export function encodeContextItemDirectoryCursor(
  key: string,
  value: ContextItemDirectoryPosition,
): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Invalid context query binding');
  const item = position(value);
  const bytes = new TextEncoder().encode(
    JSON.stringify([2, key, item.rank, item.updated, item.id]),
  );
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function parseContextItemDirectoryCursor(
  value: unknown,
): ContextItemDirectoryPosition & { key: string } {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(value))
    throw new TypeError('Invalid context cursor');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const raw: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    ),
  );
  if (
    !Array.isArray(raw) ||
    raw.length !== 5 ||
    raw[0] !== 2 ||
    typeof raw[1] !== 'string' ||
    typeof raw[2] !== 'number' ||
    typeof raw[3] !== 'string' ||
    typeof raw[4] !== 'string'
  )
    throw new TypeError('Restart context browsing with a current cursor');
  const result = position({ rank: raw[2], updated: raw[3], id: raw[4] });
  if (encodeContextItemDirectoryCursor(raw[1], result) !== value)
    throw new TypeError('Noncanonical context cursor');
  return { ...result, key: raw[1] };
}
function compareIds(left: string, right: string) {
  const a = Array.from(left),
    b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}
function compare(left: ContextItemDirectoryPosition, right: ContextItemDirectoryPosition) {
  return (
    left.rank - right.rank ||
    (left.updated === right.updated
      ? compareIds(left.id, right.id)
      : left.updated > right.updated
        ? -1
        : 1)
  );
}
function item(value: unknown): ContextItemDirectoryRecord {
  const row = object(value, [
    'id',
    'title',
    'item_type',
    'layer',
    'classification',
    'status',
    'source_ref',
    'expires_at',
    'confidence',
    'priority',
    'content',
    'source_refs',
    'trace_id',
    'updated_at',
    'version',
    'archived_at',
  ]);
  if (
    !Object.hasOwn(row, 'content') ||
    !['L0', 'L1', 'L2', 'L3', 'L4'].includes(row.layer as string) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(row.classification as string) ||
    !['confirmed', 'proposed', 'expired', 'excluded'].includes(row.status as string) ||
    !['High', 'Medium', 'Low'].includes(row.priority as string) ||
    typeof row.version !== 'number' ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    typeof row.confidence !== 'number' ||
    !Number.isFinite(row.confidence) ||
    row.confidence < 0 ||
    row.confidence > 1
  )
    throw new TypeError('Invalid context directory record');
  return {
    ...row,
    id: identifier(row.id),
    title: text(row.title),
    item_type: text(row.item_type),
    source_ref: text(row.source_ref),
    trace_id: identifier(row.trace_id),
    updated_at: timestamp(row.updated_at),
    expires_at: row.expires_at === null ? null : timestamp(row.expires_at),
    archived_at: row.archived_at === null ? null : timestamp(row.archived_at),
    source_refs: refs(row.source_refs),
  } as ContextItemDirectoryRecord;
}
export function parseContextItemDirectoryPage(
  value: unknown,
  input: ContextItemListQuery,
): { data: ContextItemDirectoryRecord[]; next_cursor?: string } {
  const query = parseContextItemDirectoryQuery(input);
  const row = object(JSON.parse(syncJsonSnapshot(value, CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES)), [
    'data',
    'next_cursor',
  ]);
  if (!Array.isArray(row.data) || row.data.length > query.limit)
    throw new TypeError('Invalid context page length');
  const data = row.data.map(item);
  const seen = new Set<string>();
  const after =
    query.cursor === undefined ? undefined : parseContextItemDirectoryCursor(query.cursor);
  let previous: ContextItemDirectoryPosition | undefined = after;
  for (const entry of data) {
    const current = contextItemDirectoryPosition(entry);
    if (
      seen.has(entry.id) ||
      (previous && compare(previous, current) >= 0) ||
      (entry.archived_at !== null) !== query.archived ||
      (query.archived && entry.status !== 'excluded')
    )
      throw new TypeError('Context page position or archive view differs');
    // Text search uses PostgreSQL lower/JSONB rendering; its exact query is echoed separately.
    for (const field of ['layer', 'classification', 'status', 'item_type'] as const)
      if (query[field] !== undefined && entry[field] !== query[field])
        throw new TypeError('Context page filter differs');
    seen.add(entry.id);
    previous = current;
  }
  if (row.next_cursor !== undefined) {
    const next = parseContextItemDirectoryCursor(row.next_cursor);
    if (
      data.length !== query.limit ||
      !previous ||
      compare(previous, next) !== 0 ||
      (after && after.key !== next.key)
    )
      throw new TypeError('Context continuation differs from the complete page');
    return { data, next_cursor: row.next_cursor as string };
  }
  return { data };
}
export function parseContextItemDirectoryEnvelope(
  value: unknown,
  input: ContextItemListQuery,
  scope: ContextItemDirectoryScope,
  trace: string,
): ContextItemDirectoryEnvelope {
  const query = parseContextItemDirectoryQuery(input);
  const row = object(JSON.parse(syncJsonSnapshot(value, CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'scope',
    'query',
    'data',
    'next_cursor',
    'context_permissions',
  ]);
  if (row.schema_version !== 1 || !isSyncIdentifier(trace) || row.trace_id !== trace)
    throw new TypeError('Context directory trace differs');
  const actualScope = object(row.scope, ['tenant_id', 'workspace_id', 'project_id']);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isUlid(scope[field]) || actualScope[field] !== scope[field])
      throw new TypeError('Context directory scope differs');
  const echoed = object(row.query, [
    'query',
    'layer',
    'classification',
    'status',
    'item_type',
    'archived',
    'limit',
    'cursor',
  ]);
  if (
    Object.keys(echoed).length !== Object.keys(query).length ||
    Object.entries(query).some(([field, value]) => echoed[field] !== value)
  )
    throw new TypeError('Context directory query differs');
  const source_refs = refs(row.source_refs);
  if (
    JSON.stringify(source_refs) !== JSON.stringify([{ type: 'postgres', id: 'wcp_context_items' }])
  )
    throw new TypeError('Context directory source differs');
  const permissions = object(row.context_permissions, [
    'compile',
    'write',
    'restricted',
    'propose',
  ]);
  for (const field of ['compile', 'write', 'restricted', 'propose'])
    if (typeof permissions[field] !== 'boolean')
      throw new TypeError('Invalid context permission hints');
  const page = parseContextItemDirectoryPage(
    { data: row.data, ...(row.next_cursor === undefined ? {} : { next_cursor: row.next_cursor }) },
    query,
  );
  if (!permissions.restricted && page.data.some((entry) => entry.classification === 'restricted'))
    throw new TypeError('Unexpected restricted context');
  return {
    schema_version: 1,
    trace_id: trace,
    scope: {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
    },
    query,
    source_refs,
    ...page,
    context_permissions: permissions as ContextItemDirectoryEnvelope['context_permissions'],
  };
}
