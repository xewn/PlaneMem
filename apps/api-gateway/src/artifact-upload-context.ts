import {
  ARTIFACT_UPLOAD_MAX_BYTES,
  ContractError,
  assertArtifactReceiptIdentity,
  parseArtifactCommandIdentity,
  parseArtifactUploadContextEnvelope,
  syncJsonSnapshot,
} from '@planemem/contracts';
import type { CommandRouter, RequestContext } from './router.js';

export function canReadArtifactUploadContext(context: RequestContext): boolean {
  const expires = Date.parse(context.token_expires_at ?? '');
  return (
    context.authenticated_client === true &&
    context.capability.includes('artifact.write') &&
    Number.isFinite(expires) &&
    expires > Date.now()
  );
}

/** Trusted current authority only; these hints never authorize a future upload. */
export function artifactUploadContextAuthority(context: RequestContext) {
  if (!canReadArtifactUploadContext(context))
    throw new ContractError(
      'DENIED',
      'A verified artifact writer with a valid session is required',
      { trace_id: context.trace_id },
    );
  try {
    return {
      identity: parseArtifactCommandIdentity({
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
      }),
      expires_at: new Date(context.token_expires_at!).toISOString(),
      can_read: context.capability.includes('artifact.read'),
      can_read_restricted: context.capability.includes('data.restricted.read'),
    };
  } catch {
    throw new ContractError(
      'ARTIFACT_UPLOAD_CONTEXT_INVALID',
      'Verified upload identity could not be represented',
      { trace_id: context.trace_id },
    );
  }
}

/** Embedded adapters compare all authority-derived fields, not just the caller's project. */
export function artifactUploadContextResult(value: unknown, context: RequestContext) {
  const expected = artifactUploadContextAuthority(context);
  try {
    const result = parseArtifactUploadContextEnvelope(
      JSON.parse(syncJsonSnapshot(value, 16 * 1024)),
      context,
      context.trace_id,
    );
    assertArtifactReceiptIdentity(result.data.identity, expected.identity);
    if (
      result.data.expires_at !== expected.expires_at ||
      result.data.can_read !== expected.can_read ||
      result.data.can_read_restricted !== expected.can_read_restricted
    )
      throw new TypeError();
    artifactUploadContextAuthority(context);
    return result;
  } catch (error) {
    if (error instanceof ContractError && error.envelope.code === 'DENIED') throw error;
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Upload identity did not match verified authority',
      { trace_id: context.trace_id, retryable: false },
    );
  }
}

export function registerArtifactUploadContext(router: CommandRouter, maximum: number) {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > ARTIFACT_UPLOAD_MAX_BYTES)
    throw new RangeError('Invalid artifact upload context limit');
  router.register('artifact.upload-context', (request) => {
    const context = { ...request.context, capability: [...request.context.capability] };
    const authority = artifactUploadContextAuthority(context);
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
          ...authority,
          max_bytes: maximum,
        },
      },
      context,
      context.trace_id,
    );
  });
}
