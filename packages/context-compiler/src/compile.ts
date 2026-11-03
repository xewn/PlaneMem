import { createHash } from 'node:crypto';
import { validateSourceRef, type ContextPack, type ContextScope } from '@planemem/contracts';
export type { ContextPack, ContextScope } from '@planemem/contracts';
import {
  filterByPolicy,
  rankContextItem,
  type ContextItem,
  type PolicyFilter,
} from './layers/layers.js';

export interface CompileOptions {
  budget_tokens: number;
  policy?: PolicyFilter;
  expires_at?: string;
  strict_budget?: boolean;
  /** Caller checked these items against its authoritative local source graph. */
  unavailable_source_ids?: ReadonlySet<string>;
}

export function compileContextPack(
  input: { scope: ContextScope; trace_id: string; items: ContextItem[] },
  options: CompileOptions,
): ContextPack {
  if (!Number.isSafeInteger(options.budget_tokens) || options.budget_tokens < 1)
    throw new RangeError('budget_tokens must be a positive integer');
  const now = options.policy?.now === undefined ? Date.now() : Date.parse(options.policy.now);
  if (!Number.isFinite(now)) throw new TypeError('Invalid policy timestamp');
  const scopedItems = input.items.filter(
    (item) =>
      item.tenant_id === input.scope.tenant_id &&
      item.workspace_id === input.scope.workspace_id &&
      item.project_id === input.scope.project_id,
  );
  for (const item of scopedItems) validateContextItem(item);
  if (new Set(scopedItems.map((item) => item.id)).size !== scopedItems.length)
    throw new TypeError('Context item IDs must be unique within the scope');
  const allowed = filterByPolicy(scopedItems, {
    allowed_classifications: options.policy?.allowed_classifications ?? [
      'public',
      'internal',
      'confidential',
      'restricted',
    ],
    now: new Date(now).toISOString(),
  }).filter((item) => !options.unavailable_source_ids?.has(item.id));
  const ranked = [...allowed].sort(
    (left, right) =>
      rankContextItem(right) - rankContextItem(left) || compareIds(left.id, right.id),
  );
  const selected: ContextItem[] = [];
  const policyNow = now;
  const exclusions: ContextPack['exclusions'] = scopedItems
    .filter((item) => !allowed.includes(item))
    .map((item) => ({
      id: item.id,
      reason:
        item.expires_at !== undefined && Date.parse(item.expires_at) <= policyNow
          ? 'expired'
          : options.unavailable_source_ids?.has(item.id)
            ? 'source'
            : 'policy',
    }));
  let used = 0;
  for (const item of ranked) {
    const tokens = estimateContextTokens(item);
    if (
      used + tokens <= options.budget_tokens ||
      (!options.strict_budget && item.priority >= 100)
    ) {
      selected.push({
        ...item,
        selection_reason:
          item.priority >= 100 && used + tokens > options.budget_tokens
            ? 'priority-override'
            : 'ranked-fit',
      });
      used += tokens;
    } else {
      exclusions.push({ id: item.id, reason: 'budget' });
    }
  }
  const source_refs = selected
    .flatMap((item) => item.source_refs)
    .filter(
      (ref, index, refs) =>
        refs.findIndex(
          (candidate) =>
            candidate.type === ref.type &&
            candidate.id === ref.id &&
            candidate.revision === ref.revision &&
            candidate.uri === ref.uri,
        ) === index,
    );
  const requestedExpiry = Date.parse(options.expires_at ?? '2099-01-01T00:00:00.000Z');
  if (!Number.isFinite(requestedExpiry) || requestedExpiry <= now)
    throw new RangeError('Pack expiry must be in the future');
  const expires = Math.min(
    requestedExpiry,
    ...selected.flatMap((item) => (item.expires_at ? [Date.parse(item.expires_at)] : [])),
  );
  const base = {
    schema_version: 1 as const,
    pack_version: 1 as const,
    scope: input.scope,
    trace_id: input.trace_id,
    budget_tokens: options.budget_tokens,
    items: selected,
    source_refs,
    exclusions: exclusions.sort((left, right) => compareIds(left.id, right.id)),
    expires_at: new Date(expires).toISOString(),
  };
  return { ...base, pack_hash: hashContextPack(base) };
}

export function renderMarkdown(pack: ContextPack): string {
  return pack.items
    .map(
      (item) =>
        `## ${item.layer} ${item.id}\n\n${item.content}\n\nSource: ${item.source_refs.map((source) => `${source.type}:${source.id}`).join(', ')}`,
    )
    .join('\n\n');
}

export function renderMcpResource(pack: ContextPack): {
  uri: string;
  mimeType: string;
  text: string;
} {
  return {
    uri: `wcp://context/${pack.pack_hash}`,
    mimeType: 'text/markdown',
    text: renderMarkdown(pack),
  };
}

export function estimateContextTokens(item: Pick<ContextItem, 'content'>): number {
  return Math.max(1, Math.ceil(item.content.length / 4));
}

export function validateContextItem(item: ContextItem): void {
  if (
    !item ||
    item.schema_version !== 1 ||
    typeof item.id !== 'string' ||
    !item.id ||
    typeof item.content !== 'string' ||
    typeof item.trace_id !== 'string' ||
    !item.trace_id ||
    typeof item.confirmed !== 'boolean' ||
    !Number.isFinite(item.priority) ||
    !Number.isFinite(item.confidence) ||
    item.confidence < 0 ||
    item.confidence > 1 ||
    !['L0', 'L1', 'L2', 'L3', 'L4'].includes(item.layer) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(item.sensitivity) ||
    !Array.isArray(item.source_refs) ||
    (item.revision !== undefined && (!Number.isSafeInteger(item.revision) || item.revision < 1)) ||
    (item.expires_at !== undefined &&
      (typeof item.expires_at !== 'string' || !Number.isFinite(Date.parse(item.expires_at))))
  )
    throw new TypeError('Invalid context item');
  item.source_refs.forEach(validateSourceRef);
}

/** The request trace is transport metadata; stable content uses real SHA-256. */
export function hashContextPack(pack: Omit<ContextPack, 'pack_hash'> | ContextPack): string {
  const { trace_id: _trace, pack_hash: _hash, ...content } = pack as ContextPack;
  return (
    'sha256:' +
    createHash('sha256')
      .update(JSON.stringify(canonical(content)))
      .digest('hex')
  );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
