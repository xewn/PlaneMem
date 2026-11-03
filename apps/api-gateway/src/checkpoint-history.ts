import {
  ContractError,
  parseCheckpointHistoryQuery,
  parseCheckpointHistoryEnvelope,
  CheckpointReadLimitError,
} from '@planemem/contracts';
import type { CommandRouter } from './router.js';
import type { WorkbenchRepository } from './workbench/repository.js';

export function registerCheckpointHistory(router: CommandRouter, repository: WorkbenchRepository) {
  router.register('session.checkpoints.list', async (request) => {
    const context = request.context;
    let query;
    try {
      query = parseCheckpointHistoryQuery(request.input);
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Supply a session ULID and optional positive revision cursor',
        { trace_id: context.trace_id },
      );
    }
    const page = await repository.sessionCheckpoints(
      { ...context, read_restricted: context.capability.includes('data.restricted.read') },
      context.trace_id,
      query.session_id,
      query.before_revision,
    );
    try {
      return parseCheckpointHistoryEnvelope(
        {
          ...page,
          tenant_id: context.tenant_id,
          workspace_id: context.workspace_id,
          project_id: context.project_id,
        },
        query,
        context,
        context.trace_id,
      );
    } catch (error) {
      if (error instanceof CheckpointReadLimitError)
        throw new ContractError(
          'CHECKPOINT_READ_TOO_LARGE',
          'Checkpoint history exceeds the complete read limit; no partial page was returned',
          { trace_id: context.trace_id },
        );
      throw new ContractError('SESSION_ACTIVITY_INVALID', 'Stored checkpoint history is invalid', {
        trace_id: context.trace_id,
      });
    }
  });
}
