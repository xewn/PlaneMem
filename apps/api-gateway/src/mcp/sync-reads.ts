import {
  ContractError,
  syncJsonSnapshot,
  parseSyncCommandContextEnvelope,
  parseSyncEventReceiptQuery,
  parseSyncEventReceiptEnvelope,
  assertSyncCommandIdentity,
  validateErrorEnvelope,
  SYNC_COMMAND_CONTEXT_BYTES,
  SYNC_EVENT_RECEIPT_REQUEST_BYTES,
  SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
} from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';
import { canReadSyncCommandContext, syncCommandContextData } from '../sync-command-context.js';

// Receipt queries and uploads both allow original identity metadata around a 1 MiB event batch.
export const MCP_SYNC_HTTP_BYTES = SYNC_EVENT_RECEIPT_REQUEST_BYTES + 64 * 1024;
const preparations = new WeakMap<ApiGateway, { active: number }>();
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply no identity-read arguments, or the saved original identity and complete event without a batch key',
  DENIED: 'Use the matching verified unexpired sync writer account, client and project',
  UNAUTHENTICATED: 'Renew the original session before reading its sync identity or receipt',
  NOT_FOUND: 'The original project or delivery is unavailable in the current readable scope',
  EVENT_ID_REUSED: 'The original event ID belongs to different content; keep the original event',
  SYNC_COMMAND_CONTEXT_INVALID: 'The verified sync identity could not be represented',
  SYNC_EVENT_RECEIPT_INVALID: 'Stored delivery could not confirm the original event',
  SYNC_STORAGE_UNAVAILABLE: 'Original sync receipt storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The read audit could not be persisted',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_SYNC_BUSY: 'MCP sync read preparation capacity is occupied; preserve the original request',
  MCP_SYNC_TIMEOUT: 'Stopped waiting for the sync read; the underlying read may still be running',
  GATEWAY_RESPONSE_INVALID:
    'The complete sync read did not match the original request or exceeded its limit',
};
const fail = (code: string, trace: string) =>
  new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
export function isSyncReadTool(
  name: unknown,
): name is 'get_sync_command_context' | 'get_sync_event_receipt' {
  return name === 'get_sync_command_context' || name === 'get_sync_event_receipt';
}

/** Creates a detached read request, retaining full original event fields and sender constraints. */
export function prepareSyncReadTool(
  name: string,
  raw: unknown,
  original: RequestContext,
): HttpRequest {
  const context = structuredClone(original);
  const trace = context.trace_id;
  if (!canReadSyncCommandContext(context)) throw fail('DENIED', trace);
  if (!isSyncReadTool(name)) throw fail('INVALID_INPUT', trace);
  delete context.idempotency_key;
  delete context.expected_version;
  if (name === 'get_sync_command_context') {
    try {
      const input: unknown = JSON.parse(syncJsonSnapshot(raw, SYNC_COMMAND_CONTEXT_BYTES));
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)
        throw new TypeError();
    } catch {
      throw fail('INVALID_INPUT', trace);
    }
    syncCommandContextData(context);
    return { method: 'GET', path: '/v1/sync/commands/context', headers: {}, context };
  }
  let query;
  try {
    query = parseSyncEventReceiptQuery(raw);
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
  try {
    assertSyncCommandIdentity(query.identity, context);
  } catch {
    throw fail('DENIED', trace);
  }
  return {
    method: 'POST',
    path: '/v1/sync/events/receipt',
    body: { ...query },
    context,
    headers: {
      'content-type': 'application/json',
      'x-expected-actor-id': query.identity.actor_id,
      'x-expected-client-id': query.identity.client_id,
    },
  };
}

/** Capacity covers preparation and underlying work, including after a local timeout; not HTTP sending. */
export async function executeSyncReadTool(
  api: ApiGateway,
  name: string,
  raw: unknown,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  if (!canReadSyncCommandContext(context)) throw fail('DENIED', trace);
  if (!isSyncReadTool(name)) throw fail('INVALID_INPUT', trace);
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_SYNC_TIMEOUT', trace);
    if (!canReadSyncCommandContext(context)) throw fail('DENIED', trace);
  };
  let gate = preparations.get(api);
  if (!gate) {
    gate = { active: 0 };
    preparations.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_SYNC_BUSY', trace);
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      active();
      const request = prepareSyncReadTool(name, raw, context);
      const query =
        name === 'get_sync_event_receipt' ? parseSyncEventReceiptQuery(request.body) : undefined;
      const expected = syncCommandContextData(context);
      const maximum = query ? SYNC_EVENT_RECEIPT_RESPONSE_BYTES : SYNC_COMMAND_CONTEXT_BYTES;
      active();
      const response = await api.handle(structuredClone(request));
      active();
      if (
        response.headers['x-trace-id'] !== trace ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
          response.headers['content-type'] ?? '',
        )
      )
        throw fail('GATEWAY_RESPONSE_INVALID', trace);
      // Snapshot before parsing: reject silent JSON coercion and never trust a mutable response object.
      const value: unknown = JSON.parse(
        syncJsonSnapshot(response.body, response.status >= 400 ? 16 * 1024 : maximum),
      );
      if (response.status >= 400) {
        const error = validateErrorEnvelope(value);
        if (error.trace_id !== trace) throw fail('GATEWAY_RESPONSE_INVALID', trace);
        throw fail(
          Object.hasOwn(messages, error.code) ? error.code : 'GATEWAY_RESPONSE_INVALID',
          trace,
        );
      }
      if (response.status !== 200) throw fail('GATEWAY_RESPONSE_INVALID', trace);
      let envelope;
      if (query) envelope = parseSyncEventReceiptEnvelope(value, query, trace);
      else {
        envelope = parseSyncCommandContextEnvelope(value, context, trace, expected.identity);
        if (envelope.data.expires_at !== expected.expires_at)
          throw fail('GATEWAY_RESPONSE_INVALID', trace);
      }
      active();
      const text = syncJsonSnapshot(envelope, maximum);
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * maximum + 4096);
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
      throw fail(code, trace);
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
          () => reject(fail('MCP_SYNC_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
