import {
  ContractError,
  parseArtifactReadQuery,
  parseArtifactReadEnvelope,
} from '@planemem/contracts';
import type {
  PersistentArtifactMetadata,
  PersistentArtifactService,
} from '@planemem/artifact-service';
import type { CommandRouter } from './router.js';

export type ArtifactMetadataReader = Pick<PersistentArtifactService, 'getArtifact' | 'getVersion'>;

export function registerArtifactReads(
  router: CommandRouter,
  reader: ArtifactMetadataReader | undefined,
) {
  for (const operation of ['artifact.read', 'artifact.version.read'] as const) {
    router.register(operation, async (request) => {
      const context = { ...request.context, capability: [...request.context.capability] };
      if (!context.capability.includes('artifact.read'))
        throw new ContractError('ARTIFACT_ACCESS_DENIED', 'Artifact read capability is required', {
          trace_id: context.trace_id,
        });
      let query;
      try {
        const input = { ...request.input };
        if (operation === 'artifact.version.read') {
          if (typeof input.version !== 'string' || !/^[1-9][0-9]{0,15}$/.test(input.version))
            throw new TypeError();
          input.version = Number(input.version);
        } else if (Object.hasOwn(input, 'version')) throw new TypeError();
        query = parseArtifactReadQuery(input);
      } catch {
        throw new ContractError(
          'INVALID_INPUT',
          'Supply an artifact ULID and a positive version for historical reads',
          { trace_id: context.trace_id },
        );
      }
      if (!reader)
        throw new ContractError(
          'ARTIFACT_STORAGE_UNAVAILABLE',
          'Persistent artifact storage is not configured',
          { trace_id: context.trace_id, retryable: true },
        );
      const access = {
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
        trace_id: context.trace_id,
        capabilities: [...context.capability],
      };
      const metadata =
        query.version === undefined
          ? await reader.getArtifact(access, query.artifact_id)
          : await reader.getVersion(access, query.artifact_id, query.version);
      let result;
      try {
        // Explicit public projection: do not spread internal fields or storage addresses.
        const artifact = publicArtifactMetadata(metadata);
        result = parseArtifactReadEnvelope(
          {
            schema_version: 1,
            trace_id: context.trace_id,
            revision: metadata.version,
            ...(query.version === undefined ? { etag: metadata.etag } : {}),
            source_refs: [{ type: 'artifact', id: query.artifact_id }],
            data: {
              artifact,
              snapshot: query.version === undefined ? 'current' : 'historical',
              content_state: 'not-checked',
            },
          },
          query,
          context,
          context.trace_id,
        );
      } catch {
        throw new ContractError('ARTIFACT_STORED_INVALID', 'Stored artifact metadata is invalid', {
          trace_id: context.trace_id,
        });
      }
      if (
        result.data.artifact.classification === 'restricted' &&
        !context.capability.includes('data.restricted.read')
      )
        throw new ContractError(
          'ARTIFACT_ACCESS_DENIED',
          'Restricted artifact access is required',
          { trace_id: context.trace_id },
        );
      return result;
    });
  }
}

/** Keep storage addresses out of every public artifact response. */
export function publicArtifactMetadata(metadata: PersistentArtifactMetadata) {
  return {
    schema_version: metadata.schema_version,
    tenant_id: metadata.tenant_id,
    workspace_id: metadata.workspace_id,
    project_id: metadata.project_id,
    artifact_id: metadata.artifact_id,
    name: metadata.name,
    mime: metadata.mime,
    classification: metadata.classification,
    source_refs: metadata.source_refs,
    sha256: metadata.sha256,
    size: metadata.size,
    version: metadata.version,
    etag: metadata.etag,
    trace_id: metadata.trace_id,
    created_at: metadata.created_at,
    updated_at: metadata.updated_at,
  };
}
