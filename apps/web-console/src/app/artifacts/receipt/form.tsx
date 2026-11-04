'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import type { ArtifactReceiptQuery } from '@planemem/contracts';
import { Badge, Panel } from '../../../components/ui';
import { artifactPageHref } from '../query';
import { checkArtifactReceipt } from './actions';
import { ArtifactReceiptFileActions } from './file-actions';
import {
  ARTIFACT_REQUEST_BYTES,
  decodeArtifactRequest,
  encodeArtifactRequest,
  parseArtifactReceiptFeedback,
  receiptErrorMessages,
  type ArtifactReceiptFeedback,
} from './model';

export function ArtifactReceiptForm() {
  const [draft, setDraft] = useState('');
  const [request, setRequest] = useState<ArtifactReceiptQuery>();
  const [feedback, setFeedback] = useState<ArtifactReceiptFeedback>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const active = useRef(false);
  const recorded = feedback?.status === 'checked' && feedback.response.data.status === 'recorded';

  function accept(raw: string) {
    const original = decodeArtifactRequest(raw);
    setRequest(original);
    setDraft('');
    setMessage('Original request loaded. Review the details below, then check its receipt.');
  }

  function reviewText() {
    if (active.current || request) return;
    try {
      accept(draft);
    } catch {
      setMessage(
        'Use the saved JSON containing only identity and command, no larger than 1 MB. Every original field is required.',
      );
    }
  }

  async function importFile(file: File | undefined) {
    if (active.current || request || !file) return;
    if (file.size > ARTIFACT_REQUEST_BYTES) {
      setMessage('This file exceeds the 1 MB request limit for this page. Keep the original JSON.');
      return;
    }
    active.current = true;
    setBusy(true);
    try {
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      accept(raw);
    } catch {
      setMessage(
        'The file could not be imported. Use UTF-8 JSON containing the saved identity and complete original command.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  async function lookup() {
    if (active.current || !request || recorded) return;
    const original = request;
    active.current = true;
    setBusy(true);
    setMessage('');
    try {
      const data = new FormData();
      data.set('request', encodeArtifactRequest(original));
      const returned = await checkArtifactReceipt(data);
      try {
        setFeedback(parseArtifactReceiptFeedback(returned, original));
      } catch {
        setFeedback({ status: 'error', request: original, reason: 'invalid' });
      }
    } catch {
      setFeedback({ status: 'error', request: original, reason: 'unavailable' });
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  function saveRequest() {
    if (active.current || !request) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([encodeArtifactRequest(request)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'artifact-original-request.json';
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setMessage(
        'Request JSON prepared for download. Keep it to check the same request after reloading or closing this page.',
      );
    } catch {
      setShowJson(true);
      setMessage('The download could not be prepared. Copy the original request JSON shown below.');
    } finally {
      if (url) {
        const savedUrl = url;
        setTimeout(() => URL.revokeObjectURL(savedUrl), 1000);
      }
    }
  }

  return (
    <div className="artifact-receipt" aria-busy={busy}>
      <Panel title={request ? 'Original request' : 'Load a saved request'} icon="audit">
        <div className="side-detail artifact-details">
          <p>
            Use the original request JSON saved when the file was created or a version was added.
            Importing prepares this lookup; use Check original receipt to send it.
          </p>
          <p className="muted">
            Keep your saved JSON for reloads or closing this page. This page does not store it in
            browser storage. Sign in with the same account, client and project used by the original
            request.
          </p>
          {!request ? (
            <form
              className="handoff-form checkpoint-form"
              onSubmit={(event) => {
                event.preventDefault();
                reviewText();
              }}
            >
              <label htmlFor="artifact-receipt-file">Import request JSON (up to 1 MB)</label>
              <input
                id="artifact-receipt-file"
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  void importFile(file);
                }}
              />
              <label htmlFor="artifact-receipt-json">Or paste the saved JSON</label>
              <textarea
                id="artifact-receipt-json"
                rows={9}
                value={draft}
                maxLength={ARTIFACT_REQUEST_BYTES}
                disabled={busy}
                spellCheck={false}
                aria-describedby="artifact-receipt-format"
                onChange={(event) => setDraft(event.target.value)}
              />
              <p id="artifact-receipt-format" className="muted">
                The JSON must contain identity and command, including the original request_key,
                content hash and size. Keep the original parameters unchanged.
              </p>
              <div className="heading-actions">
                <button className="primary-button" type="submit" disabled={busy || !draft}>
                  Review saved request
                </button>
              </div>
            </form>
          ) : (
            <>
              <OriginalRequest request={request} />
              <div className="heading-actions artifact-receipt-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy || recorded}
                  onClick={() => void lookup()}
                >
                  {busy
                    ? 'Checking receipt…'
                    : recorded
                      ? 'Original write recorded'
                      : 'Check original receipt'}
                </button>
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
                  disabled={busy}
                  aria-expanded={showJson}
                  aria-controls="artifact-original-json"
                  onClick={() => setShowJson(!showJson)}
                >
                  {showJson ? 'Hide request JSON' : 'Show request JSON'}
                </button>
                <Link
                  className="panel-link"
                  href="/artifacts/receipt"
                  prefetch={false}
                  target="_blank"
                  rel="noreferrer"
                >
                  Check another request in a new tab ↗
                </Link>
              </div>
              <div
                id="artifact-original-json"
                hidden={!showJson}
                className="handoff-form checkpoint-form"
              >
                <label htmlFor="artifact-original-text">Original request JSON to copy</label>
                <textarea
                  id="artifact-original-text"
                  rows={8}
                  readOnly
                  value={showJson ? encodeArtifactRequest(request) : ''}
                  spellCheck={false}
                />
              </div>
            </>
          )}
          {message && <p role="status">{message}</p>}
          {busy && (
            <p role="status">
              {request ? 'Reading the original receipt…' : 'Reading the selected request file…'}
            </p>
          )}
        </div>
      </Panel>
      {feedback && <ReceiptFeedback feedback={feedback} />}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function OriginalRequest({ request }: { request: ArtifactReceiptQuery }) {
  const { identity, command } = request;
  return (
    <dl className="detail-grid checkpoint-detail-meta">
      <Detail label="Original operation">
        {command.operation === 'artifact.create' ? 'Create a file' : 'Add a file version'}
      </Detail>
      <Detail label="Original request key">
        <code>{command.request_key}</code>
      </Detail>
      <Detail label="Original account">{identity.actor_id}</Detail>
      <Detail label="Original client">{identity.client_id}</Detail>
      <Detail label="Tenant">{identity.tenant_id}</Detail>
      <Detail label="Workspace">{identity.workspace_id}</Detail>
      <Detail label="Project">{identity.project_id}</Detail>
      <Detail label="Original size">{command.size.toLocaleString('en-US')} bytes</Detail>
      <Detail label="Original SHA-256">
        <code>{command.sha256}</code>
      </Detail>
      {command.operation === 'artifact.create' ? (
        <>
          <Detail label="Original file name">{command.name}</Detail>
          <Detail label="File type">{command.mime}</Detail>
          <Detail label="Classification">{command.classification}</Detail>
          <Detail label="Recorded source count">{command.source_refs.length}</Detail>
        </>
      ) : (
        <>
          <Detail label="File ID">{command.artifact_id}</Detail>
          <Detail label="Original expected version">{command.expected_version}</Detail>
        </>
      )}
    </dl>
  );
}

export function ReceiptFeedback({ feedback }: { feedback: ArtifactReceiptFeedback }) {
  if (feedback.status === 'error')
    return (
      <Panel title="Receipt not confirmed" icon="audit">
        <div className="side-detail artifact-details" role="alert">
          <p>{receiptErrorMessages[feedback.reason]}</p>
          {feedback.trace && (
            <p>
              Read trace: <code>{feedback.trace}</code>
            </p>
          )}
          {feedback.reason === 'signin' && (
            <Link
              href="/login"
              target="_blank"
              rel="noreferrer"
              prefetch={false}
              className="panel-link"
            >
              Sign in in a new tab ↗
            </Link>
          )}
          <p className="muted">
            The original request remains above for another explicit check or export.
          </p>
        </div>
      </Panel>
    );
  const { data, trace_id } = feedback.response;
  if (data.status === 'not-observed')
    return (
      <Panel title="Outcome still unknown" icon="audit">
        <div className="side-detail artifact-details" role="status">
          <Badge tone="yellow">No matching receipt observed</Badge>
          <p>
            The request may still be committing or may predate saved receipts. Keep the original
            request and check again later. A current file record does not confirm this request.
          </p>
          <p>
            Read trace: <code>{trace_id}</code>
          </p>
          <ArtifactReceiptFileActions key={trace_id} receipt={feedback.response} />
        </div>
      </Panel>
    );
  const artifact = data.artifact;
  return (
    <Panel title="Original write recorded" icon="audit">
      <div className="side-detail artifact-details" role="status">
        <div className="artifact-badges">
          <Badge tone="green">Original receipt confirmed</Badge>
          <Badge tone="yellow">File contents not checked</Badge>
        </div>
        <p>
          This receipt describes the version saved by the original request. The file may have
          changed since then; this lookup does not confirm download availability.
        </p>
        <dl className="detail-grid checkpoint-detail-meta">
          <Detail label="File ID">{artifact.artifact_id}</Detail>
          <Detail label="Saved name">{artifact.name}</Detail>
          <Detail label="Saved version">{artifact.version}</Detail>
          <Detail label="Saved size">{artifact.size.toLocaleString('en-US')} bytes</Detail>
          <Detail label="Saved at">
            <time dateTime={artifact.updated_at}>{artifact.updated_at}</time>
          </Detail>
          <Detail label="Original record trace">{artifact.trace_id}</Detail>
          <Detail label="Read trace">{trace_id}</Detail>
        </dl>
        <div className="heading-actions artifact-receipt-actions">
          <Link
            className="panel-link"
            href={artifactPageHref(artifact.artifact_id, artifact.version)}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Open saved version in a new tab ↗
          </Link>
          <Link
            className="panel-link"
            href={artifactPageHref(artifact.artifact_id)}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Read current metadata in a new tab ↗
          </Link>
        </div>
        <ArtifactReceiptFileActions key={trace_id} receipt={feedback.response} />
      </div>
    </Panel>
  );
}
