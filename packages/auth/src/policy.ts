import type { Classification } from './classification.js';

export interface AuthContext {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  client_id: string;
  roles: string[];
  capabilities: string[];
  token_expires_at: string;
  trace_id: string;
}

export interface PolicyRequest {
  action: string;
  resource: {
    tenant_id: string;
    workspace_id: string;
    project_id: string;
    classification?: Classification;
  };
  context: AuthContext;
}

export interface PolicyDecision {
  schema_version: 1;
  allowed: boolean;
  reason: string;
  obligations: string[];
  trace_id: string;
  source_refs: Array<{ type: string; id: string }>;
}
