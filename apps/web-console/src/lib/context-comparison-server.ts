import { randomUUID } from 'node:crypto';
import { ContractError, type ContextItemRevision } from '@planemem/contracts';
import {
  compareContextSnapshots,
  parseContextComparisonQuery,
} from '../app/context/history/compare/model';
import { readContextHistoryResponse, contextHistoryReadFailure } from './context-history-response';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchArtifactTransferSession,
} from './server-api';
import { runtimeConfig } from './config';

/** Two fixed snapshots, one captured session/scope/base URL and one total read budget. */
export async function getWorkbenchContextComparison(input: unknown) {
  const query = parseContextComparisonQuery(input);
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
      'Context comparison is unavailable.',
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
        'Context comparison exceeded the local read deadline.',
        trace,
        502,
        'GATEWAY_REQUEST_TIMEOUT',
      );
  };
  const read = async (version: number) => {
    const trace = 'trace_web_context_compare_' + randomUUID();
    assertActive(trace);
    let response: Response;
    try {
      response = await fetch(
        base.href.replace(/\/$/, '') +
          '/v1/context-items/' +
          encodeURIComponent(query.item_id) +
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
        'The selected context versions could not be read.',
        trace,
        502,
        'GATEWAY_UNAVAILABLE',
      );
    }
    try {
      assertActive(trace);
      if (response.status === 401) throw new AuthRequiredError();
      const result = await readContextHistoryResponse(
        response,
        signal,
        trace,
        deadline,
        { kind: 'version', item_id: query.item_id, version },
        session.scope,
      );
      assertActive(trace);
      return { ...result, data: result.data as ContextItemRevision };
    } catch (error) {
      void response.body?.cancel().catch(() => undefined);
      assertActive(trace);
      if (error instanceof AuthRequiredError || error instanceof WorkbenchApiError) throw error;
      const failure =
        error instanceof ContractError
          ? error
          : contextHistoryReadFailure('GATEWAY_RESPONSE_INVALID', trace);
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
  let comparison: ReturnType<typeof compareContextSnapshots>;
  try {
    comparison = compareContextSnapshots(from.data, to.data);
  } catch {
    assertActive(to.trace_id);
    throw new WorkbenchApiError(
      'The complete context snapshots could not be compared.',
      to.trace_id,
      502,
      'GATEWAY_RESPONSE_INVALID',
    );
  }
  assertActive(to.trace_id);
  return { query, from, to, comparison };
}
