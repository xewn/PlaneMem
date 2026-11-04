'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Panel } from '../../../../components/ui';
import { ArtifactReceiptFileActions } from '../file-actions';
import {
  loadSavedArtifactReceipt,
  compareSavedArtifactOriginal,
  type SavedArtifactReceipt,
} from '../saved-model';

type Comparison = Awaited<ReturnType<typeof compareSavedArtifactOriginal>>;

export function SavedArtifactReceiptForm() {
  const [saved, setSaved] = useState<SavedArtifactReceipt>();
  const [comparison, setComparison] = useState<Comparison>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const selected = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const clear = () => {
      pending.current?.abort();
      pending.current = null;
      selected.current = false;
      setSaved(undefined);
      setComparison(undefined);
      setBusy(false);
      setMessage('The local view was cleared. Select a receipt file to review it again.');
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) clear();
    };
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', restore);
    return () => {
      mounted.current = false;
      pending.current?.abort();
      pending.current = null;
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', restore);
    };
  }, []);

  async function inspect(file: File, original: boolean) {
    if (
      pending.current ||
      (!original && selected.current) ||
      (original && (!selected.current || !saved))
    )
      return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    if (original) setComparison(undefined);
    const current = () =>
      mounted.current && pending.current === controller && !controller.signal.aborted;
    try {
      if (original && saved) {
        const result = await compareSavedArtifactOriginal(saved.receipt, file, controller.signal);
        if (current()) setComparison(result);
      } else {
        const result = await loadSavedArtifactReceipt(file, controller.signal);
        if (current()) {
          selected.current = true;
          setSaved(result);
        }
      }
    } catch {
      if (mounted.current && pending.current === controller)
        setMessage(
          controller.signal.aborted
            ? 'File inspection stopped. No server query or upload was sent.'
            : 'The complete file could not be checked. Use a receipt up to 4 MiB or an original request up to 1 MiB in UTF-8 JSON. No partial match is confirmed.',
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (mounted.current) setBusy(false);
      }
      controller.abort();
    }
  }
  function discard() {
    if (pending.current) return;
    selected.current = false;
    setSaved(undefined);
    setComparison(undefined);
    setMessage('The local view was cleared. Your files have not been changed.');
  }
  const receipt = saved?.receipt;
  const original = saved?.original;
  return (
    <div className="artifact-receipt" aria-busy={busy}>
      <Panel title="Saved receipt file" icon="audit">
        <div className="side-detail artifact-details">
          <p>
            Choose a receipt saved by the workbench or command line. The file is checked on this
            device and is not sent to the file service.
          </p>
          <p className="muted">
            A locally valid file does not authenticate its account or server outcome. This page does
            not check current file contents or store the imported receipt in browser storage.
          </p>
          <div className="handoff-form checkpoint-form">
            <label htmlFor="saved-artifact-receipt">Receipt JSON (up to 4 MiB)</label>
            <input
              id="saved-artifact-receipt"
              type="file"
              accept=".json,application/json"
              disabled={busy || !!saved}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void inspect(file, false);
              }}
            />
          </div>
          <div className="heading-actions">
            {busy && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => pending.current?.abort()}
              >
                Cancel inspection
              </button>
            )}
            {saved && (
              <button className="secondary-button" type="button" disabled={busy} onClick={discard}>
                Clear this view
              </button>
            )}
          </div>
          {busy && <p role="status">Reading and checking the complete file…</p>}
          {message && <p role="status">{message}</p>}
        </div>
      </Panel>
      {saved && receipt && original && (
        <>
          <Panel title="What the saved receipt says" icon="audit">
            <div className="side-detail artifact-details">
              <div className="artifact-badges">
                <Badge tone="yellow">Local file only</Badge>
                <Badge tone="yellow">
                  {receipt.data.status === 'recorded'
                    ? 'Saved outcome: recorded'
                    : 'Saved outcome: not observed'}
                </Badge>
              </div>
              <p>
                {receipt.data.status === 'recorded'
                  ? 'This file describes a historical saved version. Its origin and current download availability have not been checked here.'
                  : 'This file contains no matching recorded result. That does not prove the upload failed; keep the original request and content.'}
              </p>
              <dl className="detail-grid checkpoint-detail-meta">
                <div>
                  <dt>Receipt file</dt>
                  <dd>{saved.file_name}</dd>
                </div>
                <div>
                  <dt>Saved query reference</dt>
                  <dd>{receipt.trace_id}</dd>
                </div>
                <div>
                  <dt>Original account</dt>
                  <dd>{original.identity.actor_id}</dd>
                </div>
                <div>
                  <dt>Original client</dt>
                  <dd>{original.identity.client_id}</dd>
                </div>
                <div>
                  <dt>Tenant</dt>
                  <dd>{original.identity.tenant_id}</dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>{original.identity.workspace_id}</dd>
                </div>
                <div>
                  <dt>Project</dt>
                  <dd>{original.identity.project_id}</dd>
                </div>
                <div>
                  <dt>Original request key</dt>
                  <dd>
                    <code>{original.command.request_key}</code>
                  </dd>
                </div>
                <div>
                  <dt>Original operation</dt>
                  <dd>
                    {original.command.operation === 'artifact.create'
                      ? 'Create a file'
                      : 'Add a file version'}
                  </dd>
                </div>
                <div>
                  <dt>Original size</dt>
                  <dd>{original.command.size.toLocaleString('en-US')} bytes</dd>
                </div>
                {original.command.operation === 'artifact.create' ? (
                  <>
                    <div>
                      <dt>Original name</dt>
                      <dd>{original.command.name}</dd>
                    </div>
                    <div>
                      <dt>Original file type</dt>
                      <dd>{original.command.mime}</dd>
                    </div>
                    <div>
                      <dt>Original classification</dt>
                      <dd>{original.command.classification}</dd>
                    </div>
                    <div>
                      <dt>Original source count</dt>
                      <dd>{original.command.source_refs.length}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <dt>Original file ID</dt>
                      <dd>{original.command.artifact_id}</dd>
                    </div>
                    <div>
                      <dt>Original expected version</dt>
                      <dd>{original.command.expected_version}</dd>
                    </div>
                  </>
                )}
                {receipt.data.status === 'recorded' && (
                  <>
                    <div>
                      <dt>Saved file ID</dt>
                      <dd>{receipt.data.artifact.artifact_id}</dd>
                    </div>
                    <div>
                      <dt>Saved version</dt>
                      <dd>{receipt.data.artifact.version}</dd>
                    </div>
                    <div>
                      <dt>Saved name</dt>
                      <dd>{receipt.data.artifact.name}</dd>
                    </div>
                    <div>
                      <dt>Saved at</dt>
                      <dd>
                        <time dateTime={receipt.data.artifact.updated_at}>
                          {receipt.data.artifact.updated_at}
                        </time>
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <details>
                <summary>File comparison details</summary>
                <p>Receipt size: {saved.file_bytes.toLocaleString('en-US')} bytes</p>
                <p>
                  Receipt file SHA-256: <code>{saved.file_sha256}</code>
                </p>
                <p>
                  Original content SHA-256: <code>{original.command.sha256}</code>
                </p>
                <p className="muted">
                  The file fingerprint describes its bytes, including whitespace. It is not a server
                  signature.
                </p>
              </details>
              <ArtifactReceiptFileActions receipt={receipt} includeOriginal />
            </div>
          </Panel>
          <Panel title="Compare with your original request" icon="audit">
            <div className="side-detail artifact-details">
              <p>
                Optionally choose the request you kept before uploading. The complete account,
                client, project, request key, version and command must match.
              </p>
              <div className="handoff-form checkpoint-form">
                <label htmlFor="saved-artifact-original">Original request JSON (up to 1 MiB)</label>
                <input
                  id="saved-artifact-original"
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void inspect(file, true);
                  }}
                />
              </div>
              {comparison ? (
                <div role="status">
                  <Badge tone={comparison.matches ? 'blue' : 'yellow'}>
                    {comparison.matches ? 'Original request matches' : 'Different original request'}
                  </Badge>
                  <p>{comparison.file_name}</p>
                  <p className="muted">
                    {comparison.matches
                      ? 'The files agree locally. No server authentication or new receipt query was performed.'
                      : 'Keep both files and locate the exact original. This comparison does not authorize changing its key or version.'}
                  </p>
                  <details>
                    <summary>Compared file fingerprint</summary>
                    <code>{comparison.file_sha256}</code>
                  </details>
                </div>
              ) : (
                <p className="muted">
                  No separate original request has been confirmed for this receipt.
                </p>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
