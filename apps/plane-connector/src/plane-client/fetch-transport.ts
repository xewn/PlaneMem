import { ContractError } from '@planemem/contracts';
import {
  PlaneClient,
  type PlaneClientConfig,
  type PlaneTransport,
  type PlaneTransportRequest,
  type PlaneTransportResponse,
} from './client.js';
import {
  planeEtag,
  planeEtagsWeaklyMatch,
  planeInteger,
  planeJson,
  planeOrigin,
  planeRequestKey,
  planeToken,
  planeTrace,
} from './validation.js';

export interface FetchPlaneTransportOptions {
  base_url: string;
  fetch?: typeof fetch;
  /** Covers connection, response headers and the complete response body. */
  timeout_ms?: number;
  max_request_bytes?: number;
  max_response_bytes?: number;
}

/** Sends one attempt only. Read retry policy belongs to PlaneClient. */
export class FetchPlaneTransport implements PlaneTransport {
  private readonly base: URL;
  private readonly send: typeof fetch;
  private readonly timeout: number;
  private readonly maxRequest: number;
  private readonly maxResponse: number;

  constructor(options: FetchPlaneTransportOptions) {
    this.base = planeOrigin(options.base_url);
    this.send = options.fetch ?? fetch;
    this.timeout = planeInteger(options.timeout_ms ?? 30_000, 1, 120_000, 'timeout_ms');
    this.maxRequest = planeInteger(
      options.max_request_bytes ?? 1_048_576,
      1,
      16_777_216,
      'max_request_bytes',
    );
    this.maxResponse = planeInteger(
      options.max_response_bytes ?? 4_194_304,
      1,
      33_554_432,
      'max_response_bytes',
    );
  }

  async request<T>(request: PlaneTransportRequest): Promise<PlaneTransportResponse<T>> {
    let trace = 'trace_plane_transport';
    const write = request.method !== 'GET';
    const signal = request.signal;
    const failure = (
      code: string,
      message: string,
      sent: boolean,
      retryable = false,
      status?: number,
    ) =>
      new ContractError(code, message, {
        trace_id: trace,
        retryable: !write && retryable,
        ...(write ? { write_outcome: sent ? 'unknown' : 'not_sent' } : {}),
        ...(status === undefined ? {} : { status }),
      });
    let url: URL;
    let headers: Headers;
    let body: string | undefined;
    try {
      if (!['GET', 'POST', 'PATCH'].includes(request.method)) throw new TypeError();
      headers = new Headers();
      const entries = Object.entries(request.headers);
      const traces = entries.filter(([name]) => name.toLowerCase() === 'x-trace-id');
      if (traces.length !== 1) throw new TypeError();
      trace = planeTrace(traces[0]![1]);
      const names = new Set<string>();
      for (const [name, value] of entries) {
        const key = name.toLowerCase();
        if (
          !['authorization', 'x-trace-id', 'idempotency-key', 'if-match', 'if-none-match'].includes(
            key,
          ) ||
          names.has(key)
        )
          throw new TypeError();
        if (typeof value !== 'string') throw new TypeError();
        if (key === 'authorization') {
          if (!value.startsWith('Bearer ')) throw new TypeError();
          planeToken(value.slice(7));
        }
        if (key === 'idempotency-key') planeRequestKey(value);
        if (key === 'if-match' || key === 'if-none-match') planeEtag(value);
        names.add(key);
        headers.set(key, value);
      }
      trace = planeTrace(headers.get('x-trace-id'));
      const authorization = headers.get('authorization');
      if (!authorization?.startsWith('Bearer ')) throw new TypeError();
      planeToken(authorization.slice(7));
      if (headers.has('idempotency-key')) planeRequestKey(headers.get('idempotency-key'));
      if (headers.has('if-match')) planeEtag(headers.get('if-match'));
      if (headers.has('if-none-match') && (write || headers.has('if-match'))) throw new TypeError();
      if (
        typeof request.path !== 'string' ||
        request.path.length > 8192 ||
        !request.path.startsWith('/api/') ||
        /[\\\s\u0000-\u001f\u007f]/u.test(request.path)
      )
        throw new TypeError();
      const rawPath = request.path.split('?')[0]!;
      for (const part of rawPath.split('/').slice(1)) {
        const decoded = decodeURIComponent(part);
        if (decoded === '.' || decoded === '..' || /[\\/%?#\u0000-\u001f\u007f]/.test(decoded))
          throw new TypeError();
      }
      url = new URL(request.path, this.base);
      if (
        url.origin !== this.base.origin ||
        url.pathname !== rawPath ||
        !url.pathname.startsWith('/api/') ||
        url.hash ||
        url.username ||
        url.password
      )
        throw new TypeError();
      if (request.method === 'GET' && request.body !== undefined) throw new TypeError();
      if (
        write &&
        (!request.body || typeof request.body !== 'object' || Array.isArray(request.body))
      )
        throw new TypeError();
      if (request.body !== undefined) body = planeJson(request.body, this.maxRequest);
      headers.set('accept', 'application/json');
      if (body !== undefined) headers.set('content-type', 'application/json');
    } catch {
      throw failure(
        'PLANE_INPUT_INVALID',
        'Plane request path, headers or JSON body are invalid',
        false,
      );
    }
    if (signal?.aborted)
      throw failure(
        'PLANE_REQUEST_CANCELLED',
        'Plane request was cancelled before dispatch',
        false,
      );
    const controller = new AbortController();
    let timedOut = false;
    let sent = false;
    let status: number | undefined;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeout);
    try {
      if (signal?.aborted)
        throw failure(
          'PLANE_REQUEST_CANCELLED',
          'Plane request was cancelled before dispatch',
          false,
        );
      sent = true;
      const response = await this.send(url, {
        method: request.method,
        headers,
        body,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      status = response.status;
      if (controller.signal.aborted) throw new Error('Aborted');
      if (
        response.redirected ||
        (response.url && new URL(response.url).origin !== this.base.origin)
      ) {
        void response.body?.cancel().catch(() => undefined);
        throw failure(
          'PLANE_RESPONSE_INVALID',
          'Plane transport does not accept redirected responses',
          true,
          false,
          status,
        );
      }
      const metadata: Record<string, string> = {};
      const etag = response.headers.get('etag');
      if (status === 304) {
        void response.body?.cancel().catch(() => undefined);
        const requestedEtag = headers.get('if-none-match');
        if (write || requestedEtag === null)
          throw failure(
            'PLANE_RESPONSE_INVALID',
            'Unexpected Plane not-modified response',
            true,
            false,
            status,
          );
        try {
          if (etag !== null) {
            if (!planeEtagsWeaklyMatch(etag, requestedEtag)) throw new TypeError();
            metadata.etag = etag;
          }
        } catch {
          throw failure(
            'PLANE_RESPONSE_INVALID',
            'Plane not-modified validator does not match the request',
            true,
            false,
            status,
          );
        }
        return { status, headers: metadata, data: undefined };
      }
      if (etag !== null) {
        try {
          metadata.etag = planeEtag(etag);
        } catch {
          /* Malformed optional metadata is not a write precondition. */
        }
      }
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter !== null && retryAfter.length <= 128) metadata['retry-after'] = retryAfter;
      if (status < 200 || status >= 300) {
        // Error documents may contain secrets or HTML. Only status and selected headers leave transport.
        void response.body?.cancel().catch(() => undefined);
        return { status, headers: metadata, data: undefined };
      }
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (!contentType || !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(contentType)) {
        void response.body?.cancel().catch(() => undefined);
        throw failure(
          'PLANE_RESPONSE_INVALID',
          'Plane success response must contain JSON',
          true,
          false,
          status,
        );
      }
      const length = response.headers.get('content-length');
      if (
        length !== null &&
        /^[0-9]+$/.test(length) &&
        (length.length > 20 || BigInt(length) > BigInt(this.maxResponse))
      ) {
        void response.body?.cancel().catch(() => undefined);
        throw failure(
          'PLANE_RESPONSE_INVALID',
          'Plane response exceeds the byte limit',
          true,
          false,
          status,
        );
      }
      if (!response.body)
        throw failure(
          'PLANE_RESPONSE_INVALID',
          'Plane success response is empty',
          true,
          false,
          status,
        );
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      // A bounded buffer avoids unbounded per-chunk object overhead from tiny chunks.
      const buffer = new Uint8Array(this.maxResponse);
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          if (bytes + part.value.byteLength > this.maxResponse)
            throw failure(
              'PLANE_RESPONSE_INVALID',
              'Plane response exceeds the byte limit',
              true,
              false,
              status,
            );
          buffer.set(part.value, bytes);
          bytes += part.value.byteLength;
        }
      } finally {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      let data: unknown;
      if (controller.signal.aborted) throw new Error('Aborted');
      let text: string;
      try {
        text = decoder.decode(buffer.subarray(0, bytes));
      } catch {
        throw failure(
          'PLANE_RESPONSE_INVALID',
          'Plane response is not valid UTF-8',
          true,
          false,
          status,
        );
      }
      try {
        data = JSON.parse(text);
      } catch {
        throw failure(
          'PLANE_RESPONSE_INVALID',
          'Plane success response contains invalid JSON',
          true,
          false,
          status,
        );
      }
      return { status, headers: metadata, data: data as T };
    } catch (error) {
      if (signal?.aborted)
        throw failure(
          'PLANE_REQUEST_CANCELLED',
          'Plane request was cancelled',
          sent,
          false,
          status,
        );
      if (timedOut)
        throw failure('PLANE_TRANSPORT_UNAVAILABLE', 'Plane request timed out', sent, true, status);
      if (error instanceof ContractError) throw error;
      throw failure(
        'PLANE_TRANSPORT_UNAVAILABLE',
        'Plane request or response transfer failed',
        sent,
        true,
        status,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
}

/** One origin config drives both the typed client and its single-attempt transport. */
export function createFetchPlaneClient(
  config: PlaneClientConfig,
  options: Omit<FetchPlaneTransportOptions, 'base_url'> = {},
): PlaneClient {
  return new PlaneClient(
    new FetchPlaneTransport({ ...options, base_url: config.base_url }),
    config,
  );
}
