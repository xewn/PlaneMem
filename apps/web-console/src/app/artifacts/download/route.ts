import { createHash, randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import {
  parseArtifactReadEnvelope,
  parseArtifactDownloadMetadata,
  parseArtifactDownloadHeaders,
  validateErrorEnvelope,
} from '@planemem/contracts';
import { AuthRequiredError, getWorkbenchArtifactDownloadSession } from '../../../lib/server-api';
import { runtimeConfig } from '../../../lib/config';
import {
  WEB_ARTIFACT_DOWNLOAD_BYTES,
  WEB_ARTIFACT_QUERY_BYTES,
  parseArtifactDownloadSelection,
  readArtifactDownloadBytes,
  validDownloadTrace,
  type ArtifactDownloadFailure,
  type ArtifactDownloadReason,
} from '../../../lib/artifact-download';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
let activeDownloads = 0;

class DownloadError extends Error {
  constructor(
    readonly reason: ArtifactDownloadReason,
    readonly status: number,
  ) {
    super(reason);
  }
}

function sameOriginRequest(request: Request) {
  const origin = new URL(runtimeConfig.appUrl).origin;
  if (
    request.headers.get('origin') !== origin ||
    new URL(request.url).search ||
    (request.headers.has('sec-fetch-site') &&
      request.headers.get('sec-fetch-site') !== 'same-origin') ||
    request.headers.get('x-workctx-artifact-download') !== '1' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get('content-type') ?? '',
    ) ||
    [
      'range',
      'if-range',
      'if-match',
      'if-match-version',
      'if-none-match',
      'if-modified-since',
      'if-unmodified-since',
      'idempotency-key',
      'content-encoding',
    ].some((key) => request.headers.has(key))
  )
    throw new DownloadError('denied', 403);
}

async function gatewayFailure(response: Response, signal: AbortSignal): Promise<never> {
  let code: string | undefined;
  try {
    const bytes = await readArtifactDownloadBytes(response.body, WEB_ARTIFACT_QUERY_BYTES, signal);
    code = validateErrorEnvelope(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    ).code;
  } catch {
    /* Only a bounded, valid error code influences the public reason. */
  }
  if (response.status === 401) throw new DownloadError('signin', 401);
  if (response.status === 403) throw new DownloadError('denied', 403);
  if (code === 'ARTIFACT_TOO_LARGE') throw new DownloadError('too-large', 413);
  if (code === 'ARTIFACT_DOWNLOAD_BUSY' || response.status === 429)
    throw new DownloadError('busy', 503);
  if (code === 'ARTIFACT_LEGACY_UNVERIFIED') throw new DownloadError('legacy', 409);
  if (
    ['GATEWAY_RESPONSE_INVALID', 'ARTIFACT_STORED_INVALID', 'ARTIFACT_HASH_MISMATCH'].includes(
      code ?? '',
    )
  )
    throw new DownloadError('invalid', 502);
  throw new DownloadError('unavailable', response.status === 404 ? 404 : 503);
}

/** Hold local capacity until the bounded response stream is consumed, canceled or timed out. */
function transfer(content: Uint8Array, signal: AbortSignal, release: () => void) {
  let bytes: Uint8Array | undefined = content;
  let offset = 0;
  let completed = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let timer: ReturnType<typeof setTimeout>;
  const finish = () => {
    if (completed) return;
    completed = true;
    bytes = undefined;
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    release();
  };
  const abort = () => {
    if (completed) return;
    controller.error(new Error('Download transfer stopped'));
    finish();
  };
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      timer = setTimeout(abort, 60_000);
      timer.unref();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    },
    pull(value) {
      if (!bytes || completed) return;
      if (offset === bytes.byteLength) {
        value.close();
        finish();
        return;
      }
      const end = Math.min(bytes.byteLength, offset + 64 * 1024);
      if (end > offset) value.enqueue(bytes.slice(offset, end));
      offset = end;
    },
    cancel() {
      finish();
    },
  });
  return { body, dispose: abort };
}

export async function POST(request: Request): Promise<Response> {
  const requestedTrace = request.headers.get('x-trace-id') ?? '';
  const trace = validDownloadTrace(requestedTrace)
    ? requestedTrace
    : 'trace_web_download_' + randomUUID();
  const operation = new AbortController();
  const abort = () => operation.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const lease: { release?: () => void; stream?: ReturnType<typeof transfer> } = {};
  let handedOff = false;
  let attempted = false;
  let upstreamStarted = false;
  let auditId: string | undefined;
  try {
    sameOriginRequest(request);
    if (!validDownloadTrace(requestedTrace)) throw new DownloadError('invalid', 400);
    const session = await getWorkbenchArtifactDownloadSession();
    if (activeDownloads >= 2) throw new DownloadError('busy', 503);
    activeDownloads++;
    let released = false;
    lease.release = () => {
      if (!released) {
        released = true;
        activeDownloads--;
      }
    };
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    timeout = setTimeout(abort, 15_000);
    timeout.unref();
    const body = await readArtifactDownloadBytes(
      request.body,
      WEB_ARTIFACT_QUERY_BYTES,
      operation.signal,
    );
    const selected = parseArtifactDownloadSelection(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)),
    );
    if (selected.query.size > WEB_ARTIFACT_DOWNLOAD_BYTES)
      throw new DownloadError('too-large', 413);
    for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (selected.scope[key] !== session.scope[key]) throw new DownloadError('denied', 403);
    clearTimeout(timeout);
    timeout = setTimeout(abort, 150_000);
    timeout.unref();
    const base = new URL(runtimeConfig.apiUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new DownloadError('unavailable', 503);
    const gatewayBase = base.href.replace(/\/$/, '');
    const headers = {
      authorization: 'Bearer ' + session.access_token,
      'x-trace-id': trace,
      'x-tenant-id': session.scope.tenant_id,
      'x-workspace-id': session.scope.workspace_id,
      'x-project-id': session.scope.project_id,
    };
    const path =
      '/v1/artifacts/' +
      encodeURIComponent(selected.query.artifact_id) +
      '/versions/' +
      selected.query.version;
    const get = async (suffix: string, extra: Record<string, string>) => {
      try {
        return await fetch(gatewayBase + path + suffix, {
          method: 'GET',
          headers: { ...headers, ...extra },
          cache: 'no-store',
          redirect: 'error',
          signal: operation.signal,
        });
      } catch {
        throw new DownloadError('unavailable', 503);
      }
    };
    upstreamStarted = true;
    const metadataResponse = await get('', { accept: 'application/json' });
    if (!metadataResponse.ok) await gatewayFailure(metadataResponse, operation.signal);
    if (
      metadataResponse.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(metadataResponse.headers.get('content-type') ?? '')
    ) {
      void metadataResponse.body?.cancel().catch(() => {});
      throw new DownloadError('invalid', 502);
    }
    const metadataBytes = await readArtifactDownloadBytes(
      metadataResponse.body,
      2 * 1024 * 1024,
      operation.signal,
    );
    const metadata = parseArtifactReadEnvelope(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes)),
      { artifact_id: selected.query.artifact_id, version: selected.query.version },
      selected.scope,
      trace,
    );
    const artifact = parseArtifactDownloadMetadata(
      metadata.data.artifact,
      selected.query,
      selected.scope,
    );
    attempted = true;
    const response = await get('/content', {
      accept: 'application/octet-stream',
      'x-expected-artifact-sha256': selected.query.sha256,
      'x-expected-artifact-size': String(selected.query.size),
    });
    if (!response.ok) await gatewayFailure(response, operation.signal);
    try {
      if (response.status !== 200) throw new TypeError();
      auditId = parseArtifactDownloadHeaders(
        Object.fromEntries(response.headers.entries()),
        artifact,
        trace,
      ).audit_id;
    } catch {
      void response.body?.cancel().catch(() => {});
      throw new DownloadError('invalid', 502);
    }
    const content = await readArtifactDownloadBytes(
      response.body,
      selected.query.size,
      operation.signal,
      selected.query.size,
    );
    if (createHash('sha256').update(content).digest('hex') !== selected.query.sha256)
      throw new DownloadError('invalid', 502);
    if (operation.signal.aborted) throw new DownloadError('canceled', 408);
    lease.stream = transfer(content, request.signal, lease.release);
    const result = new Response(lease.stream.body, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(content.byteLength),
        'content-disposition': `attachment; filename="${artifact.artifact_id}-v${artifact.version}.bin"`,
        'cache-control': 'private, no-store, no-transform',
        'content-encoding': 'identity',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'accept-ranges': 'none',
        'x-wcp-schema-version': '1',
        'x-trace-id': trace,
        'x-tenant-id': encodeURIComponent(artifact.tenant_id),
        'x-workspace-id': encodeURIComponent(artifact.workspace_id),
        'x-project-id': encodeURIComponent(artifact.project_id),
        'x-artifact-id': artifact.artifact_id,
        'x-artifact-version': String(artifact.version),
        'x-artifact-sha256': artifact.sha256,
        'x-artifact-audit-id': auditId,
        'x-artifact-audit-stage': 'release',
      },
    });
    handedOff = true;
    return result;
  } catch (error) {
    lease.stream?.dispose();
    const known = error instanceof DownloadError ? error : undefined;
    const reason = operation.signal.aborted
      ? 'canceled'
      : error instanceof AuthRequiredError
        ? 'signin'
        : (known?.reason ?? 'invalid');
    const status = operation.signal.aborted
      ? 408
      : error instanceof AuthRequiredError
        ? 401
        : (known?.status ?? (upstreamStarted ? 502 : 400));
    const failure: ArtifactDownloadFailure = {
      schema_version: 1,
      trace_id: trace,
      error: {
        reason,
        audit_state: auditId ? 'release-recorded' : attempted ? 'unconfirmed' : 'not-requested',
        ...(auditId ? { audit_id: auditId } : {}),
      },
    };
    return Response.json(failure, {
      status,
      headers: {
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'x-trace-id': trace,
      },
    });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
    if (!handedOff) lease.release?.();
  }
}
