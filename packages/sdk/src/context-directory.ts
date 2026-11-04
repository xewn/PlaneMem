import {
  ContractError,
  CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES,
  parseContextItemDirectoryEnvelope,
  parseContextItemDirectoryQuery,
  type ContextItemDirectoryEnvelope,
  type ContextItemListQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { captureContextRead, contextReadFields } from './context-read-input.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpContextDirectoryReadOptions {
  /** Defaults to 30 seconds, including complete response validation. */
  timeout_ms?: number;
  signal?: AbortSignal;
}

export interface WcpContextDirectoryPagesOptions extends WcpContextDirectoryReadOptions {
  /** Defaults to 100, at most 1000. Further continuation raises CONTEXT_DIRECTORY_PAGE_LIMIT. */
  max_pages?: number;
}

const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply valid context filters, a current cursor, project context and read options; page iteration also requires account and client constraints',
  DENIED: 'The current account or client cannot read this context directory',
  UNAUTHENTICATED: 'Renew the intended session before reading the context directory',
  CONTEXT_ITEM_INVALID:
    'The complete context directory could not be validated; narrow the filters or reduce the page size from the first page',
  CONTEXT_ITEM_STORAGE_UNAVAILABLE: 'Context directory storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The context directory read audit could not be persisted',
  RATE_LIMITED: 'Context directory reads are temporarily busy',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the context directory',
  GATEWAY_REQUEST_TIMEOUT: 'The complete context directory read exceeded its local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete context directory response did not match this read or exceeded its size limit',
  GATEWAY_UNAVAILABLE: 'The context directory could not be read',
  CONTEXT_DIRECTORY_PAGE_LIMIT:
    'The requested directory page limit was reached; preserve the last complete page and its continuation',
};

function failure(code: string, trace: string) {
  return new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
}

/** Capture before dispatch and return only the complete detached directory envelope. */
export async function readContextDirectory(
  transport: WcpTransport,
  original: RequestContext,
  input: ContextItemListQuery,
  options: WcpContextDirectoryReadOptions,
): Promise<ContextItemDirectoryEnvelope> {
  const trace = original.trace_id;
  let budget: RequestBudget | undefined;
  try {
    let prepared;
    try {
      const settings = captureContextRead(original, options);
      const query = parseContextItemDirectoryQuery(input);
      prepared = { settings, query };
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
    const {
      settings: { context },
      query,
    } = prepared;
    const signal = budget.signal;
    const raw = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/workbench/query',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': context.tenant_id,
          'x-workspace-id': context.workspace_id,
          'x-project-id': context.project_id,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        body: { ...query, operation: 'context' },
        response_type: 'bounded-json',
        max_response_bytes: CONTEXT_ITEM_DIRECTORY_RESPONSE_BYTES,
        signal,
      }),
    );
    budget.check();
    let result;
    try {
      // Also bounds and detaches ordinary JSON supplied by a custom transport.
      result = parseContextItemDirectoryEnvelope(raw, query, context, trace);
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

/** Capture now; each next() alone starts one bounded read. No idle timer or prefetch. */
export function iterateContextDirectory(
  transport: WcpTransport,
  original: RequestContext,
  input: ContextItemListQuery,
  options: WcpContextDirectoryPagesOptions,
): AsyncGenerator<ContextItemDirectoryEnvelope, void, unknown> {
  const trace = original.trace_id;
  const prepared = (() => {
    try {
      const row = contextReadFields(options, ['timeout_ms', 'signal', 'max_pages']);
      const maximum = row.max_pages === undefined ? 100 : row.max_pages;
      if (
        typeof maximum !== 'number' ||
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        maximum > 1000
      )
        throw new TypeError();
      const settings = captureContextRead(original, {
        ...(row.timeout_ms === undefined ? {} : { timeout_ms: row.timeout_ms as number }),
        ...(row.signal === undefined ? {} : { signal: row.signal as AbortSignal }),
      });
      if (settings.context.actor_id === undefined || settings.context.client_id === undefined)
        throw new TypeError();
      return { settings, query: parseContextItemDirectoryQuery(input), maximum };
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
  })();
  const { settings, query, maximum } = prepared;
  return (async function* () {
    let cursor = query.cursor;
    for (let count = 0; ; count++) {
      if (settings.signal?.aborted) throw failure('GATEWAY_REQUEST_CANCELED', trace);
      if (count >= maximum) throw failure('CONTEXT_DIRECTORY_PAGE_LIMIT', trace);
      const page = await readContextDirectory(
        transport,
        settings.context,
        { ...query, ...(cursor === undefined ? {} : { cursor }) },
        {
          timeout_ms: settings.timeout,
          ...(settings.signal === undefined ? {} : { signal: settings.signal }),
        },
      );
      // The shared parser checks strict continuation order and binding. Save before yield
      // so mutations to the delivered page cannot change the next request.
      const next = page.next_cursor;
      yield page;
      if (next === undefined) return;
      cursor = next;
    }
  })();
}
