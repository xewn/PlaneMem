import { ContractError, parseSyncCommandIdentity } from '@planemem/contracts';
import type { RequestContext } from './router.js';

export function canReadSyncStream(context: RequestContext): boolean {
  const expiry = Date.parse(context.token_expires_at ?? '');
  return (
    context.authenticated_client === true &&
    Number.isFinite(expiry) &&
    expiry > Date.now() &&
    (context.roles?.includes('admin') === true || context.capability.includes('sync.read'))
  );
}
export function syncReaderIdentity(context: RequestContext) {
  if (!canReadSyncStream(context))
    throw new ContractError('DENIED', 'A verified unexpired sync reader is required', {
      trace_id: context.trace_id,
    });
  try {
    return parseSyncCommandIdentity({
      tenant_id: context.tenant_id,
      workspace_id: context.workspace_id,
      project_id: context.project_id,
      actor_id: context.actor_id,
      client_id: context.client_id,
    });
  } catch {
    throw new ContractError('SYNC_CURSOR_INVALID', 'The sync reader identity is invalid', {
      trace_id: context.trace_id,
    });
  }
}
