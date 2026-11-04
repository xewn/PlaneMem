import {
  ContractError,
  CONTEXT_ITEM_READ_RESPONSE_BYTES,
  parseContextItemReadEnvelope,
  parseContextItemReadQuery,
  type ContextItemReadQuery,
  type ContextItemReadDocument,
  type ArchivedContextItemDocument,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import type { WcpEnvelope } from './continuity.js';
import { captureContextRead } from './context-read-input.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpContextItemReadOptions {
  /** Defaults to 30 seconds, including complete response validation. */
  timeout_ms?: number;
  signal?: AbortSignal;
}

const messages: Record<string, string> = {
  INVALID_INPUT: 'Supply a valid context item, project context and timeout/signal options',
  DENIED: 'The current account or client cannot read this context item',
  UNAUTHENTICATED: 'Renew the intended session before reading context item details',
  CONTEXT_ITEM_NOT_FOUND: 'The context item is unavailable in this project and selected view',
  CONTEXT_ITEM_INVALID: 'The saved context item could not be validated',
  CONTEXT_ITEM_STORAGE_UNAVAILABLE: 'Context item storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context item read audit could not be persisted',
  RATE_LIMITED: 'Context item reads are temporarily busy',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for context item details',
  GATEWAY_REQUEST_TIMEOUT: 'The complete context item read exceeded its local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete context item response did not match this read or exceeded its size limit',
  GATEWAY_UNAVAILABLE: 'Context item details could not be read',
};
function failure(code: string, trace: string) {
  return new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
}

/** Only detached, fully validated data escapes this read. No current/archived fallback. */
async function read(
  transport: WcpTransport,
  original: RequestContext,
  kind: ContextItemReadQuery['kind'],
  itemId: string,
  options: WcpContextItemReadOptions,
) {
  const trace = original.trace_id;
  let budget: RequestBudget | undefined;
  try {
    let prepared: {
      context: ReturnType<typeof captureContextRead>['context'];
      query: ContextItemReadQuery;
    };
    try {
      const settings = captureContextRead(original, options);
      prepared = {
        context: settings.context,
        query: parseContextItemReadQuery({ kind, item_id: itemId }),
      };
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
    const { context, query } = prepared;
    const signal = budget.signal;
    const raw = await budget.wait(() =>
      transport.request({
        method: 'GET',
        path:
          '/v1/context-items/' +
          encodeURIComponent(query.item_id) +
          (query.kind === 'archived' ? '/archived' : ''),
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': context.tenant_id,
          'x-workspace-id': context.workspace_id,
          'x-project-id': context.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: CONTEXT_ITEM_READ_RESPONSE_BYTES,
        signal,
      }),
    );
    budget.check();
    let result;
    try {
      // Also bounds and detaches JSON supplied by custom transports.
      result = parseContextItemReadEnvelope(raw, query, context, trace);
    } catch {
      budget.check();
      throw failure('GATEWAY_RESPONSE_INVALID', trace);
    }
    budget.check();
    return result;
  } catch (error) {
    let finalError = error;
    try {
      budget?.check();
    } catch (stopped) {
      finalError = stopped;
    }
    const envelope = finalError instanceof ContractError ? finalError.envelope : undefined;
    throw failure(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE',
      trace,
    );
  } finally {
    budget?.close();
  }
}

export async function readCurrentContextItem(
  transport: WcpTransport,
  context: RequestContext,
  itemId: string,
  options: WcpContextItemReadOptions,
): Promise<WcpEnvelope<ContextItemReadDocument>> {
  return (await read(
    transport,
    context,
    'current',
    itemId,
    options,
  )) as WcpEnvelope<ContextItemReadDocument>;
}

export async function readArchivedContextItem(
  transport: WcpTransport,
  context: RequestContext,
  itemId: string,
  options: WcpContextItemReadOptions,
): Promise<WcpEnvelope<ArchivedContextItemDocument>> {
  return (await read(
    transport,
    context,
    'archived',
    itemId,
    options,
  )) as WcpEnvelope<ArchivedContextItemDocument>;
}
