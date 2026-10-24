import type { Classification, SourceRef, Ulid } from '@planemem/contracts';

export type ContextLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface ContextItem {
  schema_version: 1;
  id: string;
  layer: ContextLayer;
  content: string;
  source_refs: SourceRef[];
  confirmed: boolean;
  confidence: number;
  priority: number;
  sensitivity: Classification;
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
  trace_id: string;
  expires_at?: string;
  selection_reason?: 'ranked-fit' | 'priority-override';
}

export interface PolicyFilter {
  allowed_classifications: Classification[];
  now?: string;
}

const LAYER_WEIGHT: Record<ContextLayer, number> = { L0: 500, L1: 400, L2: 300, L3: 200, L4: 100 };

export function rankContextItem(item: ContextItem): number {
  return (
    LAYER_WEIGHT[item.layer] +
    item.priority +
    (item.confirmed ? 50 : 0) +
    Math.round(item.confidence * 10)
  );
}

export function filterByPolicy(items: ContextItem[], policy: PolicyFilter): ContextItem[] {
  const now = policy.now === undefined ? Date.now() : Date.parse(policy.now);
  return items.filter((item) => {
    if (!policy.allowed_classifications.includes(item.sensitivity)) return false;
    if (item.expires_at !== undefined && Date.parse(item.expires_at) <= now) return false;
    return true;
  });
}
