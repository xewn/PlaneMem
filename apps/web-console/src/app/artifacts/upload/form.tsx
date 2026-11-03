'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  parseArtifactUploadEnvelope,
  type ArtifactReceiptQuery,
  type ArtifactUploadEnvelope,
} from '@planemem/contracts';
import { Badge, Panel } from '../../../components/ui';
import { readArtifactTransferBytes } from '../../../lib/artifact-transfer';
import {
  WEB_ARTIFACT_UPLOAD_BYTES,
  WEB_ARTIFACT_UPLOAD_RESPONSE_BYTES,
  WEB_ARTIFACT_UPLOAD_ERROR_BYTES,
  artifactUploadErrors,
  parseWebArtifactUploadFailure,
  type ArtifactUploadReason,
  type WebArtifactUploadFailure,
} from '../../../lib/artifact-upload';
import { checkArtifactReceipt } from '../receipt/actions';
import { OriginalRequest, ReceiptFeedback } from '../receipt/form';
import {
  ARTIFACT_REQUEST_BYTES,
  decodeArtifactRequest,
  encodeArtifactRequest,
  parseArtifactReceiptFeedback,
  type ArtifactReceiptFeedback,
} from '../receipt/model';
import { artifactPageHref } from '../query';
import { ArtifactRequestPreparation, type PreparedArtifactContent } from './preparation';
import type { ArtifactUploadPreparation } from './preparation-model';

type Failure = { reason: ArtifactUploadReason; state: 'not-sent' | 'unconfirmed'; trace?: string };
type Phase = 'importing' | 'verifying' | 'uploading' | 'receipt';

export function ArtifactUploadForm({ preparation }: { preparation?: ArtifactUploadPreparation }) {
  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState<ArtifactReceiptQuery>();
  const [ready, setReady] = useState<{ blob: Blob; name: string }>();
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState<ArtifactUploadEnvelope>();
  const [receipt, setReceipt] = useState<ArtifactReceiptFeedback>();
  const [failure, setFailure] = useState<Failure>();
  const [phase, setPhase] = useState<Phase>();
  const [notice, setNotice] = useState('');
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const requestUrls = useRef(new Set<string>());
  const recorded = Boolean(
    saved || (receipt?.status === 'checked' && receipt.response.data.status === 'recorded'),
  );
  const busy = phase !== undefined;

  useEffect(() => {
    mounted.current = true;
    const release = () => {
      operation.current?.abort();
      for (const url of requestUrls.current) URL.revokeObjectURL(url);
      requestUrls.current.clear();
    };
    const leave = () => {
      release();
      setReady(undefined);
      setConfirmed(false);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) leave();
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', restore);
    return () => {
      mounted.current = false;
      release();
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', restore);
    };
  }, []);

  function begin(next: Phase): AbortController | undefined {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPhase(next);
    setNotice('');
    return controller;
  }
  function current(controller: AbortController) {
    return mounted.current && operation.current === controller;
  }
  function end(controller: AbortController) {
    if (current(controller)) setPhase(undefined);
    if (operation.current === controller) operation.current = null;
  }
  function accept(raw: string) {
    const value = decodeArtifactRequest(raw);
    setOriginal(value);
    setDraft('');
    setConfirmed(false);
    setNotice('Original request loaded. Review it, then select the exact file described below.');
  }
  function acceptPrepared(request: ArtifactReceiptQuery, content: PreparedArtifactContent) {
    if (operation.current || original) return;
    const fixed = decodeArtifactRequest(encodeArtifactRequest(request));
    if (content.blob.size !== fixed.command.size || content.blob.size > WEB_ARTIFACT_UPLOAD_BYTES)
      throw new TypeError('Prepared file differs from the request.');
    setOriginal(fixed);
    setReady({ blob: content.blob, name: content.name });
    setConfirmed(false);
    setNotice(
      'New original request prepared. Save its JSON and keep the file before explicitly submitting. Nothing has been uploaded.',
    );
  }
  function reviewText() {
    if (operation.current || original) return;
    try {
      accept(draft);
    } catch {
      setNotice(
        'Use the complete original identity and command in UTF-8 JSON, no larger than 1 MB.',
      );
    }
  }
  async function importRequest(file: File | undefined) {
    if (!file || original) return;
    const controller = begin('importing');
    if (!controller) return;
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      if (file.size > ARTIFACT_REQUEST_BYTES) throw new TypeError();
      const bytes = await readArtifactTransferBytes(
        file.stream(),
        ARTIFACT_REQUEST_BYTES,
        controller.signal,
        file.size,
      );
      if (!current(controller) || controller.signal.aborted) return;
      accept(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      if (current(controller))
        setNotice(
          'The request could not be loaded. Keep its original JSON; use a UTF-8 file no larger than 1 MB.',
        );
    } finally {
      clearTimeout(timer);
      end(controller);
    }
  }
  async function selectContent(file: File | undefined) {
    if (!file || !original || attempted || recorded) return;
    const controller = begin('verifying');
    if (!controller) return;
    const request = original;
    setReady(undefined);
    setConfirmed(false);
    setFailure(undefined);
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      if (typeof globalThis.crypto?.subtle?.digest !== 'function')
        throw new Error('Verification unavailable');
      if (file.size > WEB_ARTIFACT_UPLOAD_BYTES || file.size !== request.command.size)
        throw new TypeError();
      const bytes = await readArtifactTransferBytes(
        file.stream(),
        WEB_ARTIFACT_UPLOAD_BYTES,
        controller.signal,
        file.size,
      );
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer),
      );
      const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== request.command.sha256) throw new TypeError();
      if (!current(controller) || controller.signal.aborted) throw new Error('Stopped');
      setReady({
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }),
        name: file.name,
      });
      setNotice(
        'File size and content hash match the original request. Nothing has been submitted.',
      );
    } catch {
      if (current(controller))
        setNotice(
          controller.signal.aborted
            ? 'File verification stopped. Select the same file to verify it again.'
            : 'The file could not be verified. It must match the saved size and hash, be at most 64 MiB, and this browser must support secure file verification.',
        );
    } finally {
      clearTimeout(timer);
      end(controller);
    }
  }
  function saveRequest() {
    if (!original || operation.current) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([encodeArtifactRequest(original)], { type: 'application/json' }),
      );
      requestUrls.current.add(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'artifact-original-request.json';
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setNotice('Request JSON prepared for download. Keep it with the original file.');
    } catch {
      setNotice('Copy the original request JSON from the details below.');
    } finally {
      if (url) {
        const retained = url;
        setTimeout(() => {
          URL.revokeObjectURL(retained);
          requestUrls.current.delete(retained);
        }, 1000);
      }
    }
  }
  async function lookup() {
    if (!original || recorded) return;
    const controller = begin('receipt');
    if (!controller) return;
    const request = original;
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const form = new FormData();
      form.set('request', encodeArtifactRequest(request));
      const value = await waitFor(checkArtifactReceipt(form), controller.signal);
      const result = parseArtifactReceiptFeedback(value, request);
      if (!current(controller) || controller.signal.aborted) return;
      setReceipt(result);
      if (result.status === 'checked' && result.response.data.status === 'recorded') {
        setReady(undefined);
        setConfirmed(false);
        setAttempted(true);
        setFailure(undefined);
      }
    } catch {
      if (current(controller)) setReceipt({ status: 'error', request, reason: 'unavailable' });
    } finally {
      clearTimeout(timer);
      end(controller);
    }
  }
  async function submit() {
    if (!original || !ready || !confirmed || attempted || recorded) return;
    const controller = begin('uploading');
    if (!controller) return;
    const request = original;
    const file = ready.blob;
    setFailure(undefined);
    setReceipt(undefined);
    setConfirmed(false);
    let dispatched = false;
    let remote: WebArtifactUploadFailure | undefined;
    let trace: string | undefined;
    let reason: ArtifactUploadReason = 'unavailable';
    const timer = setTimeout(() => controller.abort(), 300_000);
    try {
      if (typeof globalThis.crypto?.randomUUID !== 'function') {
        reason = 'invalid';
        throw new TypeError();
      }
      const outbound = new FormData();
      outbound.set(
        'request',
        new Blob([encodeArtifactRequest(request)], { type: 'application/json' }),
        'request.json',
      );
      outbound.set('content', file, 'content.bin');
      trace = 'trace_web_upload_' + crypto.randomUUID();
      if (controller.signal.aborted) throw new Error('Stopped');
      dispatched = true;
      setAttempted(true);
      const response = await fetch('/artifacts/upload/submit', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'x-workctx-artifact-upload': '1', 'x-trace-id': trace },
        body: outbound,
      });
      if (
        response.headers.get('x-trace-id') !== trace ||
        !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
      ) {
        void response.body?.cancel().catch(() => {});
        reason = 'invalid';
        throw new TypeError();
      }
      const bytes = await readArtifactTransferBytes(
        response.body,
        response.ok ? WEB_ARTIFACT_UPLOAD_RESPONSE_BYTES : WEB_ARTIFACT_UPLOAD_ERROR_BYTES,
        controller.signal,
      );
      reason = 'invalid';
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!response.ok) {
        remote = parseWebArtifactUploadFailure(value, trace);
        throw new Error('Upload not confirmed');
      }
      if (response.status !== 200) throw new TypeError();
      const result = parseArtifactUploadEnvelope(value, request, trace);
      if (!current(controller) || controller.signal.aborted) throw new Error('Stopped');
      setSaved(result);
      setNotice('The original write is recorded. Review its saved version below.');
    } catch {
      if (current(controller)) {
        const state = remote?.error.dispatch_state ?? (dispatched ? 'unconfirmed' : 'not-sent');
        setFailure({
          reason: remote?.error.reason ?? (controller.signal.aborted ? 'canceled' : reason),
          state,
          ...(trace ? { trace } : {}),
        });
        if (state === 'not-sent') setAttempted(false);
      }
    } finally {
      clearTimeout(timer);
      if (current(controller)) setReady(undefined);
      end(controller);
    }
  }

  return (
    <div className="artifact-receipt" aria-busy={busy}>
      <Panel
        title={
          original
            ? 'Review the original request'
            : preparation
              ? 'Prepare a new request'
              : 'Load a saved request'
        }
        icon="audit"
      >
        <div className="side-detail artifact-details">
          <p>
            {preparation && !original
              ? 'Choose content and review its details to prepare a new request. You will save and submit it in a separate step.'
              : 'Keep the original request JSON and exact file to recover an uncertain creation or version upload.'}
          </p>
          <p className="muted">
            Use the same account, client and project recorded in the request. The request stays on
            this page; it is not saved in browser storage.
          </p>
          {!original ? (
            preparation ? (
              <ArtifactRequestPreparation preparation={preparation} onPrepare={acceptPrepared} />
            ) : (
              <form
                className="handoff-form checkpoint-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  reviewText();
                }}
              >
                <label htmlFor="artifact-upload-request-file">
                  Import original request JSON (up to 1 MB)
                </label>
                <input
                  id="artifact-upload-request-file"
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    void importRequest(file);
                  }}
                />
                <label htmlFor="artifact-upload-request-text">Or paste the original JSON</label>
                <textarea
                  id="artifact-upload-request-text"
                  rows={8}
                  value={draft}
                  maxLength={ARTIFACT_REQUEST_BYTES}
                  spellCheck={false}
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <p className="muted">
                  Include the complete identity and command, with the original request key, size and
                  content hash.
                </p>
                <button className="primary-button" type="submit" disabled={busy || !draft}>
                  Review original request
                </button>
              </form>
            )
          ) : (
            <>
              <OriginalRequest request={original} />
              <div className="artifact-download-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={saveRequest}
                >
                  Save request JSON
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy || recorded}
                  onClick={() => void lookup()}
                >
                  Check original receipt
                </button>
                <Link
                  className="panel-link"
                  href="/artifacts/upload"
                  prefetch={false}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open another upload in a new tab ↗
                </Link>
              </div>
              <details className="handoff-form checkpoint-form">
                <summary>Original request JSON and sources</summary>
                <label htmlFor="artifact-upload-original">
                  Copy and keep this unchanged request
                </label>
                <textarea
                  id="artifact-upload-original"
                  rows={9}
                  readOnly
                  value={encodeArtifactRequest(original)}
                  spellCheck={false}
                />
              </details>
            </>
          )}
          {notice && <p role="status">{notice}</p>}
          {busy && (
            <div className="artifact-download-actions" role="status">
              <span>
                {
                  {
                    importing: 'Reading request…',
                    verifying: 'Verifying file…',
                    uploading: 'Waiting for the original upload result…',
                    receipt: 'Checking original receipt…',
                  }[phase!]
                }
              </span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => operation.current?.abort()}
              >
                Stop waiting
              </button>
            </div>
          )}
        </div>
      </Panel>
      {original && !recorded && (
        <Panel title="Select and submit the matching file" icon="database">
          <div className="side-detail artifact-details">
            {original.command.size > WEB_ARTIFACT_UPLOAD_BYTES ? (
              <p>
                This request exceeds the 64 MiB browser upload limit. Use the original request with
                an appropriate upload client.
              </p>
            ) : attempted ? (
              <p>
                An upload was sent and its result is unconfirmed. Check the original receipt above.
                No further upload is sent from this page; a missing receipt does not prove failure.
              </p>
            ) : (
              <>
                <div className="handoff-form checkpoint-form">
                  <label htmlFor="artifact-upload-content">
                    Choose the original file (up to 64 MiB)
                  </label>
                  <input
                    id="artifact-upload-content"
                    type="file"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      void selectContent(file);
                    }}
                  />
                </div>
                <p className="muted">
                  Selecting a file checks its contents locally. The saved request determines its
                  recorded name and version.
                </p>
                {ready && (
                  <>
                    <p>
                      <Badge tone="green">Size and hash match</Badge> {ready.name}
                    </p>
                    <label className="context-archive-confirm">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={busy}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      I have kept the original JSON and file, reviewed this request, and want to
                      submit it.
                    </label>
                    <div className="artifact-download-actions">
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busy || !confirmed}
                        onClick={() => void submit()}
                      >
                        {original.command.operation === 'artifact.create'
                          ? 'Submit file creation'
                          : 'Submit this file version'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => {
                          setReady(undefined);
                          setConfirmed(false);
                        }}
                      >
                        Release selected file
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            <p className="muted">
              Stopping or closing the page does not undo a request already sent. The original key
              and version are never replaced automatically.
            </p>
          </div>
        </Panel>
      )}
      {failure && !recorded && (
        <Panel title="Upload not confirmed" icon="audit">
          <div className="side-detail artifact-details" role="alert">
            <p>{artifactUploadErrors[failure.reason]}</p>
            <p>
              {failure.state === 'not-sent'
                ? 'This attempt was not forwarded to file storage. This says nothing about earlier attempts with the same request.'
                : 'The original request may already have been saved. Check its receipt before taking further action.'}
            </p>
            {failure.trace && (
              <p>
                Request trace: <code>{failure.trace}</code>
              </p>
            )}
            {failure.reason === 'signin' && (
              <Link
                className="panel-link"
                href="/login"
                prefetch={false}
                target="_blank"
                rel="noreferrer"
              >
                Sign in in a new tab ↗
              </Link>
            )}
          </div>
        </Panel>
      )}
      {saved && (
        <Panel title="Original write recorded" icon="database">
          <div className="side-detail artifact-details" role="status">
            <Badge tone="green">Version {saved.data.artifact.version} recorded</Badge>
            <p>{saved.data.artifact.name}</p>
            <p>
              {saved.data.replayed
                ? 'The original saved result was returned. File contents were not checked again by storage.'
                : 'File contents were verified when this version was saved.'}{' '}
              This does not confirm current download availability.
            </p>
            <p>
              Request trace: <code>{saved.trace_id}</code>
            </p>
            <Link
              className="panel-link"
              href={artifactPageHref(saved.data.artifact.artifact_id, saved.data.artifact.version)}
              prefetch={false}
              target="_blank"
              rel="noreferrer"
            >
              Open saved version in a new tab ↗
            </Link>
          </div>
        </Panel>
      )}
      {receipt && <ReceiptFeedback feedback={receipt} />}
    </div>
  );
}

/** Stop waiting locally; a server action already sent may still finish. */
function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Stopped waiting'));
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
