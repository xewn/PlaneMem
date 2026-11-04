import { randomUUID } from 'node:crypto';
import {
  ContractError,
  compareSavedContextPacks,
  parseContextPackComparisonQuery,
  syncJsonSnapshot,
} from '@planemem/contracts';
import { contextPackReadFailure, readContextPackResponse } from './context-pack-read-response';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchArtifactTransferSession,
} from './server-api';
import { runtimeConfig } from './config';

/** Capture one session and base URL; both explicit reads and the comparison share one budget. */
export async function getWorkbenchContextPackComparison(input: unknown) {
  const query = parseContextPackComparisonQuery(input);
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
      'Saved pack comparison is unavailable.',
      undefined,
      503,
      'GATEWAY_UNAVAILABLE',
    );
  }
  const deadline = Date.now() + 30_000;
  const monotonicDeadline = performance.now() + 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const signal = controller.signal;
  const active = (trace: string) => {
    if (session.expires_at * 1000 <= Date.now()) throw new AuthRequiredError();
    if (signal.aborted || Date.now() >= deadline || performance.now() >= monotonicDeadline)
      throw new WorkbenchApiError(
        'Saved pack comparison exceeded its read deadline.',
        trace,
        502,
        'GATEWAY_REQUEST_TIMEOUT',
      );
  };
  const read = async (packId: string) => {
    const trace = 'trace_web_pack_compare_' + randomUUID();
    active(trace);
    let response: Response;
    try {
      response = await fetch(
        base.href.replace(/\/$/, '') +
          '/v1/context-pack?' +
          new URLSearchParams({ pack_id: packId, format: 'json' }),
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
      active(trace);
      throw new WorkbenchApiError(
        'The selected saved packs could not be read.',
        trace,
        502,
        'GATEWAY_UNAVAILABLE',
      );
    }
    try {
      active(trace);
      if (response.status === 401) throw new AuthRequiredError();
      const result = await readContextPackResponse(
        response,
        signal,
        trace,
        deadline,
        { pack_id: packId, format: 'json' },
        session.scope,
      );
      active(trace);
      return result;
    } catch (error) {
      void response.body?.cancel().catch(() => undefined);
      active(trace);
      if (error instanceof AuthRequiredError || error instanceof WorkbenchApiError) throw error;
      const failure =
        error instanceof ContractError
          ? error
          : contextPackReadFailure('GATEWAY_RESPONSE_INVALID', trace);
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
  try {
    const from = await read(query.from_pack_id);
    const to = await read(query.to_pack_id);
    try {
      const comparison = compareSavedContextPacks(from, to);
      const result = { query, from, to, comparison };
      // Bound the complete local combination, not just each read or the summary separately.
      syncJsonSnapshot(result, 12 * 1024 * 1024);
      active(to.trace_id);
      return result;
    } catch (error) {
      active(to.trace_id);
      if (error instanceof AuthRequiredError || error instanceof WorkbenchApiError) throw error;
      throw new WorkbenchApiError(
        'The complete saved packs could not be compared.',
        to.trace_id,
        502,
        'GATEWAY_RESPONSE_INVALID',
      );
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
