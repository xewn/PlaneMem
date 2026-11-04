import { isUlid } from './ids.js';
import { isSyncIdentifier } from './sync.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const CONTEXT_PACK_DIRECTORY_RESPONSE_BYTES = 256 * 1024;
export const CONTEXT_PACK_DIRECTORY_RECORD_BYTES = 2048;
export interface ContextPackDirectoryQuery {
  limit: number;
  pack_id?: string;
  cursor?: string;
}
export interface ContextPackDirectoryPosition {
  version: number;
  pack_id: string;
}
export interface ContextPackDirectoryRecord extends ContextPackDirectoryPosition {
  created_at: string;
  expires_at: string;
  budget_tokens: number;
  used_tokens: number;
}
export interface ContextPackDirectoryScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}
export interface ContextPackDirectoryEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: { type: 'context-pack-directory'; id: string }[];
  scope: ContextPackDirectoryScope;
  query: ContextPackDirectoryQuery;
  content_state: 'metadata-only';
  source_state: 'not-checked';
  data: ContextPackDirectoryRecord[];
  next_cursor?: string;
}
function object(value: unknown, fields: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !fields.includes(field))
  )
    throw new TypeError('Invalid saved pack directory fields');
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new TypeError('Invalid saved pack directory number');
  return value;
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError('Invalid saved pack directory time');
  return value;
}
function position(value: ContextPackDirectoryPosition): ContextPackDirectoryPosition {
  if (!isUlid(value.pack_id)) throw new TypeError('Invalid saved pack ID');
  return { version: integer(value.version, 1), pack_id: value.pack_id };
}
export function compareContextPackDirectoryPositions(
  a: ContextPackDirectoryPosition,
  b: ContextPackDirectoryPosition,
) {
  return b.version - a.version || (a.pack_id === b.pack_id ? 0 : a.pack_id > b.pack_id ? -1 : 1);
}
export function encodeContextPackDirectoryCursor(key: string, value: ContextPackDirectoryPosition) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Invalid saved pack directory binding');
  const item = position(value);
  return btoa(JSON.stringify([1, key, item.version, item.pack_id]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function parseContextPackDirectoryCursor(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(value))
    throw new TypeError('Invalid saved pack directory cursor');
  const raw: unknown = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
  if (!Array.isArray(raw) || raw.length !== 4 || raw[0] !== 1 || typeof raw[1] !== 'string')
    throw new TypeError('Restart saved pack browsing');
  const item = position({ version: raw[2], pack_id: raw[3] });
  if (encodeContextPackDirectoryCursor(raw[1], item) !== value)
    throw new TypeError('Noncanonical saved pack cursor');
  return { ...item, key: raw[1] };
}
export function parseContextPackDirectoryQuery(input: unknown): ContextPackDirectoryQuery {
  const row = object(JSON.parse(syncJsonSnapshot(input, 4096)), ['pack_id', 'limit', 'cursor']);
  if (row.pack_id !== undefined && !isUlid(row.pack_id))
    throw new TypeError('Invalid saved pack filter');
  if (row.cursor !== undefined) parseContextPackDirectoryCursor(row.cursor);
  return {
    limit: row.limit === undefined ? 25 : integer(row.limit, 1, 100),
    ...(row.pack_id === undefined ? {} : { pack_id: row.pack_id as string }),
    ...(row.cursor === undefined ? {} : { cursor: row.cursor as string }),
  };
}
export function parseContextPackDirectoryRecord(input: unknown): ContextPackDirectoryRecord {
  const row = object(JSON.parse(syncJsonSnapshot(input, CONTEXT_PACK_DIRECTORY_RECORD_BYTES)), [
    'pack_id',
    'version',
    'created_at',
    'expires_at',
    'budget_tokens',
    'used_tokens',
  ]);
  const selected = position({ pack_id: row.pack_id as string, version: row.version as number });
  const created_at = timestamp(row.created_at),
    expires_at = timestamp(row.expires_at);
  const budget_tokens = integer(row.budget_tokens, 128, 32768);
  const used_tokens = integer(row.used_tokens, 0, budget_tokens);
  if (created_at >= expires_at) throw new TypeError('Invalid saved pack lifetime');
  return { ...selected, created_at, expires_at, budget_tokens, used_tokens };
}
/** Metadata only: this parser neither reads content nor establishes source freshness. */
export function parseContextPackDirectoryEnvelope(
  input: unknown,
  original: ContextPackDirectoryQuery,
  scope: ContextPackDirectoryScope,
  trace: string,
): ContextPackDirectoryEnvelope {
  const row = object(JSON.parse(syncJsonSnapshot(input, CONTEXT_PACK_DIRECTORY_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'source_refs',
    'scope',
    'query',
    'content_state',
    'source_state',
    'data',
    'next_cursor',
  ]);
  const query = parseContextPackDirectoryQuery(original);
  const echo = parseContextPackDirectoryQuery(row.query);
  const returnedScope = object(row.scope, ['tenant_id', 'workspace_id', 'project_id']);
  if (
    row.schema_version !== 1 ||
    !isSyncIdentifier(trace) ||
    row.trace_id !== trace ||
    row.content_state !== 'metadata-only' ||
    row.source_state !== 'not-checked' ||
    JSON.stringify(query) !== JSON.stringify(echo) ||
    (row.query as Record<string, unknown>).limit !== query.limit ||
    (['tenant_id', 'workspace_id', 'project_id'] as const).some(
      (key) => !isUlid(scope[key]) || returnedScope[key] !== scope[key],
    ) ||
    Object.keys(returnedScope).length !== 3 ||
    !Array.isArray(row.data) ||
    row.data.length > query.limit ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== 1
  )
    throw new TypeError('Saved pack directory differs from the original request');
  const source = object(row.source_refs[0], ['type', 'id']);
  if (source.type !== 'context-pack-directory' || source.id !== scope.project_id)
    throw new TypeError('Invalid directory source');
  const data = row.data.map(parseContextPackDirectoryRecord);
  const seen = new Set<string>();
  const previous =
    query.cursor === undefined ? undefined : parseContextPackDirectoryCursor(query.cursor);
  for (let index = 0; index < data.length; index++) {
    const item = data[index]!;
    if (
      seen.has(item.pack_id) ||
      (query.pack_id !== undefined && item.pack_id !== query.pack_id) ||
      (previous && compareContextPackDirectoryPositions(previous, item) >= 0) ||
      (index > 0 && compareContextPackDirectoryPositions(data[index - 1]!, item) >= 0)
    )
      throw new TypeError('Invalid saved pack directory ordering or filter');
    seen.add(item.pack_id);
  }
  if (row.next_cursor !== undefined) {
    const next = parseContextPackDirectoryCursor(row.next_cursor),
      last = data.at(-1);
    if (
      !last ||
      data.length !== query.limit ||
      query.pack_id !== undefined ||
      next.pack_id !== last.pack_id ||
      next.version !== last.version ||
      (previous && next.key !== previous.key)
    )
      throw new TypeError('Invalid saved pack continuation');
  }
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [{ type: 'context-pack-directory', id: scope.project_id }],
    scope: {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
    },
    query,
    content_state: 'metadata-only',
    source_state: 'not-checked',
    data,
    ...(row.next_cursor === undefined ? {} : { next_cursor: row.next_cursor as string }),
  };
}
