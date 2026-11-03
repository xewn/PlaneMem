import { ContractError, parseSyncCommandContextEnvelope } from '@planemem/contracts';
import type { CommandRouter, RequestContext } from './router.js';

export function canReadSyncCommandContext(context: RequestContext): boolean {
  const expiry = Date.parse(context.token_expires_at ?? '');
  return (
    context.authenticated_client === true &&
    Number.isFinite(expiry) &&
    expiry > Date.now() &&
    (context.roles?.includes('admin') === true || context.capability.includes('sync.write'))
  );
}
export function syncCommandContextData(context: RequestContext) {
  if (!canReadSyncCommandContext(context))
    throw new ContractError('DENIED', 'A verified unexpired sync writer is required', {
      trace_id: context.trace_id,
    });
  try {
    return parseSyncCommandContextEnvelope(
      {
        schema_version: 1,
        trace_id: context.trace_id,
        source_refs: [],
        data: {
          identity: {
            tenant_id: context.tenant_id,
            workspace_id: context.workspace_id,
            project_id: context.project_id,
            actor_id: context.actor_id,
            client_id: context.client_id,
          },
          expires_at: new Date(context.token_expires_at!).toISOString(),
          permissions: { upload_events: true },
        },
      },
      context,
      context.trace_id,
    ).data;
  } catch {
    throw new ContractError(
      'SYNC_COMMAND_CONTEXT_INVALID',
      'Verified sync identity could not be represented',
      {
        trace_id: context.trace_id,
      },
    );
  }
}
export function registerSyncCommandContext(router: CommandRouter) {
  router.register('sync.command-context', (request) => {
    const context = structuredClone(request.context);
    if (
      Object.keys(request.input).length ||
      context.idempotency_key !== undefined ||
      context.expected_version !== undefined
    )
      throw new ContractError(
        'INVALID_INPUT',
        'Sync identity accepts no parameters or write conditions',
        { trace_id: context.trace_id },
      );
    return {
      schema_version: 1,
      trace_id: context.trace_id,
      source_refs: [],
      data: syncCommandContextData(context),
    };
  });
}
