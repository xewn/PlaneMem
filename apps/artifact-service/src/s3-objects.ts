import { isSyncIdentifier, isUlid } from '@planemem/contracts';
import { artifactDigest, type ImmutableArtifactObjects } from './persistent-model.js';
import {
  encodeS3PathSegment,
  signArtifactS3Request,
  type S3ArtifactCredentials,
} from './s3-signing.js';

export type { S3ArtifactCredentials } from './s3-signing.js';

export interface S3ArtifactOptions {
  endpoint: string;
  region: string;
  bucket: string;
  /** Server-owned credential provider; called once per operation and given the operation deadline. */
  credentials: (signal: AbortSignal) => Promise<S3ArtifactCredentials>;
  allow_http?: boolean;
  timeout_ms?: number;
  max_bytes?: number;
}

export class S3ArtifactObjectError extends Error {
  constructor(
    readonly code: 'S3_UNAVAILABLE' | 'S3_TIMEOUT' | 'S3_RESPONSE_INVALID' | 'S3_TOO_LARGE',
    readonly status: number | undefined = undefined,
  ) {
    super(`Artifact object operation failed (${code})`);
    this.name = 'S3ArtifactObjectError';
  }
}

/** Path-style S3 adapter. No I/O at construction; no bucket creation, deletion, redirects or retries. */
export class S3ArtifactObjects implements ImmutableArtifactObjects {
  private readonly endpoint: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly credentials: S3ArtifactOptions['credentials'];
  private readonly timeout: number;
  private readonly maxBytes: number;

  constructor(options: S3ArtifactOptions) {
    let endpoint: URL;
    try {
      endpoint = new URL(options.endpoint);
    } catch {
      throw new TypeError('Invalid S3 endpoint');
    }
    if (
      (endpoint.protocol !== 'https:' &&
        !(options.allow_http === true && endpoint.protocol === 'http:')) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== '/' ||
      typeof options.bucket !== 'string' ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket) ||
      options.bucket.includes('..') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(options.bucket) ||
      typeof options.region !== 'string' ||
      !/^[a-z0-9-]{1,64}$/.test(options.region) ||
      typeof options.credentials !== 'function'
    )
      throw new TypeError('Invalid S3 artifact configuration');
    this.endpoint = endpoint.origin;
    this.bucket = options.bucket;
    this.region = options.region;
    this.credentials = options.credentials;
    this.timeout = positiveInteger(options.timeout_ms ?? 30_000, 2_147_483_647);
    this.maxBytes = byteLimit(options.max_bytes ?? 64 * 1024 * 1024);
  }

  async putIfAbsent(key: string, content: Uint8Array): Promise<void> {
    const url = this.objectUrl(key);
    if (!(content instanceof Uint8Array)) throw new TypeError('Supply artifact bytes');
    if (content.byteLength > this.maxBytes) throw new S3ArtifactObjectError('S3_TOO_LARGE');
    const bytes = new Uint8Array(content);
    await this.operation(async (signal) => {
      const response = await this.request('PUT', url, signal, bytes);
      try {
        // 412 means this conditional PUT did not overwrite the object. The service reads it back.
        if (response.status !== 200 && response.status !== 412)
          throw new S3ArtifactObjectError('S3_UNAVAILABLE', response.status);
      } finally {
        await response.body?.cancel();
      }
    });
  }

  async read(key: string, maxBytes: number): Promise<Uint8Array | undefined> {
    const url = this.objectUrl(key);
    const limit = Math.min(byteLimit(maxBytes), this.maxBytes);
    return this.operation(async (signal) => {
      const response = await this.request('GET', url, signal);
      if (response.status === 404) {
        const errorBytes = await readBounded(response, 16 * 1024);
        const body = new TextDecoder('utf-8', { fatal: true }).decode(errorBytes);
        // Parse only this bounded, fixed marker. Do not expand XML entities or expose the body.
        if (
          !/<!DOCTYPE|<!ENTITY/i.test(body) &&
          /^\s*(?:<\?xml\s[^?]*\?>\s*)?<Error(?:\s[^<>]*)?>\s*<Code>\s*NoSuchKey\s*<\/Code>[\s\S]*<\/Error>\s*$/.test(
            body,
          )
        )
          return;
        throw new S3ArtifactObjectError('S3_UNAVAILABLE', 404);
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new S3ArtifactObjectError('S3_UNAVAILABLE', response.status);
      }
      return readBounded(response, limit);
    });
  }

  private async request(method: 'GET' | 'PUT', url: URL, signal: AbortSignal, bytes?: Uint8Array) {
    const credentials = await abortable(this.credentials(signal), signal);
    signal.throwIfAborted();
    const headers = signArtifactS3Request(
      method,
      url,
      this.region,
      credentials,
      artifactDigest(bytes ?? ''),
    );
    return fetch(url, {
      method,
      headers,
      signal,
      redirect: 'error',
      cache: 'no-store',
      // The buffer is owned by this operation; no caller-owned ArrayBuffer reaches fetch.
      ...(bytes === undefined ? {} : { body: new Uint8Array(bytes).buffer }),
    });
  }

  private async operation<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    try {
      return await abortable(work(controller.signal), controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw new S3ArtifactObjectError('S3_TIMEOUT');
      if (error instanceof S3ArtifactObjectError) throw error;
      // Provider and transport errors can contain credentials or URLs; never preserve their text/cause.
      throw new S3ArtifactObjectError('S3_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private objectUrl(key: string): URL {
    if (typeof key !== 'string' || new TextEncoder().encode(key).byteLength > 1024)
      throw new TypeError('Invalid artifact object key');
    const parts = key.split('/');
    if (
      parts.length !== 7 ||
      parts[0] !== 'artifacts' ||
      !isUlid(parts[4]) ||
      parts[5] !== 'sha256' ||
      !/^[a-f0-9]{64}$/.test(parts[6] ?? '')
    )
      throw new TypeError('Invalid artifact object key');
    for (const part of parts.slice(1, 4)) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(part);
      } catch {
        throw new TypeError('Invalid artifact object scope');
      }
      if (
        !isSyncIdentifier(decoded) ||
        decoded === '.' ||
        decoded === '..' ||
        encodeURIComponent(decoded) !== part
      )
        throw new TypeError('Invalid artifact object scope');
    }
    // Generated keys contain literal percent escapes. Encode them as bytes; never decode or normalize the key.
    return new URL(
      `${this.endpoint}/${encodeS3PathSegment(this.bucket)}/${parts.map(encodeS3PathSegment).join('/')}`,
    );
  }
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const encoding = response.headers.get('content-encoding');
  const length = response.headers.get('content-length');
  if (
    (encoding !== null && encoding.toLowerCase() !== 'identity') ||
    (length !== null && !/^(0|[1-9][0-9]*)$/.test(length))
  ) {
    await response.body?.cancel();
    throw new S3ArtifactObjectError('S3_RESPONSE_INVALID', response.status);
  }
  const expected = length === null ? undefined : Number(length);
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected > maxBytes)) {
    await response.body?.cancel();
    throw new S3ArtifactObjectError('S3_TOO_LARGE', response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    if (expected !== undefined && expected !== 0)
      throw new S3ArtifactObjectError('S3_RESPONSE_INVALID', response.status);
    return new Uint8Array();
  }
  let bytes = new Uint8Array(expected ?? Math.min(maxBytes, 64 * 1024));
  let total = 0;
  let complete = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.byteLength > maxBytes - total)
        throw new S3ArtifactObjectError('S3_TOO_LARGE', response.status);
      if (expected !== undefined && next.value.byteLength > expected - total)
        throw new S3ArtifactObjectError('S3_RESPONSE_INVALID', response.status);
      if (next.value.byteLength) {
        if (next.value.byteLength > bytes.byteLength - total) {
          const capacity = Math.min(
            maxBytes,
            Math.max(total + next.value.byteLength, bytes.byteLength * 2),
          );
          const grown = new Uint8Array(capacity);
          grown.set(bytes.subarray(0, total));
          bytes = grown;
        }
        bytes.set(next.value, total);
        total += next.value.byteLength;
      }
    }
    complete = true;
    if (expected !== undefined && total !== expected)
      throw new S3ArtifactObjectError('S3_RESPONSE_INVALID', response.status);
    return total === bytes.byteLength ? bytes : bytes.slice(0, total);
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new S3ArtifactObjectError('S3_TIMEOUT'));
    signal.addEventListener('abort', abort, { once: true });
    // Always observe pending rejection, including when the operation already timed out.
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

function positiveInteger(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new TypeError('Invalid S3 operation limit');
  return value;
}
function byteLimit(value: number): number {
  if (value === 0) return 0;
  return positiveInteger(value, 1024 * 1024 * 1024);
}
