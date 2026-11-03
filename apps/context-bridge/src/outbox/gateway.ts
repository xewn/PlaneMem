import {
  ContractError,
  createUlid,
  isSyncIdentifier,
  validateIdempotencyKey,
  snapshotSyncUploadBatch,
  parseSyncUploadEnvelope,
  parseSyncCommandIdentity,
  assertSyncIdentityScope,
} from '@planemem/contracts';
import type { BatchPublisher } from './sqlite.js';
import { syncPublishBudget } from './gateway-budget.js';
import { discardSyncResponse, readSyncResponse } from './gateway-response.js';

export interface GatewayPublisherOptions {
  gatewayUrl: string;
  accessToken: () => string | Promise<string>;
  fetch?: typeof fetch;
  /** Local credential/network/body budget; at most 90 seconds, below the existing 120-second lease. */
  timeoutMs?: number;
  signal?: AbortSignal;
  traceId?: string;
}

/** Pass the returned publisher to SqliteOutbox.drainBatch for one project. */
export function createGatewayPublisher(options: GatewayPublisherOptions): BatchPublisher {
  const base = new URL(options.gatewayUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new TypeError('Use an HTTP(S) gateway URL without credentials, query or fragment');
  const endpoint = new URL('/v1/events:batch', base);
  const send = options.fetch ?? fetch;
  const accessToken = options.accessToken;
  const timeout = options.timeoutMs ?? 30_000;
  const signal = options.signal;
  const fixedTrace = options.traceId;
  if (
    typeof send !== 'function' ||
    typeof accessToken !== 'function' ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 90_000 ||
    (signal !== undefined &&
      (signal === null ||
        typeof signal !== 'object' ||
        typeof signal.aborted !== 'boolean' ||
        typeof signal.addEventListener !== 'function' ||
        typeof signal.removeEventListener !== 'function')) ||
    (fixedTrace !== undefined &&
      (typeof fixedTrace !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(fixedTrace)))
  )
    throw new TypeError('Use a valid sync token provider, trace, signal and timeout (1..90000 ms)');
  return async (scope, events, key, expectedIdentity) => {
    const trace = fixedTrace ?? 'trace_sync_' + createUlid();
    let original;
    let originalScope;
    let headers: Headers;
    let body: string;
    try {
      original = snapshotSyncUploadBatch(events);
      originalScope = {
        tenant_id: scope.tenant_id,
        workspace_id: scope.workspace_id,
        project_id: scope.project_id,
      };
      if (Object.values(originalScope).some((id) => !isSyncIdentifier(id))) throw new TypeError();
      const identity = parseSyncCommandIdentity(expectedIdentity);
      assertSyncIdentityScope(identity, originalScope);
      headers = new Headers({
        'content-type': 'application/json',
        accept: 'application/json',
        'idempotency-key': validateIdempotencyKey(key),
        'x-trace-id': trace,
        'x-tenant-id': originalScope.tenant_id,
        'x-workspace-id': originalScope.workspace_id,
        'x-project-id': originalScope.project_id,
        'x-expected-actor-id': identity.actor_id,
        'x-expected-client-id': identity.client_id,
      });
      body = JSON.stringify({ events: original });
    } catch {
      throw new ContractError(
        'SYNC_BATCH_INVALID',
        'Supply a complete valid original sync batch, key, scope and saved sender identity',
        {
          trace_id: trace,
          retryable: false,
          dispatch_state: 'not-sent',
        },
      );
    }
    const budget = syncPublishBudget(trace, timeout, signal);
    let response: Response | undefined;
    const invalid = () =>
      new ContractError(
        'SYNC_RECEIPT_INVALID',
        'The complete original sync receipt could not be confirmed; keep the original events',
        {
          trace_id: trace,
          retryable: true,
        },
      );
    try {
      const provided = await budget.wait(accessToken);
      if (typeof provided !== 'string' || !/^[\x21-\x7e]+$/.test(provided.trim()))
        throw new ContractError('UNAUTHENTICATED', 'A valid bearer token is required for sync', {
          trace_id: trace,
          retryable: false,
        });
      headers.set('authorization', 'Bearer ' + provided.trim());
      response = await budget.wait(
        () =>
          send(endpoint, {
            method: 'POST',
            redirect: 'error',
            cache: 'no-store',
            signal: budget.signal,
            headers,
            body,
          }),
        discardSyncResponse,
      );
      budget.check();
      // Error bodies are canceled without reading or echoing their content.
      if (response.status >= 400 && response.status <= 599)
        throw new ContractError(
          'SYNC_HTTP_' + response.status,
          'Gateway returned an error for the original sync batch; keep the original events',
          {
            trace_id: trace,
            retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          },
        );
      if (
        response.status !== 200 ||
        response.headers.get('x-trace-id') !== trace ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
          response.headers.get('content-type') ?? '',
        )
      )
        throw invalid();
      let result;
      try {
        result = parseSyncUploadEnvelope(
          await readSyncResponse(response, budget),
          original,
          originalScope,
          trace,
        );
      } catch {
        budget.check();
        throw invalid();
      }
      budget.check();
      return {
        accepted: result.data.accepted,
        rejected: result.data.rejected,
        next_cursor: result.data.next_cursor,
      };
    } catch (error) {
      budget.check();
      if (
        error instanceof ContractError &&
        error.envelope.trace_id === trace &&
        [
          'SYNC_RECEIPT_INVALID',
          'SYNC_PUBLISH_TIMEOUT',
          'SYNC_PUBLISH_CANCELED',
          'UNAUTHENTICATED',
        ].includes(error.envelope.code)
      )
        throw error;
      if (
        error instanceof ContractError &&
        error.envelope.trace_id === trace &&
        /^SYNC_HTTP_[45][0-9]{2}$/.test(error.envelope.code)
      )
        throw error;
      throw new ContractError(
        'SYNC_PUBLISH_UNAVAILABLE',
        'The original sync batch outcome is unknown; keep the original events',
        { trace_id: trace, retryable: true },
      );
    } finally {
      if (response) discardSyncResponse(response);
      budget.close();
    }
  };
}
