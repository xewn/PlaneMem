import {
  ContractError,
  isSyncIdentifier,
  parseArtifactUploadContextEnvelope,
  syncJsonSnapshot,
  type ArtifactUploadContextEnvelope,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpArtifactUploadContextOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const RESPONSE_BYTES = 16 * 1024;
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply a project scope, optional account/client constraints and valid timeout/signal options',
  DENIED: 'A verified unexpired artifact writer is required',
  ARTIFACT_ACCESS_DENIED: 'The current account or client cannot read this upload identity',
  ARTIFACT_UPLOAD_CONTEXT_INVALID: 'The verified upload identity could not be represented',
  UNAUTHENTICATED: 'Renew the session to read its artifact upload identity',
  RATE_LIMITED: 'Artifact upload identity reads are temporarily busy',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The upload identity read audit could not be persisted',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for artifact upload identity',
  GATEWAY_REQUEST_TIMEOUT: 'Artifact upload identity exceeded the local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete artifact upload identity did not match this request or expired',
  GATEWAY_UNAVAILABLE: 'Artifact upload identity could not be read',
};
function validText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}

/** Discover the current writer only; never replace an existing upload's original identity. */
export async function readArtifactUploadContext(
  transport: WcpTransport,
  original: RequestContext,
  options: WcpArtifactUploadContextOptions,
): Promise<ArtifactUploadContextEnvelope> {
  const context = { ...original };
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, {
      trace_id: trace,
      retryable: false,
    });
  if (
    !validText(trace) ||
    !context.project_id ||
    [context.tenant_id, context.workspace_id, context.project_id].some(
      (id) => !isSyncIdentifier(id) || id === '.' || id === '..',
    ) ||
    (context.actor_id !== undefined && !validText(context.actor_id)) ||
    (context.client_id !== undefined && !validText(context.client_id)) ||
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !['timeout_ms', 'signal'].includes(key))
  )
    throw fail('INVALID_INPUT');
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  const budget = createRequestBudget(
    trace,
    options.timeout_ms === undefined ? 30_000 : options.timeout_ms,
    options.signal,
  );
  try {
    const raw = await budget.wait(() =>
      transport.request({
        method: 'GET',
        path: '/v1/artifacts/upload-context',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let result: ArtifactUploadContextEnvelope;
    try {
      // Custom transports also have to return complete bounded plain JSON, without shared objects.
      const detached: unknown = JSON.parse(syncJsonSnapshot(raw, RESPONSE_BYTES));
      result = parseArtifactUploadContextEnvelope(detached, scope, trace);
      if (
        Date.parse(result.data.expires_at) <= Date.now() ||
        !validText(result.data.identity.actor_id) ||
        !validText(result.data.identity.client_id) ||
        (context.actor_id !== undefined && result.data.identity.actor_id !== context.actor_id) ||
        (context.client_id !== undefined && result.data.identity.client_id !== context.client_id)
      )
        throw new TypeError();
    } catch {
      budget.check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    budget.check();
    return result;
  } catch (error) {
    throw fail(
      error instanceof ContractError &&
        error.envelope.trace_id === trace &&
        Object.hasOwn(messages, error.envelope.code)
        ? error.envelope.code
        : 'GATEWAY_UNAVAILABLE',
    );
  } finally {
    budget.close();
  }
}
