import { WorkbenchApi, type ViewState, type WorkbenchScope } from '../../lib/api';

export interface ConflictView {
  conflict_id: string;
  resolution?: string;
  version: number;
  trace_id: string;
  source_refs: unknown[];
}

export class ConflictCenter {
  constructor(private readonly api: WorkbenchApi) {}

  async resolve(
    scope: WorkbenchScope,
    conflict_id: string,
    resolution: 'local' | 'server' | 'merge',
    confirmed: boolean,
  ): Promise<ViewState<ConflictView>> {
    if (!confirmed)
      return {
        status: 'error',
        message: 'Conflict resolution requires explicit confirmation',
        trace_id: 'trace_workbench_conflict_confirmation',
      };
    try {
      const response = await this.api.conflict(scope, conflict_id, resolution);
      const data = response.data as { version?: number };
      return {
        status: 'ready',
        data: {
          conflict_id,
          resolution,
          version: data.version ?? 1,
          trace_id: response.trace_id,
          source_refs: response.source_refs,
        },
        trace_id: response.trace_id,
        source_refs: response.source_refs,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Conflict resolution failed',
        trace_id: 'trace_workbench_conflict_error',
      };
    }
  }
}
