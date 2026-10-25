import type { ViewState, WorkbenchScope } from '../../lib/api';

export interface AdminHealth {
  schema_version: 1;
  release: string;
  services: Array<{ name: string; status: 'ok' | 'degraded' | 'down'; version: string }>;
  audit_count: number;
  trace_id: string;
}

export class AdminPanel {
  constructor(
    private readonly role: 'admin' | 'user',
    private readonly scope: WorkbenchScope,
  ) {}

  view(health: AdminHealth): ViewState<AdminHealth> {
    if (this.role !== 'admin')
      return { status: 'denied', message: 'Admin role is required', trace_id: health.trace_id };
    return {
      status: health.services.every((service) => service.status === 'ok') ? 'ready' : 'stale',
      data: { ...health, services: health.services.map((service) => ({ ...service })) },
      trace_id: health.trace_id,
      source_refs: [
        { type: 'release', id: health.release },
        { type: 'scope', id: this.scope.project_id },
      ],
    };
  }
}
