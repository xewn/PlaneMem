import type { Ulid } from './ids.js';
import type { Classification, SourceRef } from './metadata.js';

export type ContextLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface ContextScope {
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
}

export interface ContextItem extends ContextScope {
  schema_version: 1;
  id: string;
  layer: ContextLayer;
  content: string;
  source_refs: SourceRef[];
  confirmed: boolean;
  confidence: number;
  priority: number;
  sensitivity: Classification;
  trace_id: string;
  revision?: number;
  expires_at?: string;
  selection_reason?: 'ranked-fit' | 'priority-override';
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
  exclusions: Array<{ id: string; reason: 'policy' | 'expired' | 'budget' | 'source' }>;
  expires_at: string;
}

export interface CompileContextPackRequest {
  budget_tokens?: number;
  ttl_seconds?: number;
}

export interface ContextPackReceipt {
  pack_id: Ulid;
  version: number;
  created_at: string;
  /** Estimate of selected content, not a model-specific tokenizer count. */
  used_tokens: number;
  pack: ContextPack;
  rendered?: { uri: string; mimeType: 'text/markdown'; text: string };
}
