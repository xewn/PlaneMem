import {
  ContractError,
  isSyncIdentifier,
  parseSyncChangesQuery,
  parseSyncChangesEnvelope,
  SYNC_CHANGES_RESPONSE_BYTES,
  parseSyncCursorQuery,
  assertSyncIdentityScope,
  type SyncCommandIdentity,
  type RequestContext,
  type SyncChangesQuery,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

export interface WcpSyncChangesOptions {
  /** Save with the consumer checkpoint to prevent credential refresh from switching its owner. */
  expected_identity?: SyncCommandIdentity;
  /** Per-page local wait; time spent by a syncPages consumer between pages is excluded. */
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply a scoped sync cursor, limit from 1 to 500 and valid original identity/timeout/signal options',
  DENIED: 'The current session cannot read this sync stream',
  UNAUTHENTICATED: 'Renew the intended session before continuing from the saved cursor',
  NOT_FOUND: 'The project stream is unavailable in the current readable scope',
  CURSOR_GAP: 'The requested cursor is ahead of this stream; preserve the saved cursor',
  SYNC_EVENT_INVALID: 'Stored sync event metadata is invalid',
  SYNC_CHANGES_INVALID: 'A complete sync page could not be represented within its limit',
  SYNC_STORAGE_UNAVAILABLE: 'The sync stream is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The sync read audit could not be persisted',
  RATE_LIMITED: 'Sync read capacity is occupied',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for changes; keep the saved cursor',
  GATEWAY_REQUEST_TIMEOUT: 'The sync page exceeded the local deadline; keep the saved cursor',
  GATEWAY_RESPONSE_INVALID:
    'The complete sync page did not match the requested stream or exceeded its limit',
  GATEWAY_UNAVAILABLE: 'The sync page could not be read; keep the saved cursor',
};
const fail = (code: string, trace: string) =>
  new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });

function prepare(
  original: RequestContext,
  input: SyncChangesQuery,
  options: WcpSyncChangesOptions,
) {
  const context = { ...original };
  const trace = context.trace_id;
  try {
    if (
      typeof trace !== 'string' ||
      !trace.trim() ||
      trace.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace)
    )
      throw new TypeError();
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (!isSyncIdentifier(context[field]) || context[field] === '.' || context[field] === '..')
        throw new TypeError();
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError();
    const fields = Object.keys(options);
    const prototype: unknown = Object.getPrototypeOf(options);
    if (
      (prototype !== null && prototype !== Object.prototype) ||
      Reflect.ownKeys(options).length !== fields.length ||
      fields.some(
        (field) =>
          !['expected_identity', 'timeout_ms', 'signal'].includes(field) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(options, field)!, 'value'),
      )
    )
      throw new TypeError();
    const expected = parseSyncCursorQuery(
      Object.hasOwn(options, 'expected_identity')
        ? { expected_identity: options.expected_identity }
        : {},
    ).expected_identity;
    if (expected) {
      assertSyncIdentityScope(expected, { ...context, project_id: context.project_id! });
      for (const field of ['actor_id', 'client_id'] as const) {
        if (context[field] !== undefined && context[field] !== expected[field])
          throw new TypeError();
      }
    }
    const suppliedTimeout = Object.hasOwn(options, 'timeout_ms') ? options.timeout_ms : undefined;
    const timeout = suppliedTimeout === undefined ? 30_000 : suppliedTimeout;
    const signal = Object.hasOwn(options, 'signal') ? options.signal : undefined;
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 2_147_483_647 ||
      (signal !== undefined &&
        (!signal ||
          typeof signal !== 'object' ||
          typeof signal.aborted !== 'boolean' ||
          typeof signal.addEventListener !== 'function' ||
          typeof signal.removeEventListener !== 'function'))
    )
      throw new TypeError();
    return {
      context,
      query: parseSyncChangesQuery(input),
      options: {
        timeout_ms: timeout,
        ...(signal === undefined ? {} : { signal }),
        ...(expected ? { expected_identity: expected } : {}),
      },
    };
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
}

export async function readSyncChanges(
  transport: WcpTransport,
  original: RequestContext,
  input: SyncChangesQuery,
  options: WcpSyncChangesOptions,
) {
  const prepared = prepare(original, input, options);
  const { context, query } = prepared;
  const trace = context.trace_id;
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id!,
  };
  const parameters = new URLSearchParams();
  if (query.cursor !== undefined) parameters.set('cursor', String(query.cursor));
  if (query.limit !== undefined) parameters.set('limit', String(query.limit));
  const path = '/v1/sync/changes' + (parameters.size ? '?' + parameters : '');
  let budget;
  try {
    budget = createRequestBudget(trace, prepared.options.timeout_ms, prepared.options.signal);
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
  try {
    const raw = await budget.wait(() =>
      transport.request({
        method: 'GET',
        path,
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          ...(prepared.options.expected_identity
            ? {
                'x-expected-actor-id': prepared.options.expected_identity.actor_id,
                'x-expected-client-id': prepared.options.expected_identity.client_id,
              }
            : {
                ...(context.actor_id === undefined
                  ? {}
                  : { 'x-expected-actor-id': context.actor_id }),
                ...(context.client_id === undefined
                  ? {}
                  : { 'x-expected-client-id': context.client_id }),
              }),
        },
        response_type: 'bounded-json',
        max_response_bytes: SYNC_CHANGES_RESPONSE_BYTES,
        signal: budget.signal,
      }),
    );
    let result;
    try {
      result = parseSyncChangesEnvelope(raw, query, scope, trace);
    } catch {
      budget.check();
      throw fail('GATEWAY_RESPONSE_INVALID', trace);
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
      trace,
    );
  } finally {
    try {
      budget.close();
    } catch {
      /* Cleanup cannot replace a validated page or sanitized failure. */
    }
  }
}

/** Freeze options before the first next(); capture continuation before exposing each mutable page. */
export function iterateSyncChanges(
  transport: WcpTransport,
  original: RequestContext,
  input: SyncChangesQuery,
  options: WcpSyncChangesOptions,
) {
  const prepared = prepare(original, input, options);
  return (async function* () {
    let cursor = prepared.query.cursor;
    while (true) {
      const page = await readSyncChanges(
        transport,
        prepared.context,
        {
          ...(cursor === undefined ? {} : { cursor }),
          ...(prepared.query.limit === undefined ? {} : { limit: prepared.query.limit }),
        },
        prepared.options,
      );
      const next = page.data.next_cursor;
      const more = page.data.has_more;
      yield page;
      if (!more) return;
      cursor = next;
    }
  })();
}
