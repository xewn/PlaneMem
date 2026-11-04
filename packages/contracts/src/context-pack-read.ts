import { isUlid } from './ids.js';
import { isSyncIdentifier } from './sync.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import { buildEtag } from './versioning.js';
import { validateSourceRef, type SourceRef } from './metadata.js';
import type { ContextPack, ContextPackReceipt } from './context.js';

export const CONTEXT_PACK_READ_RESPONSE_BYTES = 2 * 1024 * 1024;
export const CONTEXT_PACK_READ_ERROR_BYTES = 16 * 1024;

export interface ContextPackReadQuery {
  pack_id?: string;
  format?: 'json' | 'markdown' | 'mcp';
}
export interface ContextPackReadEnvelope {
  schema_version: 1;
  trace_id: string;
  revision: number;
  etag: string;
  server_cursor: number;
  source_refs: SourceRef[];
  data: ContextPackReceipt;
}

/** Capture latest versus an explicit saved ID before any asynchronous work. */
export function parseContextPackReadQuery(value: unknown): ContextPackReadQuery {
  const row = object(JSON.parse(syncJsonSnapshot(value, 4096)), ['pack_id', 'format']);
  if (
    (row.pack_id !== undefined && !isUlid(row.pack_id)) ||
    (row.format !== undefined && !['json', 'markdown', 'mcp'].includes(row.format as string))
  )
    throw new TypeError('Choose a saved context pack and format');
  return {
    ...(row.pack_id === undefined ? {} : { pack_id: row.pack_id as string }),
    format: (row.format ?? 'json') as NonNullable<ContextPackReadQuery['format']>,
  };
}

/** Complete structure and request matching. The caller must also verify the SHA-256 digest. */
export function parseContextPackReadEnvelope(
  value: unknown,
  input: ContextPackReadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
): ContextPackReadEnvelope {
  const query = parseContextPackReadQuery(input);
  const row = object(JSON.parse(syncJsonSnapshot(value, CONTEXT_PACK_READ_RESPONSE_BYTES)), [
    'schema_version',
    'trace_id',
    'revision',
    'etag',
    'server_cursor',
    'source_refs',
    'data',
  ]);
  const receipt = object(row.data, [
    'pack_id',
    'version',
    'created_at',
    'used_tokens',
    'pack',
    'rendered',
  ]);
  const version = integer(receipt.version, 1);
  if (
    row.schema_version !== 1 ||
    !isSyncIdentifier(trace) ||
    row.trace_id !== trace ||
    !isUlid(receipt.pack_id) ||
    (query.pack_id !== undefined && receipt.pack_id !== query.pack_id) ||
    row.revision !== version ||
    row.etag !== buildEtag(version)
  )
    throw new TypeError('Saved context pack identity or version differs');
  integer(row.server_cursor, 1);
  const pack = object(receipt.pack, [
    'schema_version',
    'pack_version',
    'pack_hash',
    'scope',
    'trace_id',
    'budget_tokens',
    'items',
    'source_refs',
    'exclusions',
    'expires_at',
  ]);
  const packScope = object(pack.scope, ['tenant_id', 'workspace_id', 'project_id']);
  checkedScope(packScope, scope);
  name(pack.trace_id);
  const budget = integer(pack.budget_tokens, 128);
  const used = integer(receipt.used_tokens, 0);
  const expiry = time(pack.expires_at);
  if (
    pack.schema_version !== 1 ||
    pack.pack_version !== 1 ||
    typeof pack.pack_hash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(pack.pack_hash) ||
    budget > 32768 ||
    used > budget ||
    time(receipt.created_at) >= expiry
  )
    throw new TypeError('Invalid saved context pack');
  const items = array(pack.items);
  const exclusions = array(pack.exclusions);
  if (items.length + exclusions.length > 1000) throw new TypeError('Too many context candidates');
  const ids = new Set<string>();
  const selectedSources = new Map<string, SourceRef>();
  let tokens = 0;
  for (const value of items) {
    const item = object(value, [
      'schema_version',
      'tenant_id',
      'workspace_id',
      'project_id',
      'id',
      'layer',
      'content',
      'source_refs',
      'confirmed',
      'confidence',
      'priority',
      'sensitivity',
      'trace_id',
      'revision',
      'expires_at',
      'selection_reason',
    ]);
    checkedScope(item, scope);
    const id = name(item.id);
    name(item.trace_id);
    if (
      ids.has(id) ||
      item.schema_version !== 1 ||
      typeof item.content !== 'string' ||
      typeof item.confirmed !== 'boolean' ||
      typeof item.priority !== 'number' ||
      !Number.isFinite(item.priority) ||
      typeof item.confidence !== 'number' ||
      !Number.isFinite(item.confidence) ||
      item.confidence < 0 ||
      item.confidence > 1 ||
      !['L0', 'L1', 'L2', 'L3', 'L4'].includes(item.layer as string) ||
      !['public', 'internal', 'confidential', 'restricted'].includes(item.sensitivity as string) ||
      item.selection_reason !== 'ranked-fit'
    )
      throw new TypeError('Invalid selected context item');
    ids.add(id);
    if (item.revision !== undefined) integer(item.revision, 1);
    if (item.expires_at !== undefined && time(item.expires_at) < expiry)
      throw new TypeError('Selected source expires before its pack');
    tokens += Math.max(1, Math.ceil(item.content.length / 4));
    for (const ref of sources(item.source_refs)) {
      const key = JSON.stringify(canonical(ref));
      if (!selectedSources.has(key)) selectedSources.set(key, ref);
    }
  }
  for (const value of exclusions) {
    const item = object(value, ['id', 'reason']);
    const id = name(item.id);
    if (ids.has(id) || !['policy', 'expired', 'budget', 'source'].includes(item.reason as string))
      throw new TypeError('Invalid context exclusion');
    ids.add(id);
  }
  const refs = sources(pack.source_refs);
  if (tokens !== used || !same(refs, [...selectedSources.values()]))
    throw new TypeError('Context pack token estimate or sources differ');
  if (!same(sources(row.source_refs), [{ type: 'context-pack', id: receipt.pack_id }, ...refs]))
    throw new TypeError('Context pack envelope sources differ');
  if (query.format === 'json') {
    if (Object.hasOwn(receipt, 'rendered')) throw new TypeError('Unexpected rendered context pack');
  } else {
    const rendered = object(receipt.rendered, ['uri', 'mimeType', 'text']);
    const text = items
      .map((value) => {
        const item = value as Record<string, unknown>;
        const refs = item.source_refs as SourceRef[];
        return `## ${item.layer} ${item.id}\n\n${item.content}\n\nSource: ${refs.map((ref) => `${ref.type}:${ref.id}`).join(', ')}`;
      })
      .join('\n\n');
    if (
      rendered.uri !==
        `work://project/${encodeURIComponent(scope.project_id)}/context-pack/${encodeURIComponent(receipt.pack_id)}` ||
      rendered.mimeType !== 'text/markdown' ||
      rendered.text !== text
    )
      throw new TypeError('Rendered context pack differs from saved content');
  }
  // Return the detached complete document: no unknown hash-relevant fields are discarded.
  return row as unknown as ContextPackReadEnvelope;
}

/** Matches context-compiler: only the pack's top-level trace/hash are excluded. Not authenticity. */
export function contextPackReadHashJson(pack: ContextPack): string {
  const row = object(JSON.parse(syncJsonSnapshot(pack, CONTEXT_PACK_READ_RESPONSE_BYTES)));
  const { trace_id: _trace, pack_hash: _hash, ...content } = row;
  return JSON.stringify(canonical(content));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function object(value: unknown, fields?: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (fields && Object.keys(value).some((key) => !fields.includes(key)))
  )
    throw new TypeError('Invalid context pack fields');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Expected complete context pack array');
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096)
    throw new TypeError('Invalid context pack identifier');
  return value;
}
function integer(value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    throw new TypeError('Invalid context pack number');
  return value;
}
function time(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    throw new TypeError('Expected saved UTC context pack timestamp');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new TypeError('Invalid context pack timestamp');
  return parsed;
}
function checkedScope(
  row: Record<string, unknown>,
  scope: {
    tenant_id: string;
    workspace_id: string;
    project_id: string;
  },
) {
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isUlid(scope[key]) || row[key] !== scope[key])
      throw new TypeError('Context pack scope differs');
}
function sources(value: unknown): SourceRef[] {
  return array(value).map((entry) =>
    validateSourceRef(object(entry, ['type', 'id', 'revision', 'uri'])),
  );
}
