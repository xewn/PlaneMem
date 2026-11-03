import {
  ARTIFACT_DOWNLOAD_MAX_BYTES,
  WORKBENCH_AUDIT_RESPONSE_BYTES,
  ContractError,
  validateErrorEnvelope,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { requestBoundedJson } from './bounded-json.js';

export interface FetchWcpTransportOptions {
  base_url: string;
  /** Called for each request so callers can refresh credentials. */
  access_token: () => string | Promise<string>;
  fetch?: typeof fetch;
  timeout_ms?: number;
}

export class FetchWcpTransport implements WcpTransport {
  private readonly base: URL;
  private readonly send: typeof fetch;
  private readonly timeout: number;

  constructor(private readonly options: FetchWcpTransportOptions) {
    this.base = new URL(options.base_url);
    if (
      !['http:', 'https:'].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password
    )
      throw new TypeError('base_url must be an HTTP(S) URL without embedded credentials');
    this.timeout = options.timeout_ms ?? 30_000;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 2_147_483_647)
      throw new RangeError('timeout_ms must be a positive integer no greater than 2147483647');
    this.send = options.fetch ?? fetch;
  }

  async request<T = unknown>(request: WcpRequest): Promise<T> {
    const trace = request.headers['x-trace-id'] ?? request.headers.traceparent ?? 'trace_unknown';
    const url = new URL(request.path, this.base);
    if (
      !request.path.startsWith('/v1/') ||
      url.origin !== this.base.origin ||
      !url.pathname.startsWith('/v1/') ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new ContractError('INVALID_INPUT', 'Expected a gateway /v1/ request path', {
        trace_id: trace,
      });
    // Snapshot mutable caller state before the asynchronous credential provider runs.
    const method = request.method;
    const headers = new Headers(request.headers);
    const responseType = request.response_type ?? 'json';
    const maxBytes = request.max_response_bytes;
    if (
      !['json', 'bytes', 'bounded-json'].includes(responseType) ||
      (request.signal !== undefined && responseType !== 'bounded-json') ||
      (responseType === 'bytes'
        ? method !== 'GET' ||
          request.body !== undefined ||
          typeof maxBytes !== 'number' ||
          !Number.isSafeInteger(maxBytes) ||
          maxBytes < 0 ||
          maxBytes > ARTIFACT_DOWNLOAD_MAX_BYTES
        : responseType === 'bounded-json'
          ? typeof maxBytes !== 'number' ||
            !Number.isSafeInteger(maxBytes) ||
            maxBytes < 1 ||
            maxBytes > WORKBENCH_AUDIT_RESPONSE_BYTES
          : maxBytes !== undefined)
    )
      throw new ContractError(
        'INVALID_INPUT',
        'Supply an explicit valid limit for bytes or bounded-json; cancellation requires bounded-json',
        { trace_id: trace },
      );
    let requestBody: string | FormData | undefined;
    if (request.body !== undefined) {
      if (method === 'GET')
        throw new ContractError('INVALID_INPUT', 'GET requests cannot contain a body', {
          trace_id: trace,
        });
      if (request.body instanceof FormData) {
        const copy = new FormData();
        for (const [name, value] of request.body.entries()) {
          if (typeof value === 'string') copy.append(name, value);
          else copy.append(name, value, value.name);
        }
        requestBody = copy;
        // fetch must supply the multipart boundary for this exact FormData instance.
        headers.delete('content-type');
        headers.delete('content-length');
      } else {
        requestBody = JSON.stringify(request.body);
        headers.set('content-type', 'application/json');
      }
    }
    if (responseType === 'bounded-json') {
      if (requestBody !== undefined && typeof requestBody !== 'string')
        throw new ContractError(
          'INVALID_INPUT',
          'Bounded JSON requests do not accept multipart bodies',
          { trace_id: trace },
        );
      return (await requestBoundedJson({
        url,
        method,
        headers,
        body: requestBody,
        maximum: maxBytes!,
        trace,
        timeout: this.timeout,
        signal: request.signal,
        accessToken: () => this.options.access_token(),
        send: this.send,
      })) as T;
    }
    const token = (await this.options.access_token()).trim();
    if (!token)
      throw new ContractError('UNAUTHENTICATED', 'A bearer token is required', { trace_id: trace });
    headers.set('authorization', 'Bearer ' + token);
    headers.set(
      'accept',
      responseType === 'bytes' ? 'application/octet-stream' : 'application/json',
    );
    const init: RequestInit = {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeout),
      ...(requestBody === undefined ? {} : { body: requestBody }),
    };
    let response: Response;
    try {
      response = await this.send(url, init);
    } catch {
      throw new ContractError('GATEWAY_UNAVAILABLE', 'Could not reach the configured gateway', {
        trace_id: trace,
        retryable: true,
      });
    }
    const responseTrace = response.headers.get('x-trace-id') || trace;
    if (responseType === 'bytes' && response.ok) {
      const content = await readBoundedResponse(response, maxBytes!, trace);
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        content,
      } as T;
    }
    let body: unknown;
    try {
      body =
        responseType === 'bytes'
          ? JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(
                await readBoundedResponse(response, 1024 * 1024, trace),
              ),
            )
          : await response.json();
    } catch {
      throw new ContractError('GATEWAY_RESPONSE_INVALID', 'Gateway returned invalid JSON', {
        trace_id: responseTrace,
        status: response.status,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }
    if (!response.ok) {
      let envelope;
      try {
        envelope = validateErrorEnvelope(body);
      } catch {
        throw new ContractError('GATEWAY_HTTP_ERROR', 'Gateway returned HTTP ' + response.status, {
          trace_id: responseTrace,
          status: response.status,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        });
      }
      throw new ContractError(envelope.code, envelope.message, envelope);
    }
    return body as T;
  }
}

async function readBoundedResponse(
  response: Response,
  maximum: number,
  trace: string,
): Promise<Uint8Array> {
  const fail = () =>
    new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Gateway binary response is invalid, incomplete or exceeds the byte limit',
      { trace_id: trace },
    );
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^(0|[1-9][0-9]*)$/.test(declared) ||
      !Number.isSafeInteger(Number(declared)) ||
      Number(declared) > maximum)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw fail();
  }
  if (!response.body) {
    if (declared !== null && declared !== '0') throw fail();
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  let buffer = new Uint8Array(Math.min(maximum, 64 * 1024));
  let used = 0;
  let complete = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        complete = true;
        break;
      }
      if (!(chunk.value instanceof Uint8Array) || used + chunk.value.byteLength > maximum)
        throw fail();
      if (used + chunk.value.byteLength > buffer.byteLength) {
        const next = new Uint8Array(
          Math.min(maximum, Math.max(buffer.byteLength * 2, used + chunk.value.byteLength)),
        );
        next.set(buffer.subarray(0, used));
        buffer = next;
      }
      buffer.set(chunk.value, used);
      used += chunk.value.byteLength;
    }
    if (declared !== null && Number(declared) !== used) throw fail();
    return buffer.slice(0, used);
  } catch {
    throw fail();
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
