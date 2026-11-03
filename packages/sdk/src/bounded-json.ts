import {
  ContractError,
  WORKBENCH_AUDIT_ERROR_BYTES,
  validateErrorEnvelope,
} from '@planemem/contracts';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

interface BoundedJsonRequest {
  url: URL;
  method: 'GET' | 'POST';
  headers: Headers;
  body: string | undefined;
  maximum: number;
  trace: string;
  timeout: number;
  signal: AbortSignal | undefined;
  accessToken: () => string | Promise<string>;
  send: typeof fetch;
}

const cancel = (response: Response) => {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    /* Best-effort cleanup. */
  }
};

/** Only the explicit bounded-json path uses this complete credential/network/body deadline. */
export async function requestBoundedJson(input: BoundedJsonRequest): Promise<unknown> {
  const budget = createRequestBudget(input.trace, input.timeout, input.signal);
  let response: Response | undefined;
  const invalid = () =>
    new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Gateway returned an invalid bounded JSON response',
      { trace_id: input.trace },
    );
  try {
    const provided = await budget.wait(input.accessToken);
    if (typeof provided !== 'string' || !provided.trim())
      throw new ContractError('UNAUTHENTICATED', 'A bearer token is required', {
        trace_id: input.trace,
      });
    const headers = new Headers(input.headers);
    headers.set('authorization', 'Bearer ' + provided.trim());
    headers.set('accept', 'application/json');
    response = await budget.wait(
      () =>
        input.send(input.url, {
          method: input.method,
          headers,
          cache: 'no-store',
          redirect: 'error',
          signal: budget.signal,
          ...(input.body === undefined ? {} : { body: input.body }),
        }),
      cancel,
    );
    budget.check();
    if (response.status === 401)
      throw new ContractError('UNAUTHENTICATED', 'The current session must be renewed', {
        trace_id: input.trace,
      });
    const responseTrace = response.headers.get('x-trace-id');
    if (
      (responseTrace !== null && responseTrace !== input.trace) ||
      (response.ok && (response.status !== 200 || responseTrace !== input.trace)) ||
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
        response.headers.get('content-type') ?? '',
      )
    )
      throw invalid();
    let value: unknown;
    try {
      const bytes = await readJsonBytes(
        response,
        response.ok ? input.maximum : WORKBENCH_AUDIT_ERROR_BYTES,
        budget,
      );
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      budget.check();
      throw invalid();
    }
    budget.check();
    if (!response.ok) {
      let error;
      try {
        error = validateErrorEnvelope(value);
        if (error.trace_id !== input.trace) throw new TypeError();
      } catch {
        throw invalid();
      }
      throw new ContractError(error.code, error.message, { ...error, retryable: false });
    }
    return value;
  } catch (error) {
    budget.check();
    if (error instanceof ContractError) throw error;
    throw new ContractError(
      'GATEWAY_UNAVAILABLE',
      'The bounded JSON request could not be completed',
      { trace_id: input.trace, retryable: false },
    );
  } finally {
    try {
      if (response) cancel(response);
    } finally {
      budget.close();
    }
  }
}

async function readJsonBytes(response: Response, maximum: number, budget: RequestBudget) {
  const declared = response.headers.get('content-length');
  let expected: number | undefined;
  if (declared !== null) {
    if (!/^(0|[1-9][0-9]{0,15})$/.test(declared) || !Number.isSafeInteger(Number(declared)))
      throw new TypeError();
    const encoding = response.headers.get('content-encoding');
    // Fetch yields decoded bytes; compressed wire size cannot be their expected size.
    if (encoding === null || encoding.toLowerCase() === 'identity') expected = Number(declared);
    if (expected !== undefined && expected > maximum) throw new TypeError();
  }
  if (!response.body) throw new TypeError();
  const reader = response.body.getReader();
  let complete = false;
  try {
    let buffer = new Uint8Array(Math.min(maximum, expected ?? 64 * 1024));
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
      /* Preserve the original read failure. */
    }
    try {
      reader.releaseLock();
    } catch {
      /* Best-effort cleanup, including pending reads. */
    }
  }
}
