import { canExport, canRead, type PolicyDecision, type PolicyRequest } from '@planemem/auth';
import { ContractError } from '@planemem/contracts';

export interface PolicyServiceOptions {
  opa_url?: string | undefined;
  fetch_impl?: typeof fetch | undefined;
}

export class PolicyService {
  private readonly opa_url: string | undefined;
  private readonly fetch_impl: typeof fetch;

  constructor(options: PolicyServiceOptions = {}) {
    this.opa_url = options.opa_url?.replace(/\/$/, '');
    this.fetch_impl = options.fetch_impl ?? fetch;
  }

  health(): { service: 'policy-service'; version: '0.1.0'; status: 'ok'; ready: true } {
    return { service: 'policy-service', version: '0.1.0', status: 'ok', ready: true };
  }

  authorize(request: PolicyRequest): PolicyDecision {
    const { context, resource } = request;
    const source_refs = [{ type: 'policy', id: `policy-${request.action}` }];
    if (Date.parse(context.token_expires_at) <= Date.now())
      return this.deny('token_expired', context.trace_id, source_refs);
    if (
      context.tenant_id !== resource.tenant_id ||
      context.workspace_id !== resource.workspace_id ||
      context.project_id !== resource.project_id
    )
      return this.deny('scope_mismatch', context.trace_id, source_refs);
    if (
      request.action.startsWith('export') &&
      resource.classification !== undefined &&
      !canExport(resource.classification, context.capabilities)
    )
      return this.deny('classification_export_denied', context.trace_id, source_refs);
    if (
      resource.classification !== undefined &&
      !canRead(resource.classification, context.capabilities)
    )
      return this.deny('classification_read_denied', context.trace_id, source_refs);
    const required = capabilityFor(request.action);
    if (
      required !== undefined &&
      !context.capabilities.includes(required) &&
      !context.roles.includes('admin')
    )
      return this.deny(`missing_capability:${required}`, context.trace_id, source_refs);
    return {
      schema_version: 1,
      allowed: true,
      reason: 'allowed',
      obligations: ['audit'],
      trace_id: context.trace_id,
      source_refs,
    };
  }

  async authorizeWithOpa(request: PolicyRequest): Promise<PolicyDecision> {
    if (!this.opa_url) return this.authorize(request);
    const source_refs = [{ type: 'opa', id: 'planemem/authz' }];
    try {
      const response = await this.fetch_impl(`${this.opa_url}/v1/data/planemem/authz`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: request }),
      });
      if (!response.ok) return this.deny('opa_unavailable', request.context.trace_id, source_refs);
      const body: unknown = await response.json();
      const result = isRecord(body) && isRecord(body.result) ? body.result : undefined;
      const allowed = result?.allow === true;
      return allowed
        ? {
            schema_version: 1,
            allowed: true,
            reason: 'allowed',
            obligations: ['audit'],
            trace_id: request.context.trace_id,
            source_refs,
          }
        : this.deny('opa_denied', request.context.trace_id, source_refs);
    } catch {
      return this.deny('opa_unavailable', request.context.trace_id, source_refs);
    }
  }

  assertAuthorized(request: PolicyRequest): void {
    const decision = this.authorize(request);
    if (!decision.allowed)
      throw new ContractError('DENIED', decision.reason, {
        trace_id: decision.trace_id,
        retryable: false,
      });
  }

  private deny(
    reason: string,
    trace_id: string,
    source_refs: Array<{ type: string; id: string }>,
  ): PolicyDecision {
    return {
      schema_version: 1,
      allowed: false,
      reason,
      obligations: ['audit-deny'],
      trace_id,
      source_refs,
    };
  }
}

function capabilityFor(action: string): string | undefined {
  if (action.startsWith('context.read') || action.startsWith('project.read')) return 'context.read';
  if (action.startsWith('context.write')) return 'context.write';
  if (action.startsWith('handoff.claim')) return 'handoff.claim';
  if (action.startsWith('session.write')) return 'session.write';
  if (action.startsWith('admin.')) return 'admin.read';
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
