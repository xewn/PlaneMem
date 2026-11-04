import { randomUUID } from 'node:crypto';
import { ContractError, parseArtifactReadEnvelope } from '@planemem/contracts';
import {
  compareArtifactMetadata,
  parseArtifactComparisonQuery,
} from '../app/artifacts/compare/model';
import { artifactLookupFailure, readArtifactLookupResponse } from './artifact-read-response';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchArtifactTransferSession,
} from './server-api';
import { runtimeConfig } from './config';

/** Both historical reads use the same captured session, scope, base URL and total deadline. */
export async function getWorkbenchArtifactComparison(input: unknown) {
  const query = parseArtifactComparisonQuery(input);
  const session = await getWorkbenchArtifactTransferSession();
  let base: URL;
  try {
    base = new URL(runtimeConfig.apiUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new TypeError();
  } catch {
    throw new WorkbenchApiError(
      'File comparison is unavailable.',
      undefined,
      503,
      'GATEWAY_UNAVAILABLE',
    );
  }
  const deadline = Date.now() + 30_000;
  const signal = AbortSignal.timeout(30_000);
  const assertActive = (trace: string) => {
    if (session.expires_at * 1000 <= Date.now()) throw new AuthRequiredError();
    if (signal.aborted || Date.now() >= deadline)
      throw new WorkbenchApiError(
        'File comparison exceeded the local read deadline.',
        trace,
        502,
        'GATEWAY_REQUEST_TIMEOUT',
      );
  };
  const read = async (version: number) => {
    const trace = 'trace_web_compare_' + randomUUID();
    assertActive(trace);
    let response: Response;
    try {
      response = await fetch(
        base.href.replace(/\/$/, '') +
          '/v1/artifacts/' +
          encodeURIComponent(query.artifact_id) +
          '/versions/' +
          version,
        {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
          signal,
          headers: {
            authorization: 'Bearer ' + session.access_token,
            accept: 'application/json',
            'x-trace-id': trace,
            'x-tenant-id': session.scope.tenant_id,
            'x-workspace-id': session.scope.workspace_id,
            'x-project-id': session.scope.project_id,
          },
        },
      );
    } catch {
      assertActive(trace);
      throw new WorkbenchApiError(
        'The selected file versions could not be read.',
        trace,
        502,
        'GATEWAY_UNAVAILABLE',
      );
    }
    try {
      assertActive(trace);
      if (response.status === 401) throw new AuthRequiredError();
    } catch (error) {
      void response.body?.cancel().catch(() => undefined);
      throw error;
    }
    try {
      const result = await readArtifactLookupResponse(
        response,
        signal,
        trace,
        deadline,
        'historical',
        (value) =>
          parseArtifactReadEnvelope(
            value,
            { artifact_id: query.artifact_id, version },
            session.scope,
            trace,
          ),
      );
      assertActive(trace);
      return result;
    } catch (error) {
      if (error instanceof AuthRequiredError || error instanceof WorkbenchApiError) throw error;
      const failure =
        error instanceof ContractError
          ? error
          : artifactLookupFailure('historical', 'GATEWAY_RESPONSE_INVALID', trace);
      throw new WorkbenchApiError(
        failure.envelope.message,
        trace,
        response.ok ||
        ['GATEWAY_RESPONSE_INVALID', 'GATEWAY_REQUEST_TIMEOUT'].includes(failure.envelope.code)
          ? 502
          : response.status,
        failure.envelope.code,
      );
    }
  };
  const from = await read(query.from_version);
  const to = await read(query.to_version);
  const comparison = compareArtifactMetadata(from.data.artifact, to.data.artifact);
  assertActive(to.trace_id);
  return { query, from, to, comparison };
}
