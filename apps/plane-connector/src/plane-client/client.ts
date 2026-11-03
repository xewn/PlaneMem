import { ContractError } from '@planemem/contracts';
import {
  planeCursor,
  planeEtag,
  planeEtagsWeaklyMatch,
  planeInteger,
  planeJson,
  planeOrigin,
  planeRequestKey,
  planeSegment,
  planeToken,
  planeTrace,
} from './validation.js';

export interface PlaneTransportRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface PlaneTransportResponse<T> {
  status: number;
  headers: Record<string, string>;
  /** Error and not-modified responses need not expose a body. */
  data: T | undefined;
}

export interface PlaneTransport {
  request<T>(request: PlaneTransportRequest): Promise<PlaneTransportResponse<T>>;
}

export interface PlaneClientConfig {
  base_url: string;
  api_token: string;
  workspace_slug: string;
  trace_id: string;
  max_retries?: number;
  retry_delay_ms?: number;
  max_retry_delay_ms?: number;
}

export interface PlaneRequestOptions {
  signal?: AbortSignal;
}
export interface PlaneApiResult<T> {
  data: T;
  status: number;
  trace_id: string;
  /** Opaque upstream value; never derived from a local observation version. */
  etag?: string;
}

export type PlaneConditionalResult<T> =
  | (PlaneApiResult<T> & { not_modified: false; requested_etag: string })
  | {
      not_modified: true;
      status: 304;
      trace_id: string;
      requested_etag: string;
      /** Present only when the server actually returned a matching ETag. */
      etag?: string;
      data?: never;
    };

type PreparedPlaneRequest = { path: string; body?: unknown; headers?: Record<string, string> };

export interface PlaneProject {
  id: string;
  version?: number;
  [key: string]: unknown;
}

export interface PlaneWorkItem {
  id: string;
  version?: number;
  [key: string]: unknown;
}

export interface PlaneAttachmentPage {
  items: unknown[];
  has_more: boolean;
  next_cursor?: string;
}

export class PlaneClient {
  private readonly config: Readonly<PlaneClientConfig>;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly maxRetryDelay: number;

  constructor(
    private readonly transport: PlaneTransport,
    config: PlaneClientConfig,
  ) {
    planeOrigin(config.base_url);
    planeToken(config.api_token);
    planeTrace(config.trace_id);
    planeSegment(config.workspace_slug);
    this.maxRetries = planeInteger(config.max_retries ?? 2, 0, 5, 'max_retries');
    this.retryDelay = planeInteger(config.retry_delay_ms ?? 250, 1, 10_000, 'retry_delay_ms');
    this.maxRetryDelay = planeInteger(
      config.max_retry_delay_ms ?? 30_000,
      this.retryDelay,
      60_000,
      'max_retry_delay_ms',
    );
    this.config = Object.freeze({ ...config });
  }

  getProject(projectId: string, options: PlaneRequestOptions = {}): Promise<PlaneProject> {
    return this.getProjectResult(projectId, options).then((result) => result.data);
  }

  getProjectResult(
    projectId: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneApiResult<PlaneProject>> {
    return this.request(
      'GET',
      () => ({
        path: `/api/workspaces/${planeSegment(this.config.workspace_slug)}/projects/${planeSegment(projectId)}`,
      }),
      (data) => entity(data, projectId),
      options,
    );
  }

  getProjectIfChanged(
    projectId: string,
    ifNoneMatch: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneConditionalResult<PlaneProject>> {
    return this.request(
      'GET',
      () => ({
        path: `/api/workspaces/${planeSegment(this.config.workspace_slug)}/projects/${planeSegment(projectId)}`,
        headers: { 'if-none-match': planeEtag(ifNoneMatch) },
      }),
      (data) => entity(data, projectId),
      options,
      true,
    );
  }

  /** Reads current upstream state; it is not a receipt for an earlier write. */
  getWorkItem(
    projectId: string,
    workItemId: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneWorkItem> {
    return this.getWorkItemResult(projectId, workItemId, options).then((result) => result.data);
  }

  getWorkItemResult(
    projectId: string,
    workItemId: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneApiResult<PlaneWorkItem>> {
    return this.request(
      'GET',
      () => ({
        path: `/api/projects/${planeSegment(projectId)}/issues/${planeSegment(workItemId)}`,
      }),
      (data) => entity(data, workItemId),
      options,
    );
  }

  getWorkItemIfChanged(
    projectId: string,
    workItemId: string,
    ifNoneMatch: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneConditionalResult<PlaneWorkItem>> {
    return this.request(
      'GET',
      () => ({
        path: `/api/projects/${planeSegment(projectId)}/issues/${planeSegment(workItemId)}`,
        headers: { 'if-none-match': planeEtag(ifNoneMatch) },
      }),
      (data) => entity(data, workItemId),
      options,
      true,
    );
  }

  createWorkItem(
    projectId: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneWorkItem> {
    return this.createWorkItemResult(projectId, payload, idempotencyKey, options).then(
      (result) => result.data,
    );
  }

  createWorkItemResult(
    projectId: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneApiResult<PlaneWorkItem>> {
    return this.request(
      'POST',
      () => ({
        path: `/api/projects/${planeSegment(projectId)}/issues`,
        body: payload,
        headers: { 'idempotency-key': planeRequestKey(idempotencyKey) },
      }),
      (data) => entity(data),
      options,
    );
  }

  updateWorkItem(
    projectId: string,
    workItemId: string,
    patch: Record<string, unknown>,
    ifMatch: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneWorkItem> {
    return this.updateWorkItemResult(projectId, workItemId, patch, ifMatch, options).then(
      (result) => result.data,
    );
  }

  updateWorkItemResult(
    projectId: string,
    workItemId: string,
    patch: Record<string, unknown>,
    ifMatch: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneApiResult<PlaneWorkItem>> {
    return this.request(
      'PATCH',
      () => ({
        path: `/api/projects/${planeSegment(projectId)}/issues/${planeSegment(workItemId)}`,
        body: patch,
        headers: { 'if-match': planeEtag(ifMatch) },
      }),
      (data) => entity(data, workItemId),
      options,
    );
  }

  listAttachments(
    projectId: string,
    workItemId: string,
    cursor?: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneAttachmentPage> {
    return this.listAttachmentsResult(projectId, workItemId, cursor, options).then(
      (result) => result.data,
    );
  }

  listAttachmentsResult(
    projectId: string,
    workItemId: string,
    cursor?: string,
    options: PlaneRequestOptions = {},
  ): Promise<PlaneApiResult<PlaneAttachmentPage>> {
    return this.request(
      'GET',
      () => ({
        path: `/api/projects/${planeSegment(projectId)}/issues/${planeSegment(workItemId)}/attachments${cursor === undefined ? '' : '?cursor=' + encodeURIComponent(planeCursor(cursor))}`,
      }),
      (data) => attachments(data, cursor),
      options,
    );
  }

  private request<T>(
    method: PlaneTransportRequest['method'],
    prepare: () => PreparedPlaneRequest,
    parse: (data: unknown) => T,
    options: PlaneRequestOptions,
  ): Promise<PlaneApiResult<T>>;
  private request<T>(
    method: 'GET',
    prepare: () => PreparedPlaneRequest,
    parse: (data: unknown) => T,
    options: PlaneRequestOptions,
    conditional: true,
  ): Promise<PlaneConditionalResult<T>>;
  private async request<T>(
    method: PlaneTransportRequest['method'],
    prepare: () => PreparedPlaneRequest,
    parse: (data: unknown) => T,
    options: PlaneRequestOptions,
    conditional = false,
  ): Promise<PlaneApiResult<T> | PlaneConditionalResult<T>> {
    const write = method !== 'GET';
    const signal = options.signal;
    const error = (
      code: string,
      message: string,
      retryable = false,
      details: Record<string, unknown> = {},
    ) =>
      new ContractError(code, message, {
        trace_id: this.config.trace_id,
        retryable: !write && retryable,
        ...(write ? { write_outcome: 'unknown' } : {}),
        ...details,
      });
    let request: PlaneTransportRequest;
    let requestedEtag: string | undefined;
    try {
      const prepared = prepare();
      if (conditional) {
        if (write) throw new TypeError();
        requestedEtag = planeEtag(prepared.headers?.['if-none-match']);
      }
      if (
        write &&
        (!prepared.body || typeof prepared.body !== 'object' || Array.isArray(prepared.body))
      )
        throw new TypeError();
      request = {
        method,
        path: prepared.path,
        headers: {
          authorization: `Bearer ${this.config.api_token}`,
          'x-trace-id': this.config.trace_id,
          ...prepared.headers,
        },
        ...(prepared.body === undefined
          ? {}
          : { body: JSON.parse(planeJson(prepared.body, 1_048_576)) }),
        ...(signal === undefined ? {} : { signal }),
      };
    } catch {
      throw error(
        'PLANE_INPUT_INVALID',
        'Plane identifiers, preconditions or JSON payload are invalid',
        false,
        write ? { write_outcome: 'not_sent' } : {},
      );
    }
    const cancelled = (notSent = false) =>
      error(
        'PLANE_REQUEST_CANCELLED',
        'Plane request was cancelled',
        false,
        write && notSent ? { write_outcome: 'not_sent' } : {},
      );
    const wait = async (attempt: number, failure: ContractError, retryAfter?: number) => {
      if (
        write ||
        attempt >= this.maxRetries ||
        !failure.envelope.retryable ||
        (retryAfter !== undefined && retryAfter > this.maxRetryDelay)
      )
        throw failure;
      const backoff = Math.min(
        this.maxRetryDelay,
        Math.max(1, Math.floor(this.retryDelay * 2 ** attempt * (0.5 + Math.random() / 2))),
      );
      try {
        await pause(Math.max(backoff, retryAfter ?? 0), signal);
      } catch {
        throw cancelled();
      }
    };
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw cancelled(true);
      let response: PlaneTransportResponse<unknown>;
      try {
        response = await this.transport.request<unknown>(request);
      } catch (caught) {
        const known = caught instanceof ContractError ? caught.envelope : undefined;
        if (signal?.aborted) throw cancelled(known?.details.write_outcome === 'not_sent');
        const status = known?.details.status;
        const code =
          known &&
          [
            'PLANE_INPUT_INVALID',
            'PLANE_REQUEST_CANCELLED',
            'PLANE_RESPONSE_INVALID',
            'PLANE_TRANSPORT_UNAVAILABLE',
          ].includes(known.code)
            ? known.code
            : 'PLANE_TRANSPORT_UNAVAILABLE';
        const message =
          code === 'PLANE_INPUT_INVALID'
            ? 'Plane transport rejected the request before dispatch'
            : code === 'PLANE_REQUEST_CANCELLED'
              ? 'Plane request was cancelled'
              : code === 'PLANE_RESPONSE_INVALID'
                ? 'Plane response could not be validated'
                : 'Plane request or response transfer failed';
        const failure = error(
          code,
          message,
          code === 'PLANE_TRANSPORT_UNAVAILABLE' && known?.retryable !== false,
          {
            ...(write && known?.details.write_outcome === 'not_sent'
              ? { write_outcome: 'not_sent' }
              : {}),
            ...(typeof status === 'number' &&
            Number.isInteger(status) &&
            status >= 100 &&
            status <= 599
              ? { status }
              : {}),
          },
        );
        await wait(attempt, failure);
        continue;
      }
      if (signal?.aborted) throw cancelled();
      if (
        !response ||
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599 ||
        !response.headers ||
        typeof response.headers !== 'object' ||
        Array.isArray(response.headers)
      )
        throw error('PLANE_RESPONSE_INVALID', 'Plane transport returned invalid response metadata');
      const header = (name: string) => {
        const matches = Object.entries(response.headers).filter(
          ([key]) => key.toLowerCase() === name,
        );
        return matches.length === 1 && typeof matches[0]![1] === 'string'
          ? matches[0]![1]
          : undefined;
      };
      if (response.status === 304) {
        if (
          !conditional ||
          requestedEtag === undefined ||
          method !== 'GET' ||
          response.data !== undefined
        )
          throw error('PLANE_RESPONSE_INVALID', 'Unexpected Plane not-modified response', false, {
            status: 304,
          });
        const etagFields = Object.entries(response.headers).filter(
          ([name]) => name.toLowerCase() === 'etag',
        );
        let etag: string | undefined;
        try {
          if (etagFields.length > 1) throw new TypeError();
          if (etagFields.length === 1) {
            etag = planeEtag(etagFields[0]![1]);
            if (!planeEtagsWeaklyMatch(etag, requestedEtag)) throw new TypeError();
          }
        } catch {
          throw error(
            'PLANE_RESPONSE_INVALID',
            'Plane not-modified validator does not match the request',
            false,
            { status: 304 },
          );
        }
        return {
          not_modified: true,
          status: 304,
          trace_id: this.config.trace_id,
          requested_etag: requestedEtag,
          ...(etag === undefined ? {} : { etag }),
        };
      }
      if (response.status < 200 || response.status >= 300) {
        const retryAfter = retryDelay(header('retry-after'));
        const failure = error(
          'PLANE_API_ERROR',
          `Plane API returned HTTP ${response.status}`,
          response.status === 408 || response.status === 429 || response.status >= 500,
          {
            status: response.status,
            ...(retryAfter === undefined ? {} : { retry_after_ms: retryAfter }),
          },
        );
        await wait(attempt, failure, retryAfter);
        continue;
      }
      let data: T;
      try {
        data = parse(response.data);
      } catch {
        throw error(
          'PLANE_RESPONSE_INVALID',
          'Plane success response does not match the requested resource',
          false,
          { status: response.status },
        );
      }
      let etag: string | undefined;
      try {
        const value = header('etag');
        if (value !== undefined) etag = planeEtag(value);
      } catch {
        /* Invalid optional ETags are never supplied as usable preconditions. */
      }
      const result: PlaneApiResult<T> = {
        data,
        status: response.status,
        trace_id: this.config.trace_id,
        ...(etag === undefined ? {} : { etag }),
      };
      return conditional
        ? { ...result, not_modified: false, requested_etag: requestedEtag! }
        : result;
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  const copy: unknown = JSON.parse(planeJson(value, 33_554_432));
  if (!copy || typeof copy !== 'object' || Array.isArray(copy))
    throw new TypeError('Expected a Plane object');
  return copy as Record<string, unknown>;
}

function entity(value: unknown, expectedId?: string): PlaneWorkItem {
  const row = record(value);
  planeSegment(row.id);
  if (expectedId !== undefined && row.id !== expectedId)
    throw new TypeError('Plane resource ID mismatch');
  if (
    row.version !== undefined &&
    (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 0)
  )
    throw new TypeError('Invalid Plane version');
  return row as PlaneWorkItem;
}

function attachments(value: unknown, previousCursor?: string): PlaneAttachmentPage {
  const row = record(value);
  if (!Array.isArray(row.items) || row.items.length > 1000 || typeof row.has_more !== 'boolean')
    throw new TypeError('Invalid Plane attachment page');
  const cursor = row.next_cursor === undefined ? undefined : planeCursor(row.next_cursor);
  if (
    row.has_more !== (cursor !== undefined) ||
    (cursor !== undefined && cursor === previousCursor)
  )
    throw new TypeError('Invalid Plane attachment continuation');
  return {
    items: row.items,
    has_more: row.has_more,
    ...(cursor === undefined ? {} : { next_cursor: cursor }),
  };
}

function retryDelay(value: string | undefined): number | undefined {
  if (value === undefined || value.length > 128) return;
  const input = value.trim();
  if (/^[0-9]+$/.test(input)) return Math.min(Number.MAX_SAFE_INTEGER, Number(input) * 1000);
  if (!/^[A-Za-z]{3}, /.test(input)) return;
  const time = Date.parse(input);
  if (Number.isFinite(time)) return Math.max(0, time - Date.now());
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Cancelled'));
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(new Error('Cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
