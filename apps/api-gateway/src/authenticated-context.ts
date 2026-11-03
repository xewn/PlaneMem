import { ContractError } from '@planemem/contracts';
import { OidcTokenError, type OidcClaims } from './oidc.js';
import type { RequestContext } from './router.js';

export type VerifyGatewayToken = (authorization: string | undefined) => Promise<OidcClaims>;

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

export async function authenticatedContext(
  scope: Pick<RequestContext, 'tenant_id' | 'workspace_id' | 'project_id'>,
  trace_id: string,
  authorization: string | undefined,
  verify: VerifyGatewayToken | undefined,
  requireClient = false,
): Promise<RequestContext> {
  if (!authorization?.startsWith('Bearer ') || !authorization.slice(7).trim())
    throw new ContractError('UNAUTHENTICATED', 'Bearer token is required', { trace_id });
  if (!verify)
    throw new ContractError(
      'WORKBENCH_AUTH_UNAVAILABLE',
      'Gateway token verifier is not configured',
      {
        trace_id,
        retryable: true,
      },
    );
  let claims: OidcClaims;
  try {
    claims = await verify(authorization);
  } catch (error) {
    if (error instanceof OidcTokenError)
      throw new ContractError('UNAUTHENTICATED', error.message, { trace_id });
    throw new ContractError('WORKBENCH_AUTH_UNAVAILABLE', 'Gateway authentication is unavailable', {
      trace_id,
      retryable: true,
    });
  }

  // An issuer without project claims can be bound to one scope on the gateway.
  // Never fill a partially claimed scope from request headers or defaults.
  const hasScopeClaims = ['tenant_id', 'workspace_id', 'project_id'].some((key) => key in claims);
  const allowed = hasScopeClaims
    ? claims
    : {
        tenant_id: process.env.WORKBENCH_TENANT_ID,
        workspace_id: process.env.WORKBENCH_WORKSPACE_ID,
        project_id: process.env.WORKBENCH_PROJECT_ID,
      };
  if (
    !scope.tenant_id ||
    !scope.workspace_id ||
    !scope.project_id ||
    scope.tenant_id !== allowed.tenant_id ||
    scope.workspace_id !== allowed.workspace_id ||
    scope.project_id !== allowed.project_id
  )
    throw new ContractError('DENIED', 'Requested project scope is not authorized', { trace_id });

  const capability = [
    ...new Set([...stringList(claims.scope), ...stringList(claims.capabilities)]),
  ];
  const clientId = typeof claims.azp === 'string' ? claims.azp : claims.client_id;
  if (requireClient && (typeof clientId !== 'string' || !clientId.trim()))
    throw new ContractError('DENIED', 'This operation requires an authenticated client', {
      trace_id,
    });
  const isWorkbenchClient =
    clientId === (process.env.AUTH_SERVER_CLIENT_ID ?? 'PlaneMem_WebConsole');
  if (!hasScopeClaims && !isWorkbenchClient)
    throw new ContractError('DENIED', 'Token has no workbench scope', { trace_id });
  // The existing OpenIddict workbench client requests Base for basic project reads.
  if (
    (capability.includes('workbench.read') || (isWorkbenchClient && capability.includes('Base'))) &&
    !capability.includes('context.read')
  )
    capability.push('context.read');
  return {
    ...scope,
    trace_id,
    actor_id: claims.sub,
    client_id: typeof clientId === 'string' ? clientId : 'web-console',
    authenticated_client: typeof clientId === 'string' && clientId.trim().length > 0,
    ...(claims.actor_type === 'human' || claims.actor_type === 'service'
      ? { actor_type: claims.actor_type }
      : {}),
    roles: stringList(claims.role ?? claims.roles),
    capability,
    token_expires_at: new Date(claims.exp * 1000).toISOString(),
    schema_version: 1,
  };
}
