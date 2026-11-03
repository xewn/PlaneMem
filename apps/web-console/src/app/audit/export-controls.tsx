'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  auditExportDocument,
  auditExportDocumentJson,
  parseAuditExportRequest,
  parseAuditExportEnvelope,
  AUDIT_EXPORT_RESPONSE_BYTES,
  WORKBENCH_AUDIT_ERROR_BYTES,
  isUlid,
  type WorkbenchAuditRecord,
  type WorkbenchAuditScope,
} from '@planemem/contracts';
import { readArtifactTransferBytes } from '../../lib/artifact-transfer';

async function digest(text: string) {
  const bytes = new TextEncoder().encode(text);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function AuditRecordExport({
  scope,
  record,
}: {
  scope: WorkbenchAuditScope;
  record: WorkbenchAuditRecord;
}) {
  let documentJson: string | undefined;
  try {
    documentJson = auditExportDocumentJson(auditExportDocument(scope, record));
  } catch {
    /* Keep the read view usable when export cannot be prepared. */
  }
  return documentJson ? (
    <ExportControls key={documentJson} documentJson={documentJson} auditId={record.audit_id} />
  ) : (
    <p>This record view cannot be prepared for JSON export.</p>
  );
}

function ExportControls({ documentJson, auditId }: { documentJson: string; auditId: string }) {
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState<{ url: string; audit: string; trace: string }>();
  const [failure, setFailure] = useState<{ message: string; trace?: string; audit?: string }>();
  const [saveRequested, setSaveRequested] = useState(false);
  const generation = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const savedUrl = useRef<string | null>(null);
  const revoke = () => {
    if (savedUrl.current) URL.revokeObjectURL(savedUrl.current);
    savedUrl.current = null;
  };
  useEffect(() => {
    const clear = () => {
      generation.current++;
      operation.current?.abort();
      operation.current = null;
      revoke();
      setReady(undefined);
      setFailure(undefined);
      setPending(false);
      setReviewed(false);
      setSaveRequested(false);
    };
    clear();
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) clear();
    };
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', restore);
    return () => {
      generation.current++;
      operation.current?.abort();
      operation.current = null;
      revoke();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', restore);
    };
  }, [documentJson]);

  async function prepare() {
    if (!reviewed || operation.current || ready) return;
    if (!globalThis.crypto?.subtle || typeof crypto.randomUUID !== 'function') {
      setFailure({ message: 'Secure content verification is unavailable in this browser.' });
      return;
    }
    const currentGeneration = generation.current;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setFailure(undefined);
    setSaveRequested(false);
    const deadline = Date.now() + 90_000;
    const timer = setTimeout(() => controller.abort(), 90_000);
    const trace = 'trace_web_audit_export_' + crypto.randomUUID();
    let audit: string | undefined;
    let message = 'The export could not be confirmed. A server release audit may still exist.';
    const active = () =>
      !controller.signal.aborted &&
      currentGeneration === generation.current &&
      Date.now() < deadline;
    try {
      const document = JSON.parse(documentJson);
      const selected = parseAuditExportRequest({
        scope: document.scope,
        audit_id: document.record.audit_id,
        sha256: await digest(documentJson),
      });
      if (!active()) throw new Error();
      const response = await fetch('/audit/export', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-workctx-audit-export': '1',
          'x-trace-id': trace,
        },
        body: JSON.stringify(selected),
      });
      if (
        response.headers.get('x-trace-id') !== trace ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
          response.headers.get('content-type') ?? '',
        )
      ) {
        void response.body?.cancel().catch(() => undefined);
        throw new TypeError();
      }
      const bytes = await readArtifactTransferBytes(
        response.body,
        response.ok ? AUDIT_EXPORT_RESPONSE_BYTES : WORKBENCH_AUDIT_ERROR_BYTES,
        controller.signal,
      );
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!response.ok) {
        if (
          value?.schema_version === 1 &&
          value.trace_id === trace &&
          value.error?.client_delivery_state === 'not-confirmed'
        ) {
          const messages: Record<string, string> = {
            signin: 'Sign in again before preparing this export.',
            denied: 'Your current session cannot export this record.',
            changed: 'The record view changed. Reload and review it before exporting.',
            busy: 'Export capacity is occupied. You may try again explicitly.',
            invalid: 'The export response could not be validated.',
            unavailable: 'The export is currently unavailable.',
            canceled: 'Export preparation was canceled.',
          };
          if (typeof value.error.reason === 'string' && Object.hasOwn(messages, value.error.reason))
            message = messages[value.error.reason]!;
          if (
            value.error.audit_state === 'release-recorded' &&
            isUlid(value.error.release_audit_id)
          )
            audit = value.error.release_audit_id;
        }
        throw new Error();
      }
      if (response.status !== 200) throw new TypeError();
      const envelope = parseAuditExportEnvelope(value, selected, trace);
      audit = envelope.data.release_audit_id;
      if ((await digest(auditExportDocumentJson(envelope.data.document))) !== selected.sha256)
        throw new TypeError();
      if (!active()) throw new Error();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(envelope)], { type: 'application/json' }),
      );
      savedUrl.current = url;
      setReady({ url, audit, trace });
    } catch {
      if (currentGeneration === generation.current)
        setFailure({
          message: controller.signal.aborted
            ? 'Stopped waiting. A server release audit may still exist.'
            : message,
          trace,
          ...(audit ? { audit } : {}),
        });
    } finally {
      clearTimeout(timer);
      if (operation.current === controller) {
        operation.current = null;
        setPending(false);
        setReviewed(false);
      }
    }
  }

  return (
    <section aria-busy={pending}>
      <h3 className="detail-section-title">Export this record view</h3>
      <p>
        The JSON contains this reviewed view and its release audit reference. Fields marked as
        omitted stay omitted; this is not a full original-record export.
      </p>
      {!ready && (
        <label>
          <input
            type="checkbox"
            checked={reviewed}
            disabled={pending}
            onChange={(event) => setReviewed(event.target.checked)}
          />{' '}
          I reviewed this record and any omitted-field markers.
        </label>
      )}
      <div className="heading-actions detail-actions">
        {!ready && (
          <button
            className="primary-button"
            type="button"
            disabled={!reviewed || pending}
            onClick={() => {
              void prepare();
            }}
          >
            {pending ? 'Preparing and checking…' : 'Prepare JSON export'}
          </button>
        )}
        {pending && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => operation.current?.abort()}
          >
            Stop waiting
          </button>
        )}
        {ready && (
          <>
            <a
              className="primary-button"
              href={ready.url}
              download={`audit-${auditId}.json`}
              onClick={() => setSaveRequested(true)}
            >
              {saveRequested ? 'Request save again' : 'Save JSON'}
            </a>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                revoke();
                setReady(undefined);
                setSaveRequested(false);
              }}
            >
              Discard prepared copy
            </button>
            <Link
              className="panel-link"
              href={{ pathname: '/audit', query: { audit_id: ready.audit } }}
              target="_blank"
              rel="noreferrer"
              prefetch={false}
            >
              Open release audit
            </Link>
          </>
        )}
      </div>
      {ready && (
        <p role="status">
          {saveRequested
            ? 'Browser save requested; local completion is not confirmed.'
            : 'The reviewed content is verified and ready for a separate save request.'}{' '}
          Trace: {ready.trace}
        </p>
      )}
      {failure && (
        <p role="alert">
          {failure.message} Nothing was saved automatically.{' '}
          {failure.trace && <>Trace: {failure.trace}. </>}
          {failure.audit && (
            <Link
              href={{ pathname: '/audit', query: { audit_id: failure.audit } }}
              target="_blank"
              rel="noreferrer"
              prefetch={false}
            >
              Open confirmed release audit
            </Link>
          )}
        </p>
      )}
      <p className="muted">
        Your current session must have export permission. Each explicit preparation may create a new
        audit record. Leaving this page discards its in-memory copy.
      </p>
    </section>
  );
}
