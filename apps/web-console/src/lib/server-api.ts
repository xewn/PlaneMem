import { getSession, type SessionClaims } from './auth';
import { runtimeConfig } from './config';

export type WorkbenchOperation =
  | 'overview'
  | 'work_items'
  | 'context'
  | 'sessions'
  | 'handoffs'
  | 'conflicts'
  | 'audit'
  | 'admin';

export interface WorkbenchResponse<T> {
  schema_version: 1;
  data: T;
  trace_id: string;
  source_refs: Array<{ type: string; id: string }>;
}

export class AuthRequiredError extends Error {
  constructor() {
    super('AUTH_REQUIRED');
    this.name = 'AuthRequiredError';
  }
}

export class WorkbenchApiError extends Error {
  readonly trace_id?: string;

  constructor(message: string, trace_id?: string) {
    super(message);
    this.name = 'WorkbenchApiError';
    this.trace_id = trace_id;
  }
}

function scopeFromSession(session: SessionClaims | undefined) {
  return {
    tenant_id: session?.tenant_id ?? runtimeConfig.tenantId,
    workspace_id: session?.workspace_id ?? runtimeConfig.workspaceId,
    project_id: session?.project_id ?? runtimeConfig.projectId,
  };
}

export async function queryWorkbench<T>(
  operation: WorkbenchOperation,
  input: Record<string, unknown> = {},
): Promise<WorkbenchResponse<T>> {
  const session = await getSession();
  if (!session) throw new AuthRequiredError();
  const trace_id = `trace_web_${crypto.randomUUID()}`;
  const scope = scopeFromSession(session);
  const response = await fetch(`${runtimeConfig.apiUrl}/v1/workbench/query`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
      'x-trace-id': trace_id,
      'x-tenant-id': scope.tenant_id,
      'x-workspace-id': scope.workspace_id,
      'x-project-id': scope.project_id,
      'x-actor-id': session.sub ?? session.preferred_username ?? 'authenticated-user',
      'x-client-id': 'web-console',
      'x-capability': 'workbench.read context.read audit.read',
      'x-role': (session.roles ?? []).join(' '),
      'x-token-expires-at': new Date(session.expires_at * 1000).toISOString(),
    },
    body: JSON.stringify({ operation, ...input }),
  });
  const payload = (await response.json()) as WorkbenchResponse<T> & {
    code?: string;
    message?: string;
    trace_id?: string;
  };
  if (!response.ok)
    throw new WorkbenchApiError(
      payload.message ?? payload.code ?? 'WORKBENCH_QUERY_FAILED',
      payload.trace_id,
    );
  return payload;
}
