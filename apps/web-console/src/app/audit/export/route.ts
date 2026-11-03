import { createHash, randomUUID } from 'node:crypto';
import {
  AUDIT_EXPORT_REQUEST_BYTES,
  AUDIT_EXPORT_RESPONSE_BYTES,
  WORKBENCH_AUDIT_ERROR_BYTES,
  parseAuditExportRequest,
  parseAuditExportEnvelope,
  auditExportDocumentJson,
  validateErrorEnvelope,
  isUlid,
} from '@planemem/contracts';
import {
  AuthRequiredError,
  getWorkbenchArtifactTransferSession as getTransferSession,
} from '../../../lib/server-api';
import { readArtifactTransferBytes } from '../../../lib/artifact-transfer';
import { runtimeConfig } from '../../../lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
let active = 0;
const validTrace = (value: string) =>
  /^trace_web_audit_export_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
class ExportError extends Error {
  constructor(
    readonly reason: 'signin' | 'denied' | 'invalid' | 'changed' | 'busy' | 'unavailable',
    readonly status: number,
  ) {
    super(reason);
  }
}

export async function POST(request: Request) {
  const suppliedTrace = request.headers.get('x-trace-id') ?? '';
  const trace = validTrace(suppliedTrace)
    ? suppliedTrace
    : 'trace_web_audit_export_' + randomUUID();
  const operation = new AbortController();
  const abort = () => operation.abort();
  const deadline = Date.now() + 75_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let leased = false;
  let releaseId: string | undefined;
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'x-trace-id': trace,
  };
  try {
    if (
      !validTrace(suppliedTrace) ||
      new URL(request.url).search ||
      request.headers.get('origin') !== new URL(runtimeConfig.appUrl).origin ||
      (request.headers.has('sec-fetch-site') &&
        request.headers.get('sec-fetch-site') !== 'same-origin') ||
      request.headers.get('x-workctx-audit-export') !== '1' ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      ) ||
      [
        'idempotency-key',
        'if-match',
        'if-match-version',
        'range',
        'if-range',
        'if-none-match',
        'if-modified-since',
        'if-unmodified-since',
        'content-encoding',
      ].some((name) => request.headers.has(name))
    )
      throw new ExportError('denied', 403);
    const session = await getTransferSession();
    if (active >= 2) throw new ExportError('busy', 503);
    active++;
    leased = true;
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
    const length = request.headers.get('content-length');
    if (
      length !== null &&
      (!/^(0|[1-9][0-9]{0,4})$/.test(length) || Number(length) > AUDIT_EXPORT_REQUEST_BYTES)
    )
      throw new ExportError('invalid', 400);
    let selected;
    try {
      const bytes = await readArtifactTransferBytes(
        request.body,
        AUDIT_EXPORT_REQUEST_BYTES,
        operation.signal,
        length === null ? undefined : Number(length),
      );
      selected = parseAuditExportRequest(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
    } catch {
      throw new ExportError('invalid', 400);
    }
    for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (selected.scope[key] !== session.scope[key]) throw new ExportError('denied', 403);
    const base = new URL(runtimeConfig.apiUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new ExportError('unavailable', 503);
    if (session.expires_at <= Math.floor(Date.now() / 1000)) throw new AuthRequiredError();
    if (operation.signal.aborted || Date.now() >= deadline)
      throw new ExportError('unavailable', 503);
    const response = await fetch(base.href.replace(/\/$/, '') + '/v1/audit/export', {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: operation.signal,
      headers: {
        authorization: 'Bearer ' + session.access_token,
        'content-type': 'application/json',
        'x-trace-id': trace,
        'x-tenant-id': session.scope.tenant_id,
        'x-workspace-id': session.scope.workspace_id,
        'x-project-id': session.scope.project_id,
      },
      body: JSON.stringify(selected),
    });
    if (response.status === 401) {
      void response.body?.cancel().catch(() => undefined);
      throw new AuthRequiredError();
    }
    if (
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
        response.headers.get('content-type') ?? '',
      )
    ) {
      void response.body?.cancel().catch(() => undefined);
      throw new ExportError('invalid', 502);
    }
    const body = await readArtifactTransferBytes(
      response.body,
      response.ok ? AUDIT_EXPORT_RESPONSE_BYTES : WORKBENCH_AUDIT_ERROR_BYTES,
      operation.signal,
    );
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    if (!response.ok) {
      const error = validateErrorEnvelope(value);
      if (error.trace_id !== trace) throw new ExportError('invalid', 502);
      if (
        error.details.audit_state === 'release-recorded' &&
        isUlid(error.details.release_audit_id)
      )
        releaseId = error.details.release_audit_id;
      if (response.status === 403) throw new ExportError('denied', 403);
      if (error.code === 'AUDIT_EXPORT_CONFLICT') throw new ExportError('changed', 409);
      if (error.code === 'AUDIT_EXPORT_BUSY' || response.status === 429)
        throw new ExportError('busy', 503);
      throw new ExportError('unavailable', 503);
    }
    if (response.status !== 200 || response.headers.get('x-trace-id') !== trace)
      throw new ExportError('invalid', 502);
    const envelope = parseAuditExportEnvelope(value, selected, trace);
    releaseId = envelope.data.release_audit_id;
    if (
      createHash('sha256')
        .update(auditExportDocumentJson(envelope.data.document), 'utf8')
        .digest('hex') !== selected.sha256
    )
      throw new ExportError('invalid', 502);
    if (operation.signal.aborted || Date.now() >= deadline)
      throw new ExportError('unavailable', 503);
    return new Response(JSON.stringify(envelope), { status: 200, headers });
  } catch (error) {
    const known = error instanceof ExportError ? error : undefined;
    const stopped = operation.signal.aborted || Date.now() >= deadline;
    const reason = stopped
      ? 'canceled'
      : error instanceof AuthRequiredError
        ? 'signin'
        : (known?.reason ?? 'unavailable');
    return new Response(
      JSON.stringify({
        schema_version: 1,
        trace_id: trace,
        error: {
          reason,
          audit_state: releaseId ? 'release-recorded' : 'unconfirmed',
          ...(releaseId ? { release_audit_id: releaseId } : {}),
          client_delivery_state: 'not-confirmed',
        },
      }),
      {
        status: stopped ? 408 : error instanceof AuthRequiredError ? 401 : (known?.status ?? 503),
        headers,
      },
    );
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    operation.abort();
    if (leased) active--;
  }
}
