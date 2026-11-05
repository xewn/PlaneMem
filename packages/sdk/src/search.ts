import {
  ContractError,
  parseLegacySearchQuery,
  parseProjectSearchQuery,
  parseLegacySearchEnvelope,
  parseProjectSearchEnvelope,
  syncJsonSnapshot,
  SEARCH_INPUT_BYTES,
  SEARCH_RESPONSE_BYTES,
  type LegacySearchQuery,
  type ProjectSearchQuery,
  type RequestContext,
  type ProjectSearchEnvelope,
  type LegacySearchEnvelope,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { captureContextRead } from './context-read-input.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpSearchOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages = {
  INVALID_INPUT: 'Supply valid search parameters, project context and timeout/signal options',
  DENIED: 'The current account or client cannot read this search',
  UNAUTHENTICATED: 'Renew the intended session before searching',
  SEARCH_STORAGE_UNAVAILABLE: 'Search storage is unavailable',
  SEARCH_RESULT_INVALID: 'Stored search records are invalid',
  MEMORY_PROVIDER_OFF: 'The required memory provider is unavailable',
  MEMORY_UNAVAILABLE: 'The required memory recall failed',
  MEMORY_SCOPE_MISMATCH: 'Memory returned invalid or cross-scope records',
  MEMORY_RESULT_INVALID: 'Memory returned invalid sources',
  MOCK_SEARCH_SCENARIO_UNCONFIGURED:
    'Configure this query and the current searchable content first',
  MOCK_SEARCH_INTEGRITY_UNAVAILABLE: 'The simulated search cursor could not be calculated',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'Search audit could not be persisted',
  RATE_LIMITED: 'Search capacity is occupied',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for search results',
  GATEWAY_REQUEST_TIMEOUT: 'Search exceeded its local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete search response did not match this request or its size limit',
  GATEWAY_UNAVAILABLE: 'Search results could not be read',
} as const;
function failure(code: keyof typeof messages, trace: string) {
  return new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}
async function search<K extends 'project' | 'legacy'>(
  transport: WcpTransport,
  original: RequestContext,
  kind: K,
  input: K extends 'project' ? ProjectSearchQuery : LegacySearchQuery,
  options: WcpSearchOptions,
) {
  const trace = original.trace_id;
  let budget: RequestBudget | undefined;
  try {
    let prepared: {
      context: ReturnType<typeof captureContextRead>['context'];
      query: ReturnType<typeof parseProjectSearchQuery> | ReturnType<typeof parseLegacySearchQuery>;
    };
    try {
      const settings = captureContextRead(original, options);
      const supplied: unknown = JSON.parse(syncJsonSnapshot(input, SEARCH_INPUT_BYTES));
      const query =
        kind === 'project' ? parseProjectSearchQuery(supplied) : parseLegacySearchQuery(supplied);
      syncJsonSnapshot(query, SEARCH_INPUT_BYTES);
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
      prepared = { context: settings.context, query };
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
    const { context, query } = prepared;
    const raw = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: kind === 'project' ? '/v1/search' : '/v1/context/search',
        body: { ...query },
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': context.tenant_id,
          'x-workspace-id': context.workspace_id,
          'x-project-id': context.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: SEARCH_RESPONSE_BYTES,
        signal: budget!.signal,
      }),
    );
    budget.check();
    let result;
    try {
      result =
        kind === 'project'
          ? parseProjectSearchEnvelope(raw, query as ProjectSearchQuery, context, trace)
          : parseLegacySearchEnvelope(raw, query as LegacySearchQuery, context, trace);
    } catch {
      budget.check();
      throw failure('GATEWAY_RESPONSE_INVALID', trace);
    }
    budget.check();
    return result;
  } catch (error) {
    let final = error;
    try {
      budget?.check();
    } catch (stopped) {
      final = stopped;
    }
    const envelope = final instanceof ContractError ? final.envelope : undefined;
    throw failure(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? (envelope.code as keyof typeof messages)
        : 'GATEWAY_UNAVAILABLE',
      trace,
    );
  } finally {
    budget?.close();
  }
}
export async function searchProjectRecords(
  transport: WcpTransport,
  context: RequestContext,
  input: ProjectSearchQuery,
  options: WcpSearchOptions,
) {
  return (await search(transport, context, 'project', input, options)) as ProjectSearchEnvelope;
}
export async function searchLegacyContext(
  transport: WcpTransport,
  context: RequestContext,
  input: LegacySearchQuery,
  options: WcpSearchOptions,
) {
  return (await search(transport, context, 'legacy', input, options)) as LegacySearchEnvelope;
}
