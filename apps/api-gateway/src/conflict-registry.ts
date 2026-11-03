import {
  ContractError,
  parseConflictRegistryQuery,
  parseConflictRegistryEnvelope,
} from '@planemem/contracts';
import type { CommandRequest } from './router.js';
import type { WorkbenchRepository } from './workbench/repository.js';
export async function readConflictRegistry(
  repository: WorkbenchRepository,
  request: CommandRequest,
) {
  const { context } = request;
  const { trace_id } = context;
  let query;
  try {
    if (context.idempotency_key !== undefined || context.expected_version !== undefined)
      throw new TypeError();
    query = parseConflictRegistryQuery(request.input);
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Supply valid conflict filters and an unchanged cursor without write conditions',
      { trace_id },
    );
  }
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
    read_restricted: context.capability.includes('data.restricted.read'),
  };
  const page = await repository.listConflicts(scope, trace_id, query);
  try {
    return parseConflictRegistryEnvelope(
      {
        ...page,
        conflict_permissions: {
          resolve:
            context.authenticated_client === true &&
            (context.roles?.includes('admin') === true ||
              context.capability.includes('conflict.resolve')),
        },
      },
      query,
      scope,
      trace_id,
    );
  } catch {
    throw new ContractError(
      'CONFLICT_REGISTRY_INVALID',
      'Conflict directory response could not be validated',
      { trace_id },
    );
  }
}
