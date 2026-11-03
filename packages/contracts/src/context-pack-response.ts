import { isUlid } from './ids.js';
import { validateSourceRef, type SourceRef } from './metadata.js';
import type { ContextItem, ContextPack, ContextPackReceipt, ContextScope } from './context.js';

/** Validate a saved pack response. Freshness and content hashing remain gateway responsibilities. */
export function parseContextPackReceipt(
  value: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  expectedId?: string,
  expectedHash?: string,
): ContextPackReceipt {
  const row = object(value);
  const pack = object(row.pack);
  if (
    !isUlid(row.pack_id) ||
    (expectedId !== undefined && row.pack_id !== expectedId) ||
    !positive(row.version) ||
    !time(row.created_at) ||
    !integer(row.used_tokens) ||
    row.used_tokens < 0 ||
    pack.schema_version !== 1 ||
    pack.pack_version !== 1 ||
    typeof pack.pack_hash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(pack.pack_hash) ||
    (expectedHash !== undefined && pack.pack_hash !== expectedHash) ||
    !name(pack.trace_id) ||
    !integer(pack.budget_tokens) ||
    pack.budget_tokens < 128 ||
    pack.budget_tokens > 32768 ||
    row.used_tokens > pack.budget_tokens ||
    !time(pack.expires_at) ||
    Date.parse(row.created_at) >= Date.parse(pack.expires_at)
  )
    throw new TypeError('Invalid saved context pack');
  const packScope = checkedScope(object(pack.scope), scope);
  const items: ContextItem[] = array(pack.items).map((value) => {
    const item = object(value);
    const itemScope = checkedScope(item, scope);
    if (
      item.schema_version !== 1 ||
      !name(item.id) ||
      typeof item.content !== 'string' ||
      !name(item.trace_id) ||
      typeof item.confirmed !== 'boolean' ||
      typeof item.priority !== 'number' ||
      !Number.isFinite(item.priority) ||
      typeof item.confidence !== 'number' ||
      !Number.isFinite(item.confidence) ||
      item.confidence < 0 ||
      item.confidence > 1 ||
      !['L0', 'L1', 'L2', 'L3', 'L4'].includes(item.layer as string) ||
      !['public', 'internal', 'confidential', 'restricted'].includes(item.sensitivity as string) ||
      item.selection_reason !== 'ranked-fit' ||
      (item.revision !== undefined && !positive(item.revision)) ||
      (item.expires_at !== undefined &&
        (!time(item.expires_at) ||
          Date.parse(item.expires_at) < Date.parse(pack.expires_at as string)))
    )
      throw new TypeError('Invalid saved context item');
    return {
      schema_version: 1,
      ...itemScope,
      id: item.id,
      content: item.content,
      trace_id: item.trace_id,
      layer: item.layer as ContextItem['layer'],
      sensitivity: item.sensitivity as ContextItem['sensitivity'],
      confirmed: item.confirmed,
      priority: item.priority,
      confidence: item.confidence,
      source_refs: refs(item.source_refs),
      selection_reason: 'ranked-fit',
      ...(typeof item.revision === 'number' ? { revision: item.revision } : {}),
      ...(typeof item.expires_at === 'string' ? { expires_at: item.expires_at } : {}),
    };
  });
  const exclusions: ContextPack['exclusions'] = array(pack.exclusions).map((value) => {
    const item = object(value);
    if (
      !name(item.id) ||
      !['policy', 'expired', 'budget', 'source'].includes(item.reason as string)
    )
      throw new TypeError('Invalid context pack exclusion');
    return { id: item.id, reason: item.reason as ContextPack['exclusions'][number]['reason'] };
  });
  const ids = [...items.map((item) => item.id), ...exclusions.map((item) => item.id)];
  if (new Set(ids).size !== ids.length) throw new TypeError('Duplicate context pack item');
  const sources = refs(pack.source_refs);
  const itemSources = items
    .flatMap((item) => item.source_refs)
    .filter((ref, index, all) => all.findIndex((other) => sameSource(ref, other)) === index);
  if (
    sources.length !== itemSources.length ||
    !sources.every((ref, index) => sameSource(ref, itemSources[index]!))
  )
    throw new TypeError('Context pack sources differ from selected items');
  // This matches the protocol's content-length estimate, not a model tokenizer.
  if (
    items.reduce((sum, item) => sum + Math.max(1, Math.ceil(item.content.length / 4)), 0) !==
    row.used_tokens
  )
    throw new TypeError('Context pack token estimate differs');
  let rendered: ContextPackReceipt['rendered'];
  if (row.rendered !== undefined) {
    const content = object(row.rendered);
    if (
      !name(content.uri) ||
      content.mimeType !== 'text/markdown' ||
      typeof content.text !== 'string'
    )
      throw new TypeError('Invalid rendered context pack');
    rendered = { uri: content.uri, mimeType: 'text/markdown', text: content.text };
  }
  return {
    pack_id: row.pack_id,
    version: row.version,
    created_at: row.created_at,
    used_tokens: row.used_tokens,
    pack: {
      schema_version: 1,
      pack_version: 1,
      pack_hash: pack.pack_hash,
      scope: packScope,
      trace_id: pack.trace_id,
      budget_tokens: pack.budget_tokens,
      items,
      exclusions,
      source_refs: sources,
      expires_at: pack.expires_at,
    },
    ...(rendered === undefined ? {} : { rendered }),
  };
}
function checkedScope(
  row: Record<string, unknown>,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
): ContextScope {
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!name(scope[field]) || row[field] !== scope[field])
      throw new TypeError('Context pack scope differs');
  return {
    tenant_id: scope.tenant_id as ContextScope['tenant_id'],
    workspace_id: scope.workspace_id as ContextScope['workspace_id'],
    project_id: scope.project_id as ContextScope['project_id'],
  };
}
function sameSource(left: SourceRef, right: SourceRef): boolean {
  return (
    left.type === right.type &&
    left.id === right.id &&
    left.revision === right.revision &&
    left.uri === right.uri
  );
}
function refs(value: unknown): SourceRef[] {
  return array(value).map((source) => ({ ...validateSourceRef(source) }));
}
function array(value: unknown): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.keys(value).length !== value.length ||
    Array.from(value).some((item) => item === undefined)
  )
    throw new TypeError('Invalid context pack array');
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected context pack data');
  return value as Record<string, unknown>;
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
function positive(value: unknown): value is number {
  return integer(value) && value > 0;
}
function name(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 4096;
}
function time(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && Number.isFinite(Date.parse(value));
}
