import {
  ContractError,
  parseArtifactVersionsQuery,
  parseArtifactVersionsEnvelope,
} from '@planemem/contracts';
import type { PersistentArtifactService } from '@planemem/artifact-service';
import type { CommandRouter } from './router.js';

export type ArtifactVersionReader = Pick<PersistentArtifactService, 'listVersions'>;

export function registerArtifactVersions(
  router: CommandRouter,
  reader: ArtifactVersionReader | undefined,
) {
  router.register('artifact.versions.list', async (request) => {
    const context = { ...request.context, capability: [...request.context.capability] };
    if (!context.capability.includes('artifact.read'))
      throw new ContractError('ARTIFACT_ACCESS_DENIED', 'Artifact read capability is required', {
        trace_id: context.trace_id,
      });
    let query;
    try {
      if (
        context.idempotency_key !== undefined ||
        context.expected_version !== undefined ||
        Reflect.get(context, 'if_match') !== undefined
      )
        throw new TypeError();
      query = parseArtifactVersionsQuery(request.input);
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Supply a bounded artifact version query without write conditions',
        {
          trace_id: context.trace_id,
        },
      );
    }
    if (!reader)
      throw new ContractError(
        'ARTIFACT_STORAGE_UNAVAILABLE',
        'Artifact version directory is not configured',
        {
          trace_id: context.trace_id,
          retryable: true,
        },
      );
    const page = await reader.listVersions(
      {
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
        trace_id: context.trace_id,
        capabilities: [...context.capability],
      },
      { ...query },
    );
    let result;
    try {
      result = parseArtifactVersionsEnvelope(
        {
          schema_version: 1,
          trace_id: context.trace_id,
          source_refs: [{ type: 'artifact', id: query.artifact_id }],
          data: page,
        },
        query,
        context,
        context.trace_id,
      );
    } catch {
      throw new ContractError(
        'ARTIFACT_STORED_INVALID',
        'Stored artifact version directory is invalid',
        {
          trace_id: context.trace_id,
        },
      );
    }
    if (
      !context.capability.includes('data.restricted.read') &&
      result.data.items.some((item) => item.classification === 'restricted')
    )
      throw new ContractError('ARTIFACT_ACCESS_DENIED', 'Restricted artifact access is required', {
        trace_id: context.trace_id,
      });
    return result;
  });
}
