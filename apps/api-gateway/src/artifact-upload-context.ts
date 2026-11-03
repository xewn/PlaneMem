import {
  ARTIFACT_UPLOAD_MAX_BYTES,
  ContractError,
  parseArtifactUploadContextEnvelope,
} from '@planemem/contracts';
import type { CommandRouter } from './router.js';

export function registerArtifactUploadContext(router: CommandRouter, maximum: number) {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > ARTIFACT_UPLOAD_MAX_BYTES)
    throw new RangeError('Invalid artifact upload context limit');
  router.register('artifact.upload-context', (request) => {
    const context = { ...request.context, capability: [...request.context.capability] };
    const expires = Date.parse(context.token_expires_at ?? '');
    if (
      context.authenticated_client !== true ||
      !context.capability.includes('artifact.write') ||
      !Number.isFinite(expires) ||
      expires <= Date.now()
    )
      throw new ContractError(
        'DENIED',
        'A verified artifact writer with a valid session is required',
        { trace_id: context.trace_id },
      );
    if (
      Object.keys(request.input).length ||
      context.idempotency_key !== undefined ||
      context.expected_version !== undefined
    )
      throw new ContractError(
        'INVALID_INPUT',
        'Upload context takes no parameters or write conditions',
        { trace_id: context.trace_id },
      );
    return parseArtifactUploadContextEnvelope(
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
          expires_at: new Date(expires).toISOString(),
          max_bytes: maximum,
          can_read: context.capability.includes('artifact.read'),
          can_read_restricted: context.capability.includes('data.restricted.read'),
        },
      },
      context,
      context.trace_id,
    );
  });
}
