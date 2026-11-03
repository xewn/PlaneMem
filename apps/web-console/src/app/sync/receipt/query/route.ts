import { randomUUID } from 'node:crypto';
import {
  parseSyncEventReceiptEnvelope,
  validateErrorEnvelope,
  SYNC_EVENT_RECEIPT_REQUEST_BYTES,
  SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
} from '@planemem/contracts';
import {
  AuthRequiredError,
  getWorkbenchArtifactTransferSession as getReceiptSession,
} from '../../../../lib/server-api';
import { runtimeConfig } from '../../../../lib/config';
import { readArtifactTransferBytes } from '../../../../lib/artifact-transfer';
import { readWorkbenchJsonResponse } from '../../../../lib/workbench-response';
import {
  decodeSyncReceiptQuery,
  encodeSyncReceiptQuery,
  validSyncReceiptTrace,
  type SyncReceiptReason,
  type SyncReceiptFailure,
} from '../model';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
let activeReads = 0;
class ReceiptError extends Error {
  constructor(
    readonly reason: SyncReceiptReason,
    readonly status: number,
  ) {
    super(reason);
  }
}

/** A receipt read only: no upload, replacement identity, write key or local queue mutation. */
export async function POST(request: Request): Promise<Response> {
  const supplied = request.headers.get('x-trace-id') ?? '';
  const trace = validSyncReceiptTrace(supplied)
    ? supplied
    : 'trace_web_sync_receipt_' + randomUUID();
  const controller = new AbortController();
  const abort = () => controller.abort();
  const deadline = performance.now() + 30_000;
  const timer = setTimeout(abort, 30_000);
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const check = () => {
    if (controller.signal.aborted || performance.now() >= deadline)
      throw new ReceiptError('timeout', 504);
  };
  let reserved = false;
  const responseHeaders = {
    'cache-control': 'private, no-store, no-transform',
    'x-content-type-options': 'nosniff',
    'x-trace-id': trace,
  };
  try {
    if (
      !validSyncReceiptTrace(supplied) ||
      new URL(request.url).search ||
      request.headers.get('origin') !== new URL(runtimeConfig.appUrl).origin ||
      (request.headers.has('sec-fetch-site') &&
        request.headers.get('sec-fetch-site') !== 'same-origin') ||
      request.headers.get('x-workctx-sync-receipt') !== '1' ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      ) ||
      [
        'content-encoding',
        'idempotency-key',
        'if-match',
        'if-match-version',
        'range',
        'if-range',
      ].some((key) => request.headers.has(key))
    )
      throw new ReceiptError('denied', 403);
    const session = await getReceiptSession();
    check();
    if (activeReads >= 2) throw new ReceiptError('busy', 503);
    activeReads++;
    reserved = true;
    const length = request.headers.get('content-length');
    if (
      length !== null &&
      (!/^(0|[1-9][0-9]{0,15})$/.test(length) ||
        !Number.isSafeInteger(Number(length)) ||
        Number(length) > SYNC_EVENT_RECEIPT_REQUEST_BYTES)
    )
      throw new ReceiptError('invalid', 400);
    let query;
    try {
      const bytes = await readArtifactTransferBytes(
        request.body,
        SYNC_EVENT_RECEIPT_REQUEST_BYTES,
        controller.signal,
        length === null ? undefined : Number(length),
      );
      query = decodeSyncReceiptQuery(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      check();
      throw new ReceiptError('invalid', 400);
    }
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (query.identity[field] !== session.scope[field]) throw new ReceiptError('denied', 403);
    const base = new URL(runtimeConfig.apiUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new ReceiptError('unavailable', 503);
    if (session.expires_at * 1000 <= Date.now()) throw new AuthRequiredError();
    check();
    let response: Response;
    try {
      response = await fetch(base.href.replace(/\/$/, '') + '/v1/sync/events/receipt', {
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          authorization: 'Bearer ' + session.access_token,
          'content-type': 'application/json',
          accept: 'application/json',
          'x-trace-id': trace,
          'x-tenant-id': session.scope.tenant_id,
          'x-workspace-id': session.scope.workspace_id,
          'x-project-id': session.scope.project_id,
          'x-expected-actor-id': query.identity.actor_id,
          'x-expected-client-id': query.identity.client_id,
        },
        body: encodeSyncReceiptQuery(query),
      });
    } catch {
      check();
      throw new ReceiptError('unavailable', 503);
    }
    let value: unknown;
    try {
      value = await readWorkbenchJsonResponse(
        response,
        controller.signal,
        SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
        16384,
      );
      if (response.headers.get('x-trace-id') !== trace) throw new TypeError();
    } catch {
      check();
      throw new ReceiptError('invalid', 502);
    }
    check();
    if (!response.ok) {
      let code: string;
      try {
        const failure = validateErrorEnvelope(value);
        if (failure.trace_id !== trace) throw new TypeError();
        code = failure.code;
      } catch {
        throw new ReceiptError('invalid', 502);
      }
      if (response.status === 401) throw new ReceiptError('signin', 401);
      if (response.status === 403) throw new ReceiptError('denied', 403);
      if (code === 'EVENT_ID_REUSED') throw new ReceiptError('mismatch', 409);
      if (code === 'RATE_LIMITED' || response.status === 429) throw new ReceiptError('busy', 503);
      if (
        ['SYNC_EVENT_RECEIPT_INVALID', 'GATEWAY_RESPONSE_INVALID', 'INVALID_INPUT'].includes(code)
      )
        throw new ReceiptError('invalid', 502);
      throw new ReceiptError('unavailable', 503);
    }
    let receipt;
    try {
      receipt = parseSyncEventReceiptEnvelope(value, query, trace);
    } catch {
      throw new ReceiptError('invalid', 502);
    }
    if (session.expires_at * 1000 <= Date.now()) throw new AuthRequiredError();
    check();
    return Response.json(receipt, { headers: responseHeaders });
  } catch (error) {
    const failure =
      error instanceof AuthRequiredError
        ? new ReceiptError('signin', 401)
        : error instanceof ReceiptError
          ? error
          : new ReceiptError('unavailable', 503);
    return Response.json(
      {
        schema_version: 1,
        trace_id: trace,
        error: { reason: failure.reason },
      } satisfies SyncReceiptFailure,
      { status: failure.status, headers: responseHeaders },
    );
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    controller.abort();
    if (!request.bodyUsed) void request.body?.cancel().catch(() => {});
    if (reserved) activeReads--;
  }
}
