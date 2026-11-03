import {
  ContractError,
  parseSyncEventReceiptQuery,
  parseSyncEventReceiptEnvelope,
  assertSyncIdentityScope,
  SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
  type SyncEventReceiptQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpSyncEventReceiptOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply the complete original identity/event and valid timeout/signal options; no batch key',
  DENIED: 'Use the original verified account, client and project with sync write access',
  UNAUTHENTICATED: 'Renew the original session before checking its event receipt',
  NOT_FOUND: 'The original project or delivery is unavailable in the current readable scope',
  EVENT_ID_REUSED: 'The original event ID belongs to different content; keep the saved event',
  SYNC_EVENT_RECEIPT_INVALID: 'Stored delivery could not confirm the complete original event',
  SYNC_STORAGE_UNAVAILABLE: 'Receipt storage is unavailable; preserve the original event',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'Receipt lookup audit could not be persisted',
  RATE_LIMITED: 'Receipt reads are temporarily busy',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the receipt; keep the original event',
  GATEWAY_REQUEST_TIMEOUT: 'The receipt exceeded the local deadline; keep the original event',
  GATEWAY_RESPONSE_INVALID:
    'The complete receipt did not match the original event or exceeded its limit',
  GATEWAY_UNAVAILABLE: 'The original event outcome could not be confirmed',
};
export async function readSyncEventReceipt(
  transport: WcpTransport,
  original: RequestContext,
  input: SyncEventReceiptQuery,
  options: WcpSyncEventReceiptOptions,
) {
  const context = { ...original };
  const trace = context.trace_id;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
  let query;
  let timeout: number;
  let signal: AbortSignal | undefined;
  try {
    if (
      typeof trace !== 'string' ||
      !trace.trim() ||
      trace.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace) ||
      !context.project_id ||
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options)
    )
      throw new TypeError();
    const fields = Object.keys(options);
    const prototype: unknown = Object.getPrototypeOf(options);
    if (
      (prototype !== null && prototype !== Object.prototype) ||
      Reflect.ownKeys(options).length !== fields.length ||
      fields.some(
        (key) =>
          !['timeout_ms', 'signal'].includes(key) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, 'value'),
      )
    )
      throw new TypeError();
    const suppliedTimeout = Object.hasOwn(options, 'timeout_ms') ? options.timeout_ms : undefined;
    timeout = suppliedTimeout === undefined ? 30_000 : suppliedTimeout;
    signal = Object.hasOwn(options, 'signal') ? options.signal : undefined;
    query = parseSyncEventReceiptQuery(input);
    assertSyncIdentityScope(query.identity, { ...context, project_id: context.project_id });
    for (const key of ['actor_id', 'client_id'] as const)
      if (context[key] !== undefined && query.identity[key] !== context[key]) throw new TypeError();
  } catch {
    throw fail('INVALID_INPUT');
  }
  let budget;
  try {
    budget = createRequestBudget(trace, timeout, signal);
  } catch {
    throw fail('INVALID_INPUT');
  }
  try {
    const body = parseSyncEventReceiptQuery(query);
    const raw = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/sync/events/receipt',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': query.identity.tenant_id,
          'x-workspace-id': query.identity.workspace_id,
          'x-project-id': query.identity.project_id,
          'x-expected-actor-id': query.identity.actor_id,
          'x-expected-client-id': query.identity.client_id,
        },
        body,
        response_type: 'bounded-json',
        max_response_bytes: SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseSyncEventReceiptEnvelope(raw, query, trace);
    } catch {
      budget.check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    budget.check();
    return result;
  } catch (error) {
    let failure = error;
    try {
      budget.check();
    } catch (stopped) {
      failure = stopped;
    }
    throw fail(
      failure instanceof ContractError &&
        failure.envelope.trace_id === trace &&
        Object.hasOwn(messages, failure.envelope.code)
        ? failure.envelope.code
        : 'GATEWAY_UNAVAILABLE',
    );
  } finally {
    budget.close();
  }
}
