import {
  ContractError,
  assertArtifactReceiptIdentity,
  parseArtifactReceiptQuery,
  parseArtifactReceiptEnvelope,
} from '@planemem/contracts';
import type { PersistentArtifactService } from '@planemem/artifact-service';
import { publicArtifactMetadata } from './artifact-reads.js';
import type { CommandRouter } from './router.js';

export type ArtifactReceiptReader = Pick<PersistentArtifactService, 'getCommandReceipt'>;

export function registerArtifactReceipts(
  router: CommandRouter,
  reader: ArtifactReceiptReader | undefined,
) {
  router.register('artifact.receipt', async (request) => {
    const context = { ...request.context, capability: [...request.context.capability] };
    if (context.authenticated_client !== true || !context.capability.includes('artifact.write'))
      throw new ContractError('ARTIFACT_ACCESS_DENIED', 'A verified artifact writer is required', {
        trace_id: context.trace_id,
      });
    let query;
    try {
      if (context.idempotency_key !== undefined || context.expected_version !== undefined)
        throw new TypeError();
      query = parseArtifactReceiptQuery(request.input);
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Supply the original identity and complete artifact command without write headers',
        {
          trace_id: context.trace_id,
        },
      );
    }
    try {
      assertArtifactReceiptIdentity(query.identity, context);
    } catch {
      throw new ContractError(
        'ARTIFACT_ACCESS_DENIED',
        'The original artifact identity does not match the verified session',
        {
          trace_id: context.trace_id,
        },
      );
    }
    if (!reader)
      throw new ContractError(
        'ARTIFACT_STORAGE_UNAVAILABLE',
        'Persistent artifact receipts are not configured',
        {
          trace_id: context.trace_id,
          retryable: true,
        },
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
    // Providers receive copies so their execution cannot change the response binding.
    const saved = await reader.getCommandReceipt(access, parseArtifactReceiptQuery(query).command);
    let result;
    try {
      if (!saved || saved.trace_id !== context.trace_id) throw new TypeError();
      const fields =
        saved.status === 'recorded'
          ? ['status', 'artifact', 'replayed', 'trace_id']
          : ['status', 'trace_id'];
      if (Object.keys(saved).some((key) => !fields.includes(key))) throw new TypeError();
      const data =
        saved.status === 'recorded'
          ? {
              ...query,
              status: saved.status,
              artifact: publicArtifactMetadata(saved.artifact),
              replayed: saved.replayed,
              content_state: 'not-checked',
            }
          : { ...query, status: saved.status };
      result = parseArtifactReceiptEnvelope(
        {
          schema_version: 1,
          trace_id: saved.trace_id,
          source_refs:
            saved.status === 'recorded'
              ? [
                  {
                    type: 'artifact',
                    id: saved.artifact.artifact_id,
                    revision: saved.artifact.version,
                  },
                ]
              : [],
          data,
        },
        query,
        context.trace_id,
      );
    } catch {
      throw new ContractError(
        'ARTIFACT_STORED_INVALID',
        'Stored artifact receipt is invalid; keep the original request',
        {
          trace_id: context.trace_id,
        },
      );
    }
    if (
      result.data.status === 'recorded' &&
      result.data.artifact.classification === 'restricted' &&
      !context.capability.includes('data.restricted.read')
    )
      throw new ContractError('ARTIFACT_ACCESS_DENIED', 'Restricted artifact access is required', {
        trace_id: context.trace_id,
      });
    return result;
  });
}
