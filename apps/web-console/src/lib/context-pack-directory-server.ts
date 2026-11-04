import { randomUUID } from 'node:crypto';
import {
  CONTEXT_PACK_DIRECTORY_RESPONSE_BYTES,
  parseContextPackDirectoryQuery,
  parseContextPackDirectoryEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
} from '@planemem/contracts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  getWorkbenchArtifactTransferSession,
} from './server-api';
import { runtimeConfig } from './config';
import { readWorkbenchJsonResponse } from './workbench-response';

const messages: Record<string, string> = {
  INVALID_INPUT: 'Restart the saved pack list with the intended filter and page size.',
  DENIED: 'Your current account cannot list saved packs in this project.',
  CONTEXT_PACK_NOT_FOUND: 'The saved pack project is unavailable.',
  CONTEXT_PACK_INVALID: 'The complete saved pack metadata page could not be validated.',
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Saved pack metadata is temporarily unavailable.',
  CONTEXT_PACK_DIRECTORY_TIMEOUT: 'The saved pack list exceeded its read deadline.',
  RATE_LIMITED: 'Saved pack reads are busy. Retry when ready.',
  WORKBENCH_AUTH_UNAVAILABLE: 'Authentication is temporarily unavailable.',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The saved pack directory audit could not be persisted.',
};

export async function getWorkbenchContextPackDirectory(input: unknown) {
  const query = parseContextPackDirectoryQuery(input);
  const session = await getWorkbenchArtifactTransferSession();
  const trace = 'trace_web_pack_list_' + randomUUID();
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
      'Saved pack browsing is unavailable.',
      trace,
      503,
      'GATEWAY_UNAVAILABLE',
    );
  }
  const deadline = performance.now() + 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const active = () => {
    if (session.expires_at * 1000 <= Date.now()) throw new AuthRequiredError();
    if (controller.signal.aborted || performance.now() >= deadline)
      throw new WorkbenchApiError(
        'The saved pack list exceeded its read deadline.',
        trace,
        502,
        'GATEWAY_REQUEST_TIMEOUT',
      );
  };
  let response: Response | undefined;
  try {
    active();
    const params = new URLSearchParams({ limit: String(query.limit) });
    if (query.pack_id !== undefined) params.set('pack_id', query.pack_id);
    if (query.cursor !== undefined) params.set('cursor', query.cursor);
    try {
      response = await fetch(
        base.href.replace(/\/$/, '') + '/v1/context-packs?' + params.toString(),
        {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
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
      active();
      throw new WorkbenchApiError(
        'Saved pack metadata could not be reached.',
        trace,
        502,
        'GATEWAY_UNAVAILABLE',
      );
    }
    active();
    if (response.status === 401) throw new AuthRequiredError();
    if (
      (response.status !== 200 && (response.status < 400 || response.status > 599)) ||
      response.headers.get('x-trace-id') !== trace ||
      response.headers.has('etag')
    )
      throw new TypeError();
    const raw = await readWorkbenchJsonResponse(
      response,
      controller.signal,
      CONTEXT_PACK_DIRECTORY_RESPONSE_BYTES,
      16 * 1024,
    );
    active();
    if (!response.ok) {
      const error = validateErrorEnvelope(JSON.parse(syncJsonSnapshot(raw, 16 * 1024)));
      const statuses: Record<string, number> = {
        INVALID_INPUT: 400,
        DENIED: 403,
        CONTEXT_PACK_NOT_FOUND: 404,
        CONTEXT_PACK_INVALID: 500,
        RATE_LIMITED: 429,
        CONTEXT_PACK_DIRECTORY_TIMEOUT: 503,
        CONTEXT_PACK_STORAGE_UNAVAILABLE: 503,
        WORKBENCH_AUTH_UNAVAILABLE: 503,
        AUDIT_PERSISTENCE_UNAVAILABLE: 503,
      };
      if (
        error.trace_id !== trace ||
        !Object.hasOwn(messages, error.code) ||
        response.status !== statuses[error.code]
      )
        throw new TypeError();
      throw new WorkbenchApiError(messages[error.code]!, trace, response.status, error.code);
    }
    const result = parseContextPackDirectoryEnvelope(raw, query, session.scope, trace);
    active();
    return result;
  } catch (error) {
    void response?.body?.cancel().catch(() => undefined);
    active();
    if (error instanceof WorkbenchApiError || error instanceof AuthRequiredError) throw error;
    throw new WorkbenchApiError(
      'The complete saved pack metadata page was invalid or exceeded its limit.',
      trace,
      502,
      'GATEWAY_RESPONSE_INVALID',
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
