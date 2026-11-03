import {
  ContractError,
  snapshotSyncUploadBatch,
  parseSyncUploadEnvelope,
  validateIdempotencyKey,
  SYNC_UPLOAD_RESPONSE_BYTES,
  parseSyncCommandIdentity,
  assertSyncIdentityScope,
  type SyncCommandIdentity,
  type RequestContext,
  type SyncUploadEvent,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import type { WcpWriteOptions } from './continuity.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpSyncUploadOptions extends WcpWriteOptions {
  /** Preserve the original sender across credential refreshes; never infer it for old batches. */
  expected_identity?: SyncCommandIdentity;
  /** Local waiting only; retain the original events and key when the outcome is unknown. */
  timeout_ms?: number;
  signal?: AbortSignal;
}

const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply 1..100 distinct finite JSON events within 1 MiB, a project, the original batch key and valid identity/timeout/signal options',
  DENIED: 'The current session cannot upload this batch; keep the original events and key',
  UNAUTHENTICATED: 'Renew the original session before continuing with the original batch and key',
  NOT_FOUND: 'The original project is unavailable; keep the original batch and key',
  IDEMPOTENCY_KEY_REUSED:
    'The batch key belongs to different parameters; recover the original events and key',
  SYNC_EVENT_INVALID: 'The original batch could not be recorded as valid sync events',
  SYNC_STORAGE_UNAVAILABLE: 'Sync storage is unavailable; keep the original batch and key',
  WORKBENCH_AUTH_UNAVAILABLE:
    'Gateway authentication is unavailable; keep the original batch and key',
  AUDIT_PERSISTENCE_UNAVAILABLE:
    'The request audit could not be persisted; keep the original batch and key',
  RATE_LIMITED: 'Gateway capacity is occupied; keep the original batch and key',
  GATEWAY_REQUEST_CANCELED:
    'Stopped waiting; this batch may still complete, so keep the original events and key',
  GATEWAY_REQUEST_TIMEOUT:
    'The local deadline expired; this batch may still complete, so keep the original events and key',
  GATEWAY_RESPONSE_INVALID:
    'The complete original batch receipt could not be validated; keep the original events and key',
  GATEWAY_UNAVAILABLE: 'The batch outcome is unknown; keep the original events and key',
};

/** Explicit original-batch upload; does not allocate keys, persist drafts or retry writes. */
export async function uploadSyncEvents(
  transport: WcpTransport,
  originalContext: RequestContext,
  events: SyncUploadEvent[],
  options: WcpSyncUploadOptions,
) {
  const context = { ...originalContext };
  const trace = context.trace_id;
  let attempted = false;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, {
      trace_id: trace,
      retryable: false,
      dispatch_state: attempted ? 'unknown' : 'not-sent',
    });
  let original;
  let key: string;
  let timeout: number;
  let signal: AbortSignal | undefined;
  let expectedIdentity: SyncCommandIdentity | undefined;
  try {
    if (
      !context.project_id ||
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      !Object.hasOwn(options, 'idempotency_key')
    )
      throw new TypeError();
    const fields = Object.keys(options);
    if (
      Reflect.ownKeys(options).length !== fields.length ||
      fields.some(
        (field) =>
          !['idempotency_key', 'timeout_ms', 'signal', 'expected_identity'].includes(field) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(options, field)!, 'value'),
      )
    )
      throw new TypeError();
    const prototype: unknown = Object.getPrototypeOf(options);
    if (prototype !== null && prototype !== Object.prototype) throw new TypeError();
    key = validateIdempotencyKey(options.idempotency_key);
    const suppliedTimeout = Object.hasOwn(options, 'timeout_ms') ? options.timeout_ms : undefined;
    timeout = suppliedTimeout === undefined ? 30_000 : suppliedTimeout;
    signal = Object.hasOwn(options, 'signal') ? options.signal : undefined;
    if (Object.hasOwn(options, 'expected_identity') && options.expected_identity !== undefined) {
      expectedIdentity = parseSyncCommandIdentity(options.expected_identity);
      assertSyncIdentityScope(expectedIdentity, { ...context, project_id: context.project_id });
      if (
        (context.actor_id !== undefined && context.actor_id !== expectedIdentity.actor_id) ||
        (context.client_id !== undefined && context.client_id !== expectedIdentity.client_id)
      )
        throw new TypeError();
    }
    original = snapshotSyncUploadBatch(events);
  } catch {
    throw fail('INVALID_INPUT');
  }
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id!,
  };
  let budget;
  try {
    budget = createRequestBudget(trace, timeout, signal);
  } catch {
    throw fail('INVALID_INPUT');
  }
  try {
    budget.check();
    // The transport may retain or mutate its input; never expose the receipt's original snapshot.
    const body = { events: snapshotSyncUploadBatch(original) };
    const raw = await budget.wait(() => {
      attempted = true;
      return transport.request({
        method: 'POST',
        path: '/v1/events:batch',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          'idempotency-key': key,
          ...(expectedIdentity === undefined
            ? {}
            : {
                'x-expected-actor-id': expectedIdentity.actor_id,
                'x-expected-client-id': expectedIdentity.client_id,
              }),
        },
        body,
        response_type: 'bounded-json',
        max_response_bytes: SYNC_UPLOAD_RESPONSE_BYTES,
        signal: budget.signal,
      });
    });
    let result;
    try {
      result = parseSyncUploadEnvelope(raw, original, scope, trace);
    } catch {
      budget.check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    budget.check();
    return result;
  } catch (error) {
    // Prefer a deadline/cancellation reached while parsing or handling a transport failure.
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
