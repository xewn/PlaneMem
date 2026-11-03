import { parseWorkbenchAdminEnvelope, type WorkbenchAdminEnvelope } from '@planemem/contracts';
import type { ViewState, WorkbenchScope } from '../../lib/api';

export type AdminHealth = WorkbenchAdminEnvelope;

/** Pure display model; the Gateway still owns identity, capability and classification checks. */
export class AdminPanel {
  private readonly scope: WorkbenchScope;

  constructor(
    private readonly role: 'admin' | 'user',
    scope: WorkbenchScope,
  ) {
    this.scope = { ...scope };
  }

  view(health: unknown, expectedTrace?: string): ViewState<AdminHealth> {
    // An absent request trace remains absent; never invent a successful query identifier.
    const trace_id = expectedTrace ?? '';
    if (this.role !== 'admin')
      return { status: 'denied', message: 'Admin role is required', trace_id };
    if (!expectedTrace)
      return { status: 'error', message: 'The original query trace is required', trace_id };
    try {
      const data = parseWorkbenchAdminEnvelope(health, this.scope, expectedTrace);
      return {
        // Ready describes validated display data, not external health or release readiness.
        status: 'ready',
        data,
        trace_id,
        source_refs: data.source_refs.map((ref) => ({ ...ref })),
      };
    } catch {
      return {
        status: 'error',
        message: 'Administration snapshot could not be validated',
        trace_id,
      };
    }
  }
}
