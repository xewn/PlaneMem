import { randomUUID } from 'node:crypto';
import {
  parseArtifactReadQuery,
  parseArtifactReadEnvelope,
  parseArtifactUploadContextEnvelope,
  validateErrorEnvelope,
} from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchArtifactTransferSession,
} from './server-api';
import { runtimeConfig } from './config';
import { readArtifactTransferBytes } from './artifact-transfer';
import { parseArtifactUploadPreparation } from '../app/artifacts/upload/preparation-model';

/** One signed session snapshot binds the writer context and optional current-version read. */
export async function getWorkbenchArtifactPreparation(artifactId?: string) {
  if (artifactId !== undefined) parseArtifactReadQuery({ artifact_id: artifactId });
  const session = await getWorkbenchArtifactTransferSession();
  const signal = AbortSignal.timeout(30_000);
  let base: URL;
  try {
    base = new URL(runtimeConfig.apiUrl);
  } catch {
    throw new WorkbenchApiError(
      'File preparation is unavailable.',
      undefined,
      503,
      'GATEWAY_UNAVAILABLE',
    );
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new WorkbenchApiError(
      'File preparation is unavailable.',
      undefined,
      503,
      'GATEWAY_UNAVAILABLE',
    );
  const headers: Record<string, string> = {
    authorization: 'Bearer ' + session.access_token,
    accept: 'application/json',
    'x-tenant-id': session.scope.tenant_id,
    'x-workspace-id': session.scope.workspace_id,
    'x-project-id': session.scope.project_id,
  };
  const read = async (path: string, trace: string, maximum: number) => {
    let response: Response;
    try {
      response = await fetch(base.href.replace(/\/$/, '') + path, {
        method: 'GET',
        headers: { ...headers, 'x-trace-id': trace },
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } catch {
      throw new WorkbenchApiError(
        'File preparation could not be read.',
        trace,
        503,
        'GATEWAY_UNAVAILABLE',
      );
    }
    if (!response.ok) {
      let code: string | undefined;
      try {
        const bytes = await readArtifactTransferBytes(response.body, 16 * 1024, signal);
        const failure = validateErrorEnvelope(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        );
        if (failure.trace_id === trace) code = failure.code;
      } catch {
        /* Never forward raw gateway errors. */
      }
      if (response.status === 401) throw new AuthRequiredError();
      throw new WorkbenchApiError(
        'File preparation or the selected record is unavailable.',
        trace,
        response.status,
        code,
      );
    }
    try {
      if (
        response.status !== 200 ||
        response.headers.get('x-trace-id') !== trace ||
        !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
      ) {
        void response.body?.cancel().catch(() => {});
        throw new TypeError();
      }
      const bytes = await readArtifactTransferBytes(response.body, maximum, signal);
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw new WorkbenchApiError(
        'File preparation returned an invalid response.',
        trace,
        502,
        'GATEWAY_RESPONSE_INVALID',
      );
    }
  };
  const contextTrace = 'trace_web_prepare_' + randomUUID();
  const value = await read('/v1/artifacts/upload-context', contextTrace, 16 * 1024);
  let context;
  try {
    context = parseArtifactUploadContextEnvelope(value, session.scope, contextTrace);
  } catch {
    throw new WorkbenchApiError(
      'File preparation does not match this session.',
      contextTrace,
      502,
      'GATEWAY_RESPONSE_INVALID',
    );
  }
  if (Date.parse(context.data.expires_at) <= Date.now() || session.expires_at * 1000 <= Date.now())
    throw new AuthRequiredError();
  if (artifactId === undefined) return parseArtifactUploadPreparation({ context });
  if (!context.data.can_read)
    throw new WorkbenchApiError(
      'Reading the current file is required to prepare a new version.',
      contextTrace,
      403,
      'DENIED',
    );
  headers['x-expected-actor-id'] = context.data.identity.actor_id;
  headers['x-expected-client-id'] = context.data.identity.client_id;
  const targetTrace = 'trace_web_prepare_' + randomUUID();
  const targetValue = await read(
    '/v1/artifacts/' + encodeURIComponent(artifactId),
    targetTrace,
    2 * 1024 * 1024,
  );
  try {
    const target = parseArtifactReadEnvelope(
      targetValue,
      { artifact_id: artifactId },
      context.data.identity,
      targetTrace,
    );
    if (
      Date.parse(context.data.expires_at) <= Date.now() ||
      session.expires_at * 1000 <= Date.now()
    )
      throw new AuthRequiredError();
    return parseArtifactUploadPreparation({ context, target }, artifactId);
  } catch (error) {
    if (error instanceof AuthRequiredError) throw error;
    throw new WorkbenchApiError(
      'The selected current file could not be verified.',
      targetTrace,
      502,
      'GATEWAY_RESPONSE_INVALID',
    );
  }
}
