import {
  ContractError,
  WORKBENCH_AUDIT_ERROR_BYTES,
  validateErrorEnvelope,
} from '@planemem/contracts';
import type { WcpBinaryResponse } from './client.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

interface BoundedBytesRequest {
  url: URL;
  headers: Headers;
  maximum: number;
  trace: string;
  timeout: number;
  signal: AbortSignal | undefined;
  accessToken: () => string | Promise<string>;
  send: typeof fetch;
}

function cancel(response: Response) {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    /* Cleanup must never extend the local deadline. */
  }
}

/** One budget covers credentials, response headers and every body chunk. */
export async function requestBoundedBytes(input: BoundedBytesRequest): Promise<WcpBinaryResponse> {
  const budget = createRequestBudget(input.trace, input.timeout, input.signal);
  let response: Response | undefined;
  const invalid = () =>
    new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Gateway returned an invalid or incomplete binary response',
      { trace_id: input.trace, retryable: false },
    );
  try {
    const provided = await budget.wait(input.accessToken);
    if (typeof provided !== 'string' || !provided.trim())
      throw new ContractError('UNAUTHENTICATED', 'A bearer token is required', {
        trace_id: input.trace,
        retryable: false,
      });
    const headers = new Headers(input.headers);
    headers.set('authorization', 'Bearer ' + provided.trim());
    headers.set('accept', 'application/octet-stream');
    response = await budget.wait(
      () =>
        input.send(input.url, {
          method: 'GET',
          headers,
          cache: 'no-store',
          redirect: 'error',
          signal: budget.signal,
        }),
      cancel,
    );
    budget.check();
    if (response.status === 401)
      throw new ContractError('UNAUTHENTICATED', 'The current session must be renewed', {
        trace_id: input.trace,
        retryable: false,
      });
    const responseTrace = response.headers.get('x-trace-id');
    if (responseTrace !== null && responseTrace !== input.trace) throw invalid();
    const encoding = response.headers.get('content-encoding');
    if (response.ok) {
      if (
        response.status !== 200 ||
        responseTrace !== input.trace ||
        response.headers.get('content-type') !== 'application/octet-stream' ||
        (encoding !== null && encoding !== 'identity') ||
        response.headers.has('content-range')
      )
        throw invalid();
      const resultHeaders = Object.fromEntries(response.headers.entries());
      let content: Uint8Array;
      try {
        content = await readBytes(response, input.maximum, budget, false);
      } catch {
        budget.check();
        throw invalid();
      }
      budget.check();
      return { status: 200, headers: resultHeaders, content };
    }
    if (
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
        response.headers.get('content-type') ?? '',
      )
    )
      throw invalid();
    let envelope;
    try {
      const content = await readBytes(response, WORKBENCH_AUDIT_ERROR_BYTES, budget, true);
      envelope = validateErrorEnvelope(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)),
      );
      if (envelope.trace_id !== input.trace) throw new TypeError();
    } catch {
      budget.check();
      throw invalid();
    }
    budget.check();
    throw new ContractError(envelope.code, envelope.message, { ...envelope, retryable: false });
  } catch (error) {
    budget.check();
    if (error instanceof ContractError) throw error;
    throw new ContractError('GATEWAY_UNAVAILABLE', 'The binary request could not be completed', {
      trace_id: input.trace,
      retryable: false,
    });
  } finally {
    try {
      if (response) cancel(response);
    } finally {
      budget.close();
    }
  }
}

async function readBytes(
  response: Response,
  maximum: number,
  budget: RequestBudget,
  json: boolean,
) {
  const declared = response.headers.get('content-length');
  let expected: number | undefined;
  if (declared !== null) {
    if (!/^(0|[1-9][0-9]{0,15})$/.test(declared) || !Number.isSafeInteger(Number(declared)))
      throw new TypeError();
    const encoding = response.headers.get('content-encoding');
    // JSON errors may be compressed; Fetch returns decoded bytes, not their wire length.
    if (encoding === null || encoding.toLowerCase() === 'identity') expected = Number(declared);
    if (expected !== undefined && expected > maximum) throw new TypeError();
  } else if (!json) throw new TypeError();
  if (!response.body) {
    if (json || expected !== 0) throw new TypeError();
    budget.check();
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  let complete = false;
  try {
    let buffer = new Uint8Array(Math.min(maximum, expected ?? 64 * 1024, 64 * 1024));
    let used = 0;
    while (true) {
      const next = await budget.wait(() => reader.read());
      if (next.done) {
        complete = true;
        break;
      }
      if (
        !(next.value instanceof Uint8Array) ||
        next.value.byteLength > maximum - used ||
        (expected !== undefined && next.value.byteLength > expected - used)
      )
        throw new TypeError();
      const needed = used + next.value.byteLength;
      if (needed > buffer.byteLength) {
        const larger = new Uint8Array(Math.min(maximum, Math.max(needed, buffer.byteLength * 2)));
        larger.set(buffer.subarray(0, used));
        buffer = larger;
      }
      buffer.set(next.value, used);
      used = needed;
    }
    if (expected !== undefined && expected !== used) throw new TypeError();
    budget.check();
    return used === buffer.byteLength ? buffer : buffer.slice(0, used);
  } finally {
    try {
      if (!complete) void reader.cancel().catch(() => undefined);
    } catch {
      /* Best effort. */
    }
    try {
      reader.releaseLock();
    } catch {
      /* A custom stream may retain a pending read. */
    }
  }
}
