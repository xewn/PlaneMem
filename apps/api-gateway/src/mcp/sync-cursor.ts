import {
  ContractError,
  parseSyncCursorQuery,
  parseSyncAcknowledgement,
  parseSyncCursorEnvelope,
  parseSyncAcknowledgementEnvelope,
  assertSyncCommandIdentity,
  syncJsonSnapshot,
  validateErrorEnvelope,
  SYNC_CURSOR_RESPONSE_BYTES,
  type SyncAcknowledgement,
  type SyncCommandIdentity,
} from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';
import { canReadSyncStream, syncReaderIdentity } from '../sync-reader.js';

const preparations = new WeakMap<ApiGateway, { read: number; ack: number }>();
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply the saved expected_identity and safe cursor for acknowledgement; no key, version or extra arguments',
  DENIED: 'Use the matching verified unexpired sync reader account, client and project',
  UNAUTHENTICATED: 'Renew the original session and preserve its saved identity and target cursor',
  NOT_FOUND: 'The project acknowledgement is unavailable in the current scope',
  CURSOR_GAP: 'The target cursor is ahead of the stream; preserve the saved target',
  CURSOR_REGRESSION:
    'Current acknowledgement is ahead; explicitly query it with the saved identity',
  SYNC_CURSOR_INVALID: 'The complete acknowledgement state could not be represented',
  SYNC_STORAGE_UNAVAILABLE: 'Acknowledgement storage is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The acknowledgement operation audit could not be persisted',
  RATE_LIMITED: 'Gateway capacity is occupied',
  MCP_SYNC_CURSOR_BUSY: 'MCP acknowledgement operation preparation capacity is occupied',
  MCP_SYNC_CURSOR_TIMEOUT:
    'Stopped waiting; preserve the saved target and explicitly read current acknowledgement state',
  GATEWAY_RESPONSE_INVALID:
    'The complete acknowledgement response did not match the request or exceeded its limit',
};
function fail(code: string, trace: string, state?: 'not-sent' | 'unknown') {
  return new ContractError(code, messages[code]!, {
    trace_id: trace,
    retryable: false,
    ...(state === undefined ? {} : { details: { dispatch_state: state } }),
  });
}
export function isSyncCursorTool(name: unknown): name is 'get_sync_cursor' | 'acknowledge_sync' {
  return name === 'get_sync_cursor' || name === 'acknowledge_sync';
}
export function prepareSyncCursorTool(
  name: string,
  raw: unknown,
  original: RequestContext,
): HttpRequest {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const ack = name === 'acknowledge_sync';
  const state = ack ? 'not-sent' : undefined;
  if (!isSyncCursorTool(name)) throw fail('INVALID_INPUT', trace, state);
  if (!canReadSyncStream(context)) throw fail('DENIED', trace, state);
  let command: SyncAcknowledgement | undefined;
  let expected: SyncCommandIdentity | undefined;
  try {
    if (ack) {
      if (context.idempotency_key !== undefined || context.expected_version !== undefined)
        throw new TypeError();
      command = parseSyncAcknowledgement(raw);
      expected = command.expected_identity;
    } else {
      expected = parseSyncCursorQuery(raw).expected_identity;
      delete context.idempotency_key;
      delete context.expected_version;
    }
  } catch {
    throw fail('INVALID_INPUT', trace, state);
  }
  if (expected) {
    try {
      assertSyncCommandIdentity(expected, context);
    } catch {
      throw fail('DENIED', trace, state);
    }
  }
  return {
    method: ack ? 'POST' : 'GET',
    path: ack ? '/v1/sync/ack' : '/v1/sync/cursor',
    context,
    headers: {
      ...(ack ? { 'content-type': 'application/json' } : {}),
      ...(expected
        ? { 'x-expected-actor-id': expected.actor_id, 'x-expected-client-id': expected.client_id }
        : {}),
    },
    ...(command ? { body: { ...command } } : {}),
  };
}
/** Separate read and ack slots keep explicit recovery reads available while writes are still running. */
export async function executeSyncCursorTool(
  api: ApiGateway,
  name: string,
  raw: unknown,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const ack = name === 'acknowledge_sync';
  let attempted = false;
  const failure = (code: string) =>
    fail(code, trace, ack ? (attempted ? 'unknown' : 'not-sent') : undefined);
  if (!isSyncCursorTool(name)) throw failure('INVALID_INPUT');
  if (!canReadSyncStream(context)) throw failure('DENIED');
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (performance.now() >= deadline) throw failure('MCP_SYNC_CURSOR_TIMEOUT');
    if (!canReadSyncStream(context)) throw failure('DENIED');
  };
  let gate = preparations.get(api);
  if (!gate) {
    gate = { read: 0, ack: 0 };
    preparations.set(api, gate);
  }
  const kind = ack ? 'ack' : 'read';
  if (gate[kind] >= 2) throw failure('MCP_SYNC_CURSOR_BUSY');
  const lease = gate;
  lease[kind]++;
  const work = (async () => {
    try {
      active();
      const request = prepareSyncCursorTool(name, raw, context);
      const command = ack ? parseSyncAcknowledgement(request.body) : undefined;
      const expected = syncReaderIdentity(context);
      const dispatched = structuredClone(request);
      active();
      attempted = true;
      const response = await api.handle(dispatched);
      active();
      if (
        response.headers['x-trace-id'] !== trace ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
          response.headers['content-type'] ?? '',
        )
      )
        throw failure('GATEWAY_RESPONSE_INVALID');
      const value: unknown = JSON.parse(
        syncJsonSnapshot(
          response.body,
          response.status >= 400 ? 16 * 1024 : SYNC_CURSOR_RESPONSE_BYTES,
        ),
      );
      if (response.status >= 400) {
        const error = validateErrorEnvelope(value);
        if (error.trace_id !== trace) throw failure('GATEWAY_RESPONSE_INVALID');
        throw failure(
          Object.hasOwn(messages, error.code) ? error.code : 'GATEWAY_RESPONSE_INVALID',
        );
      }
      if (response.status !== 200) throw failure('GATEWAY_RESPONSE_INVALID');
      let result;
      if (command) result = parseSyncAcknowledgementEnvelope(value, command, trace);
      else {
        result = parseSyncCursorEnvelope(value, context, trace, expected);
        if (result.data.expires_at !== new Date(context.token_expires_at!).toISOString())
          throw failure('GATEWAY_RESPONSE_INVALID');
      }
      active();
      const text = syncJsonSnapshot(result, SYNC_CURSOR_RESPONSE_BYTES);
      const output = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(output, 2 * SYNC_CURSOR_RESPONSE_BYTES + 4096);
      active();
      return output;
    } catch (error) {
      let stopped = error;
      try {
        active();
      } catch (expired) {
        stopped = expired;
      }
      throw failure(
        stopped instanceof ContractError &&
          stopped.envelope.trace_id === trace &&
          Object.hasOwn(messages, stopped.envelope.code)
          ? stopped.envelope.code
          : 'GATEWAY_RESPONSE_INVALID',
      );
    } finally {
      lease[kind]--;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(failure('MCP_SYNC_CURSOR_TIMEOUT')),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
