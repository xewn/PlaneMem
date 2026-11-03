import {
  ContractError,
  MAX_SYNC_BATCH_BYTES,
  SYNC_COMMAND_CONTEXT_BYTES,
  SYNC_UPLOAD_RESPONSE_BYTES,
  assertSyncCommandIdentity,
  parseSyncCommandIdentity,
  parseSyncUploadEnvelope,
  snapshotSyncUploadBatch,
  syncJsonSnapshot,
  validateErrorEnvelope,
  validateIdempotencyKey,
  type SyncCommandIdentity,
  type SyncUploadEvent,
} from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';
import { canReadSyncCommandContext } from '../sync-command-context.js';

const preparations = new WeakMap<ApiGateway, { active: number }>();
type DispatchState = 'not-sent' | 'unknown';
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply the saved original identity, complete event batch and explicit stable key without version conditions',
  DENIED: 'Use the matching verified unexpired sync writer account, client and project',
  UNAUTHENTICATED: 'Renew the original session and preserve the original batch',
  NOT_FOUND: 'The original project or source is unavailable in the current scope',
  EVENT_ID_REUSED: 'An original event ID belongs to different content; preserve the original batch',
  IDEMPOTENCY_KEY_REUSED:
    'The original key belongs to different content; preserve the original batch',
  SYNC_EVENT_RECEIPT_INVALID: 'Stored delivery could not confirm the original event',
  SYNC_STORAGE_UNAVAILABLE: 'Sync storage is unavailable; preserve the original batch',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE:
    'The upload audit could not be persisted; preserve the original batch',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_SYNC_UPLOAD_BUSY:
    'MCP sync upload preparation capacity is occupied; preserve the original batch',
  MCP_SYNC_UPLOAD_TIMEOUT:
    'Stopped waiting for upload; preserve the original batch and check its event receipts',
  GATEWAY_RESPONSE_INVALID:
    'The complete upload response could not confirm the original batch; preserve it and check event receipts',
};
const fail = (code: string, trace: string, dispatch_state: DispatchState = 'not-sent') =>
  new ContractError(code, messages[code]!, {
    trace_id: trace,
    retryable: false,
    details: { dispatch_state },
  });

/** Requires the caller's saved identity and key; never fills them from a current session. */
export function prepareSyncUploadTool(raw: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  const trace = context.trace_id;
  if (!canReadSyncCommandContext(context)) throw fail('DENIED', trace);
  let identity: SyncCommandIdentity;
  let events: SyncUploadEvent[];
  let key: string;
  try {
    const input: unknown = JSON.parse(
      syncJsonSnapshot(raw, MAX_SYNC_BATCH_BYTES + SYNC_COMMAND_CONTEXT_BYTES),
    );
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
    const fields = Object.keys(input);
    if (
      fields.length !== 3 ||
      fields.some((field) => !['expected_identity', 'events', 'idempotency_key'].includes(field))
    )
      throw new TypeError();
    const row = input as Record<string, unknown>;
    identity = parseSyncCommandIdentity(row.expected_identity);
    events = snapshotSyncUploadBatch(row.events);
    key = validateIdempotencyKey(row.idempotency_key);
    if (
      (context.idempotency_key !== undefined && context.idempotency_key !== key) ||
      context.expected_version !== undefined
    )
      throw new TypeError();
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
  try {
    assertSyncCommandIdentity(identity, context);
    for (const event of events) {
      const row = event as unknown as Record<string, unknown>;
      for (const field of [
        'tenant_id',
        'workspace_id',
        'project_id',
        'actor_id',
        'client_id',
      ] as const)
        if (Object.hasOwn(row, field) && row[field] !== identity[field]) throw new TypeError();
    }
  } catch {
    throw fail('DENIED', trace);
  }
  context.idempotency_key = key;
  return {
    method: 'POST',
    path: '/v1/events:batch',
    body: { events },
    context,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
      'x-expected-actor-id': identity.actor_id,
      'x-expected-client-id': identity.client_id,
    },
  };
}

/** A timed-out write retains capacity until it actually settles; timeout never proves rollback. */
export async function executeSyncUploadTool(
  api: ApiGateway,
  raw: unknown,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  let dispatchState: DispatchState = 'not-sent';
  if (!canReadSyncCommandContext(context)) throw fail('DENIED', trace);
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_SYNC_UPLOAD_TIMEOUT', trace, dispatchState);
    if (!canReadSyncCommandContext(context)) throw fail('DENIED', trace, dispatchState);
  };
  let gate = preparations.get(api);
  if (!gate) {
    gate = { active: 0 };
    preparations.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_SYNC_UPLOAD_BUSY', trace);
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      active();
      const request = prepareSyncUploadTool(raw, context);
      const batch = snapshotSyncUploadBatch(request.body?.events);
      const dispatched = structuredClone(request);
      active();
      dispatchState = 'unknown';
      const response = await api.handle(dispatched);
      active();
      if (
        response.headers['x-trace-id'] !== trace ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
          response.headers['content-type'] ?? '',
        )
      )
        throw fail('GATEWAY_RESPONSE_INVALID', trace, dispatchState);
      const value: unknown = JSON.parse(
        syncJsonSnapshot(
          response.body,
          response.status >= 400 ? 16 * 1024 : SYNC_UPLOAD_RESPONSE_BYTES,
        ),
      );
      if (response.status >= 400) {
        const error = validateErrorEnvelope(value);
        if (error.trace_id !== trace) throw fail('GATEWAY_RESPONSE_INVALID', trace, dispatchState);
        throw fail(
          Object.hasOwn(messages, error.code) ? error.code : 'GATEWAY_RESPONSE_INVALID',
          trace,
          dispatchState,
        );
      }
      if (response.status !== 200) throw fail('GATEWAY_RESPONSE_INVALID', trace, dispatchState);
      const envelope = parseSyncUploadEnvelope(value, batch, context, trace);
      active();
      const text = syncJsonSnapshot(envelope, SYNC_UPLOAD_RESPONSE_BYTES);
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * SYNC_UPLOAD_RESPONSE_BYTES + 4096);
      active();
      return result;
    } catch (error) {
      let failure = error;
      try {
        active();
      } catch (stopped) {
        failure = stopped;
      }
      const code =
        failure instanceof ContractError &&
        failure.envelope.trace_id === trace &&
        Object.hasOwn(messages, failure.envelope.code)
          ? failure.envelope.code
          : 'GATEWAY_RESPONSE_INVALID';
      // The adapter owns dispatch state; never trust upstream details about write completion.
      throw fail(code, trace, dispatchState);
    } finally {
      lease.active--;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(fail('MCP_SYNC_UPLOAD_TIMEOUT', trace, dispatchState)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
