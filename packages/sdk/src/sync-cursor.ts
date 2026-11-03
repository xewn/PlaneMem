import {
  ContractError,
  isSyncIdentifier,
  parseSyncCursorQuery,
  parseSyncAcknowledgement,
  parseSyncCursorEnvelope,
  parseSyncAcknowledgementEnvelope,
  assertSyncIdentityScope,
  SYNC_CURSOR_RESPONSE_BYTES,
  type SyncCommandIdentity,
  type RequestContext,
  type SyncCursorEnvelope,
  type SyncAcknowledgementEnvelope,
  type SyncAcknowledgement,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpSyncCursorOptions {
  expected_identity?: SyncCommandIdentity;
  timeout_ms?: number;
  signal?: AbortSignal;
}
export interface WcpSyncAckOptions extends WcpSyncCursorOptions {
  /** Saved with the locally persisted page/cursor; never replace it after an uncertain write. */
  expected_identity: SyncCommandIdentity;
}
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply the original identity and safe cursor for acknowledgement, with valid timeout/signal options and no key or version',
  DENIED: 'Use the matching verified unexpired sync reader account, client and project',
  UNAUTHENTICATED: 'Renew the original session and preserve the saved identity and cursor',
  NOT_FOUND: 'The project acknowledgement is unavailable in the current scope',
  CURSOR_GAP: 'The target cursor is ahead of the stream; preserve the saved target',
  CURSOR_REGRESSION:
    'The current acknowledgement is already ahead; explicitly read it using the saved identity',
  SYNC_CURSOR_INVALID: 'The complete acknowledgement state could not be represented',
  SYNC_STORAGE_UNAVAILABLE: 'Acknowledgement storage is unavailable; preserve the saved target',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The acknowledgement operation audit could not be persisted',
  RATE_LIMITED: 'Gateway capacity is occupied',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting; preserve the saved identity and target cursor',
  GATEWAY_REQUEST_TIMEOUT:
    'The local deadline expired; preserve the original target and explicitly read current acknowledgement state',
  GATEWAY_RESPONSE_INVALID:
    'The complete acknowledgement response did not match the request or exceeded its limit',
  GATEWAY_UNAVAILABLE:
    'The acknowledgement operation could not be confirmed; preserve the original target',
};
function validText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
function execute(
  transport: WcpTransport,
  context: RequestContext,
  cursor: number | undefined,
  options: WcpSyncCursorOptions,
  mode: 'read',
): Promise<SyncCursorEnvelope>;
function execute(
  transport: WcpTransport,
  context: RequestContext,
  cursor: number | undefined,
  options: WcpSyncCursorOptions,
  mode: 'ack',
): Promise<SyncAcknowledgementEnvelope>;
async function execute(
  transport: WcpTransport,
  original: RequestContext,
  cursor: number | undefined,
  options: WcpSyncCursorOptions,
  mode: 'read' | 'ack',
) {
  const context = { ...original };
  const trace = context.trace_id;
  let attempted = false;
  const fail = (code: string) =>
    new ContractError(code, messages[code]!, {
      trace_id: trace,
      retryable: false,
      ...(mode === 'ack'
        ? { details: { dispatch_state: attempted ? 'unknown' : 'not-sent' } }
        : {}),
    });
  let identity: SyncCommandIdentity | undefined;
  let command: SyncAcknowledgement | undefined;
  let timeout: number;
  let signal: AbortSignal | undefined;
  try {
    if (
      !validText(trace) ||
      !context.project_id ||
      [context.tenant_id, context.workspace_id, context.project_id].some(
        (id) => !isSyncIdentifier(id) || id === '.' || id === '..',
      ) ||
      (context.actor_id !== undefined && !validText(context.actor_id)) ||
      (context.client_id !== undefined && !validText(context.client_id)) ||
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
          !['expected_identity', 'timeout_ms', 'signal'].includes(key) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, 'value'),
      )
    )
      throw new TypeError();
    identity = parseSyncCursorQuery(
      Object.hasOwn(options, 'expected_identity')
        ? { expected_identity: options.expected_identity }
        : {},
    ).expected_identity;
    if (identity) {
      assertSyncIdentityScope(identity, { ...context, project_id: context.project_id });
      for (const field of ['actor_id', 'client_id'] as const)
        if (context[field] !== undefined && context[field] !== identity[field])
          throw new TypeError();
    }
    if (mode === 'ack') {
      if (
        context.idempotency_key !== undefined ||
        context.expected_version !== undefined ||
        context.if_match !== undefined
      )
        throw new TypeError();
      command = parseSyncAcknowledgement({ expected_identity: identity, cursor });
    }
    const supplied = Object.hasOwn(options, 'timeout_ms') ? options.timeout_ms : undefined;
    timeout = supplied === undefined ? 30_000 : supplied;
    signal = Object.hasOwn(options, 'signal') ? options.signal : undefined;
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
    const dispatched = command ? parseSyncAcknowledgement(command) : undefined;
    const actor = identity?.actor_id ?? context.actor_id;
    const client = identity?.client_id ?? context.client_id;
    const raw = await budget.wait(() => {
      attempted = true;
      return transport.request({
        method: mode === 'ack' ? 'POST' : 'GET',
        path: mode === 'ack' ? '/v1/sync/ack' : '/v1/sync/cursor',
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          ...(actor === undefined ? {} : { 'x-expected-actor-id': actor }),
          ...(client === undefined ? {} : { 'x-expected-client-id': client }),
        },
        ...(dispatched === undefined ? {} : { body: dispatched }),
        response_type: 'bounded-json',
        max_response_bytes: SYNC_CURSOR_RESPONSE_BYTES,
        signal: budget.signal,
      });
    });
    let result;
    try {
      if (command) result = parseSyncAcknowledgementEnvelope(raw, command, trace);
      else {
        result = parseSyncCursorEnvelope(raw, scope, trace, identity);
        if (
          Date.parse(result.data.expires_at) <= Date.now() ||
          (actor !== undefined && actor !== result.data.identity.actor_id) ||
          (client !== undefined && client !== result.data.identity.client_id)
        )
          throw new TypeError();
      }
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
    try {
      budget.close();
    } catch {
      /* Preserve the known result or sanitized failure. */
    }
  }
}
export function readSyncCursor(
  transport: WcpTransport,
  context: RequestContext,
  options: WcpSyncCursorOptions,
) {
  return execute(transport, context, undefined, options, 'read');
}
export function acknowledgeSync(
  transport: WcpTransport,
  context: RequestContext,
  cursor: number,
  options: WcpSyncAckOptions,
) {
  return execute(transport, context, cursor, options, 'ack');
}
