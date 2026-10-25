import type { SourceRef } from '@planemem/contracts';

export interface WorkbenchScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}

export interface ProjectSummary extends WorkbenchScope {
  schema_version: 1;
  project_id: string;
  name: string;
  open_work_items: number;
  context_pack_hash?: string;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface WorkItemSummary extends WorkbenchScope {
  schema_version: 1;
  work_item_id: string;
  title: string;
  status: 'proposed' | 'observed' | 'verified' | 'blocked' | 'done';
  revision: number;
  classification: string;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface GatewayQuery {
  <T>(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<{ schema_version: 1; data: T; trace_id: string; source_refs: SourceRef[] }>;
}

export type ViewState<T> =
  | { status: 'loading'; data?: T; trace_id: string }
  | { status: 'ready'; data: T; trace_id: string; source_refs: SourceRef[] }
  | { status: 'empty'; data: T; trace_id: string }
  | { status: 'stale'; data: T; trace_id: string; source_refs: SourceRef[] }
  | { status: 'denied' | 'error'; message: string; trace_id: string; data?: T };

export class WorkbenchApi {
  constructor(private readonly query: GatewayQuery) {}

  projects(scope: WorkbenchScope): Promise<{
    schema_version: 1;
    data: ProjectSummary[];
    trace_id: string;
    source_refs: SourceRef[];
  }> {
    return this.query<ProjectSummary[]>('workbench.projects', { ...scope });
  }

  workItem(
    scope: WorkbenchScope,
    work_item_id: string,
  ): Promise<{
    schema_version: 1;
    data: WorkItemSummary;
    trace_id: string;
    source_refs: SourceRef[];
  }> {
    return this.query<WorkItemSummary>('workbench.work_item', { ...scope, work_item_id });
  }

  handoff(
    scope: WorkbenchScope,
    handoff_id: string,
    action: 'claim' | 'resume',
  ): Promise<{ schema_version: 1; data: unknown; trace_id: string; source_refs: SourceRef[] }> {
    return this.query<unknown>(`workbench.handoff.${action}`, { ...scope, handoff_id });
  }

  conflict(
    scope: WorkbenchScope,
    conflict_id: string,
    resolution?: string,
  ): Promise<{ schema_version: 1; data: unknown; trace_id: string; source_refs: SourceRef[] }> {
    return this.query<unknown>('workbench.conflict', {
      ...scope,
      conflict_id,
      ...(resolution === undefined ? {} : { resolution }),
    });
  }
}
