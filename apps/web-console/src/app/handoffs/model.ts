import { WorkbenchApi, type ViewState, type WorkbenchScope } from '../../lib/api.js';

export interface HandoffView {
  status: 'open' | 'claimed' | 'resumed' | 'denied' | 'error';
  handoff_id: string;
  trace_id: string;
  source_refs: unknown[];
  confirmation_required: boolean;
}

export class HandoffCenter {
  constructor(private readonly api: WorkbenchApi) {}

  async claim(scope: WorkbenchScope, handoff_id: string): Promise<ViewState<HandoffView>> {
    try {
      const response = await this.api.handoff(scope, handoff_id, 'claim');
      return {
        status: 'ready',
        data: {
          status: 'claimed',
          handoff_id,
          trace_id: response.trace_id,
          source_refs: response.source_refs,
          confirmation_required: false,
        },
        trace_id: response.trace_id,
        source_refs: response.source_refs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Handoff claim failed';
      return {
        status: message.includes('DENIED') ? 'denied' : 'error',
        message,
        trace_id: 'trace_workbench_handoff_error',
      };
    }
  }

  async resume(
    scope: WorkbenchScope,
    handoff_id: string,
    confirmed: boolean,
  ): Promise<ViewState<HandoffView>> {
    if (!confirmed)
      return {
        status: 'error',
        message: 'Resume requires explicit confirmation',
        trace_id: 'trace_workbench_resume_confirmation',
      };
    try {
      const response = await this.api.handoff(scope, handoff_id, 'resume');
      return {
        status: 'ready',
        data: {
          status: 'resumed',
          handoff_id,
          trace_id: response.trace_id,
          source_refs: response.source_refs,
          confirmation_required: false,
        },
        trace_id: response.trace_id,
        source_refs: response.source_refs,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Resume failed',
        trace_id: 'trace_workbench_resume_error',
      };
    }
  }
}
