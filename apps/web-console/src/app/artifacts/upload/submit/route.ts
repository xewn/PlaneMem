import { createHash, randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import { buildEtag, parseArtifactUploadEnvelope, validateErrorEnvelope } from '@planemem/contracts';
import { AuthRequiredError, getWorkbenchArtifactTransferSession } from '../../../../lib/server-api';
import { runtimeConfig } from '../../../../lib/config';
import {
  ArtifactTransferLimitError,
  readArtifactTransferBytes,
} from '../../../../lib/artifact-transfer';
import {
  WEB_ARTIFACT_UPLOAD_BYTES,
  WEB_ARTIFACT_UPLOAD_RESPONSE_BYTES,
  WEB_ARTIFACT_UPLOAD_ERROR_BYTES,
  validUploadTrace,
  type ArtifactUploadReason,
  type WebArtifactUploadFailure,
} from '../../../../lib/artifact-upload';
import {
  ARTIFACT_REQUEST_BYTES,
  decodeArtifactRequest,
  encodeArtifactRequest,
} from '../../receipt/model';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY = WEB_ARTIFACT_UPLOAD_BYTES + ARTIFACT_REQUEST_BYTES + 64 * 1024;
let activeUploads = 0;

class UploadError extends Error {
  constructor(
    readonly reason: ArtifactUploadReason,
    readonly status: number,
  ) {
    super(reason);
  }
}

function incomingHeaders(request: Request): number | undefined {
  if (
    request.headers.get('origin') !== new URL(runtimeConfig.appUrl).origin ||
    new URL(request.url).search ||
    (request.headers.has('sec-fetch-site') &&
      request.headers.get('sec-fetch-site') !== 'same-origin') ||
    request.headers.get('x-workctx-artifact-upload') !== '1' ||
    !/^multipart\/form-data\s*;/i.test(request.headers.get('content-type') ?? '') ||
    [
      'content-encoding',
      'range',
      'if-range',
      'if-match',
      'if-match-version',
      'if-none-match',
      'if-modified-since',
      'if-unmodified-since',
      'idempotency-key',
    ].some((key) => request.headers.has(key))
  )
    throw new UploadError('denied', 403);
  const raw = request.headers.get('content-length');
  if (raw === null) return;
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new UploadError('invalid', 400);
  if (Number(raw) > MAX_BODY) throw new UploadError('too-large', 413);
  return Number(raw);
}

async function gatewayFailure(response: Response, signal: AbortSignal): Promise<never> {
  let code: string | undefined;
  try {
    const bytes = await readArtifactTransferBytes(
      response.body,
      WEB_ARTIFACT_UPLOAD_ERROR_BYTES,
      signal,
    );
    code = validateErrorEnvelope(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    ).code;
  } catch {
    /* Only a bounded valid code affects the public error. */
  }
  if (response.status === 401) throw new UploadError('signin', 401);
  if (response.status === 403) throw new UploadError('denied', 403);
  if (code === 'IDEMPOTENCY_KEY_REUSED') throw new UploadError('mismatch', 409);
  if (code === 'ARTIFACT_TOO_LARGE' || response.status === 413)
    throw new UploadError('too-large', 413);
  if (code === 'ARTIFACT_UPLOAD_BUSY' || response.status === 429)
    throw new UploadError('busy', 503);
  if (response.status === 409 || response.status === 412) throw new UploadError('conflict', 409);
  if (
    ['GATEWAY_RESPONSE_INVALID', 'ARTIFACT_STORED_INVALID', 'ARTIFACT_HASH_MISMATCH'].includes(
      code ?? '',
    )
  )
    throw new UploadError('invalid', 502);
  throw new UploadError('unavailable', 503);
}

export async function POST(request: Request): Promise<Response> {
  const requestedTrace = request.headers.get('x-trace-id') ?? '';
  const trace = validUploadTrace(requestedTrace)
    ? requestedTrace
    : 'trace_web_upload_' + randomUUID();
  const operation = new AbortController();
  const abort = () => operation.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let reserved = false;
  let dispatched = false;
  const responseHeaders = {
    'cache-control': 'private, no-store, no-transform',
    'x-content-type-options': 'nosniff',
    'x-trace-id': trace,
  };
  try {
    const declared = incomingHeaders(request);
    if (!validUploadTrace(requestedTrace)) throw new UploadError('invalid', 400);
    const session = await getWorkbenchArtifactTransferSession();
    if (activeUploads >= 2) throw new UploadError('busy', 503);
    activeUploads++;
    reserved = true;
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    timeout = setTimeout(abort, 120_000);
    timeout.unref();
    let body: Uint8Array;
    try {
      body = await readArtifactTransferBytes(request.body, MAX_BODY, operation.signal);
    } catch (error) {
      if (error instanceof ArtifactTransferLimitError) throw new UploadError('too-large', 413);
      throw error;
    }
    if (declared !== undefined && body.byteLength !== declared)
      throw new UploadError('invalid', 400);
    const form = await new Response(new Blob([body.buffer as ArrayBuffer]), {
      headers: { 'content-type': request.headers.get('content-type')! },
    }).formData();
    if (
      Array.from(form.keys()).length !== 2 ||
      form.getAll('request').length !== 1 ||
      form.getAll('content').length !== 1
    )
      throw new UploadError('invalid', 400);
    const originalPart = form.get('request');
    const file = form.get('content');
    if (
      !originalPart ||
      typeof originalPart === 'string' ||
      originalPart.type !== 'application/json' ||
      !file ||
      typeof file === 'string'
    )
      throw new UploadError('invalid', 400);
    if (originalPart.size > ARTIFACT_REQUEST_BYTES || file.size > WEB_ARTIFACT_UPLOAD_BYTES)
      throw new UploadError('too-large', 413);
    const original = decodeArtifactRequest(
      new TextDecoder('utf-8', { fatal: true }).decode(await originalPart.arrayBuffer()),
    );
    for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (original.identity[key] !== session.scope[key]) throw new UploadError('denied', 403);
    if (original.command.size !== file.size) throw new UploadError('invalid', 400);
    const content = new Uint8Array(await file.arrayBuffer());
    if (createHash('sha256').update(content).digest('hex') !== original.command.sha256)
      throw new UploadError('invalid', 400);
    if (operation.signal.aborted) throw new UploadError('canceled', 408);
    if (session.expires_at <= Math.floor(Date.now() / 1000)) throw new AuthRequiredError();
    const base = new URL(runtimeConfig.apiUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new UploadError('unavailable', 503);
    const headers: Record<string, string> = {
      authorization: 'Bearer ' + session.access_token,
      accept: 'application/json',
      'x-trace-id': trace,
      'x-tenant-id': session.scope.tenant_id,
      'x-workspace-id': session.scope.workspace_id,
      'x-project-id': session.scope.project_id,
      'idempotency-key': original.command.request_key,
    };
    const path =
      original.command.operation === 'artifact.create'
        ? '/v1/artifacts'
        : '/v1/artifacts/' + encodeURIComponent(original.command.artifact_id) + '/versions';
    if (original.command.operation === 'artifact.put-version')
      headers['if-match'] = buildEtag(original.command.expected_version);
    const outbound = new FormData();
    outbound.set(
      'request',
      new Blob([encodeArtifactRequest(original)], { type: 'application/json' }),
      'request.json',
    );
    outbound.set(
      'content',
      new Blob([content.buffer as ArrayBuffer], { type: 'application/octet-stream' }),
      'content.bin',
    );
    clearTimeout(timeout);
    timeout = setTimeout(abort, 150_000);
    timeout.unref();
    // From this point every failure is uncertain, even if the client stops waiting.
    dispatched = true;
    let upstream: Response;
    try {
      upstream = await fetch(base.href.replace(/\/$/, '') + path, {
        method: 'POST',
        headers,
        body: outbound,
        cache: 'no-store',
        redirect: 'error',
        signal: operation.signal,
      });
    } catch {
      throw new UploadError('unavailable', 503);
    }
    if (!upstream.ok) await gatewayFailure(upstream, operation.signal);
    if (
      upstream.status !== 200 ||
      !/^application\/json(?:\s*;|$)/i.test(upstream.headers.get('content-type') ?? '') ||
      upstream.headers.get('x-trace-id') !== trace
    ) {
      void upstream.body?.cancel().catch(() => {});
      throw new UploadError('invalid', 502);
    }
    const bytes = await readArtifactTransferBytes(
      upstream.body,
      WEB_ARTIFACT_UPLOAD_RESPONSE_BYTES,
      operation.signal,
    );
    const saved = parseArtifactUploadEnvelope(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      original,
      trace,
    );
    if (operation.signal.aborted) throw new UploadError('canceled', 408);
    return Response.json(saved, { status: 200, headers: responseHeaders });
  } catch (error) {
    const known = error instanceof UploadError ? error : undefined;
    const reason = operation.signal.aborted
      ? 'canceled'
      : error instanceof AuthRequiredError
        ? 'signin'
        : (known?.reason ?? 'invalid');
    const status = operation.signal.aborted
      ? 408
      : error instanceof AuthRequiredError
        ? 401
        : (known?.status ?? (dispatched ? 502 : 400));
    const failure: WebArtifactUploadFailure = {
      schema_version: 1,
      trace_id: trace,
      error: { reason, dispatch_state: dispatched ? 'unconfirmed' : 'not-sent' },
    };
    return Response.json(failure, { status, headers: responseHeaders });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
    if (reserved) activeUploads--;
    // Stop any unread input after a preflight rejection; no waiting on its producer.
    if (!request.bodyUsed) void request.body?.cancel().catch(() => {});
  }
}
