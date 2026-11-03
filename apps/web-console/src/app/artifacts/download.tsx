'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  parseArtifactMetadataView,
  parseArtifactDownloadHeaders,
  type ArtifactMetadataView,
} from '@planemem/contracts';
import { Panel } from '../../components/ui';
import {
  WEB_ARTIFACT_DOWNLOAD_BYTES,
  WEB_ARTIFACT_QUERY_BYTES,
  artifactDownloadSelection,
  artifactDownloadErrors,
  parseArtifactDownloadFailure,
  readArtifactDownloadBytes,
  validDownloadTrace,
  type ArtifactDownloadFailure,
  type ArtifactDownloadReason,
} from '../../lib/artifact-download';

export function ArtifactDownload({ artifact }: { artifact: ArtifactMetadataView }) {
  if (artifact.size > WEB_ARTIFACT_DOWNLOAD_BYTES)
    return (
      <Panel title="Download this version" icon="database">
        <div className="side-detail artifact-details">
          <p>This version exceeds the 64 MiB browser download limit.</p>
          <p className="muted">
            Use the command-line or HTTP download with this version and an appropriate size limit.
          </p>
        </div>
      </Panel>
    );
  return <DownloadControls artifact={artifact} />;
}

function DownloadControls({ artifact }: { artifact: ArtifactMetadataView }) {
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState<{ url: string; audit: string; trace: string }>();
  const [failure, setFailure] = useState<{
    reason: ArtifactDownloadReason;
    trace?: string;
    audit?: string;
  }>();
  const [notice, setNotice] = useState('');
  const [saveRequested, setSaveRequested] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const savedUrl = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      operation.current?.abort();
      if (savedUrl.current) URL.revokeObjectURL(savedUrl.current);
      savedUrl.current = null;
      setReady(undefined);
      setSaveRequested(false);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) leave();
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', restore);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', restore);
      operation.current?.abort();
      if (savedUrl.current) URL.revokeObjectURL(savedUrl.current);
      savedUrl.current = null;
    };
  }, []);

  async function receive() {
    if (operation.current || ready) return;
    if (
      typeof globalThis.crypto?.subtle?.digest !== 'function' ||
      typeof globalThis.crypto?.randomUUID !== 'function'
    ) {
      setNotice(
        'File verification is unavailable in this browser. Use the command-line download or reopen the workbench over HTTPS.',
      );
      return;
    }
    let expected: ArtifactMetadataView;
    let selected: ReturnType<typeof artifactDownloadSelection>;
    try {
      expected = parseArtifactMetadataView(artifact);
      selected = artifactDownloadSelection(expected);
    } catch {
      setFailure({ reason: 'invalid' });
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setFailure(undefined);
    setNotice('');
    setSaveRequested(false);
    const timeout = setTimeout(() => controller.abort(), 180_000);
    let trace: string | undefined;
    let audit: string | undefined;
    let remoteFailure: ArtifactDownloadFailure | undefined;
    let reason: ArtifactDownloadReason = 'unavailable';
    try {
      const requestTrace = 'trace_web_download_' + crypto.randomUUID();
      const response = await fetch('/artifacts/download', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-workctx-artifact-download': '1',
          'x-trace-id': requestTrace,
        },
        body: JSON.stringify(selected),
      });
      const responseTrace = response.headers.get('x-trace-id') ?? '';
      if (!validDownloadTrace(responseTrace) || responseTrace !== requestTrace) {
        void response.body?.cancel().catch(() => {});
        reason = 'invalid';
        throw new TypeError();
      }
      trace = responseTrace;
      if (!response.ok) {
        const errorBytes = await readArtifactDownloadBytes(
          response.body,
          WEB_ARTIFACT_QUERY_BYTES,
          controller.signal,
        );
        remoteFailure = parseArtifactDownloadFailure(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(errorBytes)),
          trace,
        );
        throw new Error('Download failed');
      }
      reason = 'invalid';
      try {
        if (response.status !== 200) throw new TypeError();
        audit = parseArtifactDownloadHeaders(
          Object.fromEntries(response.headers.entries()),
          expected,
          trace,
        ).audit_id;
      } catch {
        void response.body?.cancel().catch(() => {});
        throw new TypeError();
      }
      const bytes = await readArtifactDownloadBytes(
        response.body,
        expected.size,
        controller.signal,
        expected.size,
      );
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer),
      );
      if (
        Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') !==
        expected.sha256
      )
        throw new TypeError();
      if (controller.signal.aborted || !mounted.current) throw new Error('Download canceled');
      const url = URL.createObjectURL(
        new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }),
      );
      savedUrl.current = url;
      setReady({ url, audit, trace });
    } catch {
      const confirmedAudit = remoteFailure?.error.audit_id ?? audit;
      if (mounted.current)
        setFailure({
          reason: controller.signal.aborted ? 'canceled' : (remoteFailure?.error.reason ?? reason),
          ...(trace ? { trace } : {}),
          ...(confirmedAudit ? { audit: confirmedAudit } : {}),
        });
    } finally {
      clearTimeout(timeout);
      if (operation.current === controller) operation.current = null;
      if (mounted.current) setPending(false);
    }
  }

  function discard() {
    if (operation.current) return;
    if (savedUrl.current) URL.revokeObjectURL(savedUrl.current);
    savedUrl.current = null;
    setReady(undefined);
    setSaveRequested(false);
    setFailure(undefined);
    setNotice('The downloaded copy has been discarded from this page.');
  }

  return (
    <Panel title={`Download version ${artifact.version}`} icon="database">
      <div className="side-detail artifact-details" aria-busy={pending}>
        <p>Fetch the version shown above, verify its contents, then choose Save file.</p>
        <p className="muted">
          Your current session must be allowed to export this file. Downloading this version does
          not change the saved record.
        </p>
        <div className="artifact-download-actions">
          {!ready && (
            <button
              className="primary-button"
              type="button"
              disabled={pending}
              onClick={() => {
                void receive();
              }}
            >
              {pending
                ? 'Fetching and checking…'
                : failure
                  ? 'Fetch this version again'
                  : 'Fetch this version'}
            </button>
          )}
          {pending && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => operation.current?.abort()}
            >
              Cancel download
            </button>
          )}
          {ready && (
            <>
              <a
                className="primary-button"
                href={ready.url}
                download={`${artifact.artifact_id}-v${artifact.version}.bin`}
                onClick={() => setSaveRequested(true)}
              >
                {saveRequested ? 'Save file again' : 'Save file'}
              </a>
              <button className="secondary-button" type="button" onClick={discard}>
                Discard downloaded copy
              </button>
            </>
          )}
        </div>
        <div role="status" aria-live="polite">
          {notice && <p>{notice}</p>}
          {ready && (
            <p>
              {saveRequested
                ? 'Save requested. Check your browser downloads to confirm where the file was saved.'
                : 'File contents verified and ready. Choose Save file to ask your browser to save this copy.'}
            </p>
          )}
        </div>
        {failure && (
          <div role="alert">
            <p>{artifactDownloadErrors[failure.reason]}</p>
            {failure.reason === 'signin' && (
              <Link href="/login" prefetch={false}>
                Sign in
              </Link>
            )}
            <p className="muted">
              No file is ready for saving. This page will not request another download
              automatically.
            </p>
          </div>
        )}
        {ready && (
          <p className="muted">
            This copy stays in this page until you discard it or leave. The browser does not report
            completed local saving to this page.
          </p>
        )}
        {(ready || failure?.trace) && (
          <details>
            <summary>Download record</summary>
            <p className="muted">
              A server release record confirms authorization to send the file; it does not confirm
              local saving.
            </p>
            {(ready?.audit ?? failure?.audit) ? (
              <p>
                Release record: <code>{ready?.audit ?? failure?.audit}</code>
              </p>
            ) : (
              <p>
                No release record was confirmed by this page. This does not prove that the server
                did not process the request.
              </p>
            )}
            <p>
              Request reference: <code>{ready?.trace ?? failure?.trace}</code>
            </p>
          </details>
        )}
      </div>
    </Panel>
  );
}
