import {
  ContractError,
  parseSyncChangesQuery,
  parseSyncChangesRequest,
  assertSyncCommandIdentity,
  parseSyncChangesEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
  SYNC_CHANGES_RESPONSE_BYTES,
} from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';
import { canReadSyncStream } from '../sync-reader.js';

const preparations = new WeakMap<ApiGateway, { active: number }>();
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply a non-negative safe cursor, limit from 1 to 500 and optional saved expected_identity',
  DENIED: 'Use a verified unexpired sync reader for this project',
  UNAUTHENTICATED: 'Renew the intended session before reading from the saved cursor',
  NOT_FOUND: 'The sync stream is unavailable in the current scope',
  CURSOR_GAP: 'The requested cursor is ahead of this stream; preserve the saved cursor',
  SYNC_EVENT_INVALID: 'Stored sync event metadata is invalid',
  SYNC_CHANGES_INVALID: 'A complete sync page could not be represented within its limit',
  SYNC_STORAGE_UNAVAILABLE: 'The sync stream is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The sync read audit could not be persisted',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_SYNC_CHANGES_BUSY: 'MCP sync page preparation capacity is occupied',
  MCP_SYNC_CHANGES_TIMEOUT: 'Stopped waiting for this sync page; keep the saved cursor',
  GATEWAY_RESPONSE_INVALID:
    'The complete sync page did not match the requested stream or exceeded its limit',
};
const fail = (code: string, trace: string) =>
  new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
export function canReadSyncChanges(context: RequestContext): boolean {
  return canReadSyncStream(context);
}
export function prepareSyncChangesTool(raw: unknown, original: RequestContext): HttpRequest {
  const context = structuredClone(original);
  if (!canReadSyncChanges(context)) throw fail('DENIED', context.trace_id);
  delete context.idempotency_key;
  delete context.expected_version;
  let input;
  try {
    input = parseSyncChangesRequest(raw);
  } catch {
    throw fail('INVALID_INPUT', context.trace_id);
  }
  const { expected_identity, ...query } = input;
  if (expected_identity) {
    try {
      assertSyncCommandIdentity(expected_identity, context);
    } catch {
      throw fail('DENIED', context.trace_id);
    }
  }
  return {
    method: 'GET',
    path: '/v1/sync/changes',
    headers: expected_identity
      ? {
          'x-expected-actor-id': expected_identity.actor_id,
          'x-expected-client-id': expected_identity.client_id,
        }
      : {},
    // Internal ApiGateway takes parsed GET query parameters in body, never a wire GET body.
    body: query,
    context,
  };
}

/** One complete page only. Capacity includes late underlying reads, not HTTP sending. */
export async function executeSyncChangesTool(
  api: ApiGateway,
  raw: unknown,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  if (!canReadSyncChanges(context)) throw fail('DENIED', trace);
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_SYNC_CHANGES_TIMEOUT', trace);
    if (!canReadSyncChanges(context)) throw fail('DENIED', trace);
  };
  let gate = preparations.get(api);
  if (!gate) {
    gate = { active: 0 };
    preparations.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_SYNC_CHANGES_BUSY', trace);
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      active();
      const request = prepareSyncChangesTool(raw, context);
      const query = parseSyncChangesQuery(request.body);
      const dispatched = structuredClone(request);
      active();
      const response = await api.handle(dispatched);
      active();
      if (
        response.headers['x-trace-id'] !== trace ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
          response.headers['content-type'] ?? '',
        )
      )
        throw fail('GATEWAY_RESPONSE_INVALID', trace);
      const value: unknown = JSON.parse(
        syncJsonSnapshot(
          response.body,
          response.status >= 400 ? 16 * 1024 : SYNC_CHANGES_RESPONSE_BYTES,
        ),
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
      const envelope = parseSyncChangesEnvelope(value, query, context, trace);
      active();
      const text = syncJsonSnapshot(envelope, SYNC_CHANGES_RESPONSE_BYTES);
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * SYNC_CHANGES_RESPONSE_BYTES + 4096);
      active();
      return result;
    } catch (error) {
      let failure = error;
      try {
        active();
      } catch (stopped) {
        failure = stopped;
      }
      throw fail(
        failure instanceof ContractError &&
          failure.envelope.trace_id === trace &&
          Object.hasOwn(messages, failure.envelope.code)
          ? failure.envelope.code
          : 'GATEWAY_RESPONSE_INVALID',
        trace,
      );
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
          () => reject(fail('MCP_SYNC_CHANGES_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
