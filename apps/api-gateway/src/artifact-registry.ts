import {
  ContractError,
  parseArtifactRegistryQuery,
  parseArtifactRegistryPage,
  parseArtifactRegistryEnvelope,
} from '@planemem/contracts';
import type { PersistentArtifactService } from '@planemem/artifact-service';
import type { CommandRouter } from './router.js';

export type ArtifactRegistryReader = Pick<PersistentArtifactService, 'listArtifacts'>;

export function registerArtifactRegistry(
  router: CommandRouter,
  reader: ArtifactRegistryReader | undefined,
) {
  router.register('artifact.registry.list', async (request) => {
    const context = { ...request.context, capability: [...request.context.capability] };
    const assertSession = () => {
      if (
        context.authenticated_client !== true ||
        typeof context.token_expires_at !== 'string' ||
        !Number.isFinite(Date.parse(context.token_expires_at)) ||
        Date.parse(context.token_expires_at) <= Date.now()
      )
        throw new ContractError('DENIED', 'File directory requires a verified unexpired client', {
          trace_id: context.trace_id,
        });
    };
    assertSession();
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
      query = parseArtifactRegistryQuery(request.input);
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Supply a file directory query without write conditions',
        { trace_id: context.trace_id },
      );
    }
    if (
      query.classification === 'restricted' &&
      !context.capability.includes('data.restricted.read')
    )
      throw new ContractError('ARTIFACT_ACCESS_DENIED', 'Restricted artifact access is required', {
        trace_id: context.trace_id,
      });
    if (!reader)
      throw new ContractError('ARTIFACT_STORAGE_UNAVAILABLE', 'File directory is not configured', {
        trace_id: context.trace_id,
        retryable: true,
      });
    const page = await reader.listArtifacts(
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
      const bounded = parseArtifactRegistryPage(page, query, context);
      result = parseArtifactRegistryEnvelope(
        {
          schema_version: 1,
          trace_id: context.trace_id,
          source_refs: bounded.items.map((item) => ({ type: 'artifact', id: item.artifact_id })),
          data: bounded,
        },
        query,
        context,
        context.trace_id,
      );
    } catch {
      throw new ContractError('ARTIFACT_STORED_INVALID', 'Stored file directory is invalid', {
        trace_id: context.trace_id,
      });
    }
    if (
      !context.capability.includes('data.restricted.read') &&
      result.data.items.some((item) => item.classification === 'restricted')
    )
      throw new ContractError('ARTIFACT_ACCESS_DENIED', 'Restricted artifact access is required', {
        trace_id: context.trace_id,
      });
    assertSession();
    return result;
  });
}
