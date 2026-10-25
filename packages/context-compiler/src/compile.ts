import { type SourceRef, type Ulid } from '@planemem/contracts';
import {
  filterByPolicy,
  rankContextItem,
  type ContextItem,
  type PolicyFilter,
} from './layers/layers.js';

export interface ContextScope {
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
}

export interface ContextPack {
  schema_version: 1;
  pack_version: 1;
  pack_hash: string;
  scope: ContextScope;
  trace_id: string;
  budget_tokens: number;
  items: ContextItem[];
  source_refs: SourceRef[];
  exclusions: Array<{ id: string; reason: 'policy' | 'expired' | 'budget' }>;
  expires_at: string;
}

export interface CompileOptions {
  budget_tokens: number;
  policy?: PolicyFilter;
  expires_at?: string;
}

export function compileContextPack(
  input: { scope: ContextScope; trace_id: string; items: ContextItem[] },
  options: CompileOptions,
): ContextPack {
  const scopedItems = input.items.filter(
    (item) =>
      item.tenant_id === input.scope.tenant_id &&
      item.workspace_id === input.scope.workspace_id &&
      item.project_id === input.scope.project_id,
  );
  const allowed = filterByPolicy(
    scopedItems,
    options.policy ?? {
      allowed_classifications: ['public', 'internal', 'confidential', 'restricted'],
    },
  );
  const ranked = [...allowed].sort(
    (left, right) =>
      rankContextItem(right) - rankContextItem(left) || left.id.localeCompare(right.id),
  );
  const selected: ContextItem[] = [];
  const policyNow = options.policy?.now === undefined ? Date.now() : Date.parse(options.policy.now);
  const exclusions: Array<{ id: string; reason: 'policy' | 'expired' | 'budget' }> = input.items
    .filter((item) => !allowed.includes(item))
    .map((item) => ({
      id: item.id,
      reason:
        item.expires_at !== undefined && Date.parse(item.expires_at) <= policyNow
          ? 'expired'
          : 'policy',
    }));
  let used = 0;
  for (const item of ranked) {
    const tokens = Math.max(1, Math.ceil(item.content.length / 4));
    if (used + tokens <= options.budget_tokens || item.priority >= 100) {
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
        refs.findIndex((candidate) => candidate.type === ref.type && candidate.id === ref.id) ===
        index,
    );
  const base = {
    schema_version: 1 as const,
    pack_version: 1 as const,
    scope: input.scope,
    trace_id: input.trace_id,
    budget_tokens: options.budget_tokens,
    items: selected,
    source_refs,
    exclusions: exclusions.sort((left, right) => left.id.localeCompare(right.id)),
    expires_at: options.expires_at ?? '2099-01-01T00:00:00.000Z',
  };
  return { ...base, pack_hash: stableHash(JSON.stringify(base)) };
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

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `sha256:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
