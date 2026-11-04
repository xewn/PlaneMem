import {
  ContractError,
  parseContextItemDirectoryQuery,
  parseContextItemDirectoryEnvelope,
  parseWorkItemProjectionQuery,
  parseWorkItemListQuery,
  isUlid,
  parseSessionCommandIdentity,
  parseCheckpointHistoryQuery,
  parseCheckpointHistoryWorkbenchEnvelope,
  CheckpointReadLimitError,
  parseWorkbenchAuditQuery,
  parseSessionRegistryQuery,
  parseSessionRegistryEnvelope,
  parseHandoffRegistryQuery,
  parseHandoffRegistryEnvelope,
  parseCheckpointRegistryQuery,
  parseCheckpointRegistryEnvelope,
} from '@planemem/contracts';
import type { CommandRequest } from '../router.js';
import { readConflictRegistry } from '../conflict-registry.js';
import type { WorkbenchRepository, ContextFilters } from './repository.js';

export const WORKBENCH_QUERY_PATH = '/v1/workbench/query';

export async function queryWorkbench(
  repository: WorkbenchRepository,
  request: CommandRequest,
  version: string,
) {
  const { input, context } = request;
  const { trace_id } = context;
  const hasClient = context.authenticated_client !== false;
  const admin = context.roles?.includes('admin') === true;
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
    read_restricted: context.capability.includes('data.restricted.read'),
  };
  const sessionMetadata = () => ({
    session_permissions: {
      write_sessions:
        context.authenticated_client === true &&
        (admin || context.capability.includes('session.write')),
    },
    ...(context.authenticated_client === true
      ? {
          session_identity: parseSessionCommandIdentity({
            tenant_id: context.tenant_id,
            workspace_id: context.workspace_id,
            project_id: context.project_id,
            actor_id: context.actor_id,
            client_id: context.client_id,
          }),
        }
      : {}),
  });
  switch (input.operation) {
    case 'overview':
      if (Object.keys(input).some((key) => key !== 'operation'))
        throw new ContractError('INVALID_INPUT', 'Overview accepts no query fields', { trace_id });
      return repository.listOverview(scope, trace_id);
    case 'work_item': {
      let query;
      try {
        const { operation, ...fields } = input;
        query = parseWorkItemProjectionQuery(fields);
      } catch (error) {
        throw new ContractError(
          'INVALID_INPUT',
          error instanceof Error ? error.message : 'Invalid work item query',
          { trace_id },
        );
      }
      return repository.getWorkItem(scope, trace_id, query.item_id);
    }
    case 'work_items': {
      let query;
      try {
        const { operation, ...fields } = input;
        query = parseWorkItemListQuery(fields);
      } catch (error) {
        throw new ContractError(
          'INVALID_INPUT',
          error instanceof Error ? error.message : 'Invalid work item list query',
          { trace_id },
        );
      }
      return repository.listWorkItems(scope, trace_id, query);
    }
    case 'context': {
      let filters: ContextFilters;
      try {
        const { operation, ...query } = input;
        filters = parseContextItemDirectoryQuery(query);
      } catch (error) {
        throw new ContractError(
          'INVALID_INPUT',
          error instanceof Error ? error.message : 'Invalid context filter',
          { trace_id },
        );
      }
      const result = {
        ...(await repository.listContext(scope, trace_id, filters)),
        context_permissions: {
          compile: hasClient && (admin || context.capability.includes('context.read')),
          write:
            context.authenticated_client === true &&
            (admin || context.capability.includes('context.write')),
          restricted: context.capability.includes('data.restricted.read'),
          propose:
            context.authenticated_client === true &&
            (admin || context.capability.includes('proposal.write')),
        },
      };
      try {
        return parseContextItemDirectoryEnvelope(result, filters, scope, trace_id);
      } catch {
        throw new ContractError(
          'CONTEXT_ITEM_INVALID',
          'The complete context directory could not be validated',
          { trace_id },
        );
      }
    }
    case 'sessions': {
      let query;
      try {
        const { operation, ...fields } = input;
        query = parseSessionRegistryQuery(fields);
      } catch {
        throw new ContractError(
          'INVALID_INPUT',
          'Supply valid session filters and an unchanged continuation cursor',
          { trace_id },
        );
      }
      const result = {
        ...(await repository.listSessions(scope, trace_id, query)),
        ...sessionMetadata(),
      };
      try {
        return parseSessionRegistryEnvelope(result, query, scope, trace_id);
      } catch {
        throw new ContractError(
          'SESSION_REGISTRY_INVALID',
          'Session registry response could not be validated',
          { trace_id },
        );
      }
    }
    case 'session':
      if (
        !isUlid(input.session_id) ||
        Object.keys(input).some((key) => !['operation', 'session_id'].includes(key))
      )
        throw new ContractError('INVALID_INPUT', 'Supply only a session_id ULID', { trace_id });
      return {
        ...(await repository.getSessionState(scope, trace_id, input.session_id)),
        ...sessionMetadata(),
      };
    case 'handoffs': {
      let query;
      try {
        const { operation, ...fields } = input;
        query = parseHandoffRegistryQuery(fields);
      } catch {
        throw new ContractError(
          'INVALID_INPUT',
          'Supply valid handoff filters and an unchanged continuation cursor',
          { trace_id },
        );
      }
      const result = await repository.listHandoffs(scope, trace_id, query);
      const metadata = sessionMetadata();
      const verified = context.authenticated_client === true;
      const page = {
        ...result,
        ...metadata,
        handoff_permissions: {
          write_sessions: metadata.session_permissions.write_sessions,
          claim:
            metadata.session_permissions.write_sessions ||
            (verified && context.capability.includes('handoff.claim')),
        },
        data: result.data.map((handoff) => ({
          ...handoff,
          recipient_matches:
            verified &&
            handoff.origin === 'session' &&
            (!handoff.offered_to || handoff.offered_to === context.client_id),
          claimed_here:
            verified &&
            handoff.origin === 'session' &&
            handoff.claimed_by === context.client_id &&
            handoff.claimed_by_actor === context.actor_id,
        })),
      };
      try {
        return parseHandoffRegistryEnvelope(page, query, scope, trace_id);
      } catch {
        throw new ContractError(
          'HANDOFF_REGISTRY_INVALID',
          'Handoff registry response could not be validated',
          { trace_id },
        );
      }
    }
    case 'checkpoints': {
      if (input.session_id !== undefined) {
        let query;
        try {
          const { operation, ...fields } = input;
          query = parseCheckpointHistoryQuery(fields);
        } catch {
          throw new ContractError(
            'INVALID_INPUT',
            'Supply a session ULID and optional positive revision cursor',
            { trace_id },
          );
        }
        const page = {
          ...(await repository.sessionCheckpoints(
            scope,
            trace_id,
            query.session_id,
            query.before_revision,
          )),
          ...sessionMetadata(),
        };
        try {
          return parseCheckpointHistoryWorkbenchEnvelope(page, query, scope, trace_id);
        } catch (error) {
          throw new ContractError(
            error instanceof CheckpointReadLimitError
              ? 'CHECKPOINT_READ_TOO_LARGE'
              : 'SESSION_ACTIVITY_INVALID',
            'Checkpoint history could not be returned in full',
            { trace_id },
          );
        }
      }
      let query;
      try {
        const { operation, ...fields } = input;
        query = parseCheckpointRegistryQuery(fields);
      } catch {
        throw new ContractError(
          'INVALID_INPUT',
          'Supply valid checkpoint filters and an unchanged continuation cursor',
          { trace_id },
        );
      }
      const page = await repository.listCheckpoints(scope, trace_id, query);
      try {
        return parseCheckpointRegistryEnvelope(
          { ...page, ...sessionMetadata() },
          query,
          scope,
          trace_id,
        );
      } catch {
        throw new ContractError(
          'CHECKPOINT_REGISTRY_INVALID',
          'Checkpoint registry response could not be validated',
          { trace_id },
        );
      }
    }
    case 'conflicts': {
      const { operation, ...fields } = input;
      return readConflictRegistry(repository, { ...request, input: fields });
    }
    case 'audit': {
      let query;
      try {
        const { operation, ...fields } = input;
        query = parseWorkbenchAuditQuery(fields);
      } catch {
        throw new ContractError('INVALID_INPUT', 'Supply valid exact audit filters only', {
          trace_id,
        });
      }
      return repository.listAudit(scope, trace_id, query);
    }
    case 'admin': {
      if (Object.keys(input).some((key) => key !== 'operation'))
        throw new ContractError('INVALID_INPUT', 'Administration accepts no query fields', {
          trace_id,
        });
      const expiry = Date.parse(context.token_expires_at ?? '');
      const assertAdministrator = () => {
        if (
          context.authenticated_client !== true ||
          !admin ||
          !context.capability.includes('admin.read') ||
          !Number.isFinite(expiry) ||
          Date.now() >= expiry
        )
          throw new ContractError(
            'DENIED',
            'A verified administrator with admin.read is required',
            {
              trace_id,
            },
          );
      };
      assertAdministrator();
      const result = await repository.adminHealth(scope, trace_id, version, {
        audit: context.capability.includes('audit.read'),
        context: context.capability.includes('context.read'),
      });
      assertAdministrator();
      return result;
    }
    default:
      throw new ContractError(
        'WORKBENCH_OPERATION_UNSUPPORTED',
        'Workbench operation is unsupported',
        { trace_id },
      );
  }
}
