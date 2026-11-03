import {
  ContractError,
  parseConflictCommandContextEnvelope,
  type ConflictCommandContextData,
} from '@planemem/contracts';
import { canReadConflictReceipt } from './conflict-receipts.js';
import type { CommandRouter, RequestContext } from './router.js';

/** Normalize already-verified caller claims without reading project or conflict storage. */
export function conflictCommandContextData(context: RequestContext): ConflictCommandContextData {
  if (!canReadConflictReceipt(context))
    throw new ContractError('DENIED', 'A verified unexpired conflict resolver is required', {
      trace_id: context.trace_id,
    });
  try {
    return parseConflictCommandContextEnvelope(
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
          permissions: { resolve_conflicts: true },
        },
      },
      context,
      context.trace_id,
    ).data;
  } catch {
    throw new ContractError(
      'CONFLICT_COMMAND_CONTEXT_INVALID',
      'Verified conflict identity could not be represented',
      {
        trace_id: context.trace_id,
        retryable: false,
      },
    );
  }
}

export function registerConflictCommandContext(router: CommandRouter) {
  router.register('conflict.command-context', (request) => {
    const context = structuredClone(request.context);
    const data = conflictCommandContextData(context);
    if (
      Object.keys(request.input).length ||
      context.idempotency_key !== undefined ||
      context.expected_version !== undefined
    )
      throw new ContractError(
        'INVALID_INPUT',
        'Conflict command context takes no parameters or write conditions',
        {
          trace_id: context.trace_id,
        },
      );
    return { schema_version: 1, trace_id: context.trace_id, source_refs: [], data };
  });
}
