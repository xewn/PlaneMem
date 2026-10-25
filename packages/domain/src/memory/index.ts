import type { SourceRef, Ulid } from '@planemem/contracts';

export interface MemoryScope {
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
}

export interface MemoryRef extends MemoryScope {
  schema_version: 1;
  page_ref: string;
  revision: number;
  hash: string;
  source_refs: SourceRef[];
  trace_id: string;
}

export interface MemoryHit extends MemoryRef {
  snippet: string;
  rank: number;
}

export interface MemoryProvider {
  capture(input: MemoryScope & { content: string; trace_id: string }): Promise<MemoryRef>;
  consolidate(
    input: MemoryScope & { page_ref: string; expected_revision: number; trace_id: string },
  ): Promise<MemoryRef>;
  recall(input: MemoryScope & { query: string; trace_id: string }): Promise<MemoryHit[]>;
  read_page(page_ref: string, scope: MemoryScope, trace_id: string): Promise<MemoryRef>;
  restore_page(page_ref: string, scope: MemoryScope, trace_id: string): Promise<MemoryRef>;
}
