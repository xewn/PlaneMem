import {
  ContractError,
  parseSessionCommandIdentity,
  parseSessionCommandContextEnvelope,
  sessionCommandContextPermissions,
  type SessionCommandContextData,
} from '@planemem/contracts';
import type { CommandRouter, RequestContext } from './router.js';

export function canReadSessionCommandContext(context: RequestContext): boolean {
  const expiry = Date.parse(context.token_expires_at ?? '');
  const flags = sessionCommandContextPermissions(context);
  return (
    context.authenticated_client === true &&
    Number.isFinite(expiry) &&
    expiry > Date.now() &&
    (flags.read_sessions || flags.write_sessions || flags.claim_handoffs)
  );
}
export function sessionCommandContextData(context: RequestContext): SessionCommandContextData {
  if (!canReadSessionCommandContext(context))
    throw new ContractError(
      'DENIED',
      'A verified unexpired client with session read, write or claim access is required',
      { trace_id: context.trace_id, retryable: false },
    );
  return {
    identity: parseSessionCommandIdentity({
      tenant_id: context.tenant_id,
      workspace_id: context.workspace_id,
      project_id: context.project_id,
      actor_id: context.actor_id,
      client_id: context.client_id,
    }),
    expires_at: new Date(context.token_expires_at!).toISOString(),
    permissions: sessionCommandContextPermissions(context),
  };
}
export function registerSessionCommandContext(router: CommandRouter) {
  router.register('session.command-context', (request) => {
    const context = structuredClone(request.context);
    if (!canReadSessionCommandContext(context))
      throw new ContractError('DENIED', 'A verified unexpired session is required', {
        trace_id: context.trace_id,
      });
    if (
      Object.keys(request.input).length ||
      context.idempotency_key !== undefined ||
      context.expected_version !== undefined
    )
      throw new ContractError(
        'INVALID_INPUT',
        'Session command context accepts no parameters or write conditions',
        { trace_id: context.trace_id },
      );
    try {
      return parseSessionCommandContextEnvelope(
        {
          schema_version: 1,
          trace_id: context.trace_id,
          source_refs: [],
          data: sessionCommandContextData(context),
        },
        context,
        context.trace_id,
      );
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError(
        'SESSION_COMMAND_CONTEXT_INVALID',
        'Verified session command context could not be represented',
        { trace_id: context.trace_id, retryable: false },
      );
    }
  });
}
