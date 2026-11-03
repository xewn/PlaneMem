'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { ConflictReceiptQuery } from '@planemem/contracts';
import { Badge, Panel } from '../../../components/ui';
import { checkConflictReceipt } from './actions';
import {
  CONFLICT_RECEIPT_REQUEST_BYTES,
  decodeConflictRequest,
  encodeConflictRequest,
  parseConflictReceiptFeedback,
  receiptMessages,
  type ConflictReceiptFeedback,
} from './model';

export function ConflictReceiptForm() {
  const [draft, setDraft] = useState('');
  const [request, setRequest] = useState<ConflictReceiptQuery>();
  const [feedback, setFeedback] = useState<ConflictReceiptFeedback>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const active = useRef(false);
  const recorded = feedback?.status === 'checked' && feedback.response.data.status === 'recorded';
  function accept(raw: string) {
    const original = decodeConflictRequest(raw);
    setRequest(original);
    setDraft('');
    setMessage(
      'Original request loaded. Review its identity, key, version and decision before checking.',
    );
  }
  async function importFile(file: File | undefined) {
    if (active.current || request || !file) return;
    if (file.size > CONFLICT_RECEIPT_REQUEST_BYTES) {
      setMessage('Use a saved request no larger than 1 MB.');
      return;
    }
    active.current = true;
    setBusy(true);
    try {
      accept(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
    } catch {
      setMessage(
        'Use valid UTF-8 JSON containing the saved identity, request_key and complete original command.',
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  function review() {
    if (active.current || request) return;
    try {
      accept(draft);
    } catch {
      setMessage(
        'Use the complete saved identity, request_key and command, including conflict_id and the original expected_version. Limit: 1 MB.',
      );
    }
  }
  async function lookup() {
    if (active.current || !request || recorded) return;
    const original = request;
    active.current = true;
    setBusy(true);
    setMessage('');
    try {
      const form = new FormData();
      form.set('request', encodeConflictRequest(original));
      const returned = await checkConflictReceipt(form);
      try {
        setFeedback(parseConflictReceiptFeedback(returned, original));
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
  function save() {
    if (active.current || !request) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([encodeConflictRequest(request)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'conflict-original-request.json';
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setMessage(
        'Request JSON prepared for download. Keep it for another check after closing or reloading this page.',
      );
    } catch {
      setShowJson(true);
      setMessage('Copy the original request JSON below and keep it unchanged.');
    } finally {
      if (url) {
        const savedUrl = url;
        setTimeout(() => URL.revokeObjectURL(savedUrl), 1000);
      }
    }
  }
  return (
    <div aria-busy={busy}>
      <Panel
        title={request ? 'Review the original request' : 'Load a saved request'}
        icon="conflicts"
      >
        <div className="side-detail">
          <p>
            Use the request saved before the decision was submitted. Keep every original field, the
            original key and expected version. Current conflict details cannot reconstruct these.
          </p>
          <p className="muted">
            Sign in as the original account and client in the same project. Keep a separate copy for
            reloads; this page does not save to browser storage.
          </p>
          {!request ? (
            <form
              className="handoff-form checkpoint-form"
              onSubmit={(event) => {
                event.preventDefault();
                review();
              }}
            >
              <label>
                Import saved JSON (up to 1 MB)
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    void importFile(file);
                  }}
                />
              </label>
              <label>
                Or paste saved JSON
                <textarea
                  rows={9}
                  spellCheck={false}
                  value={draft}
                  maxLength={CONFLICT_RECEIPT_REQUEST_BYTES}
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>
              <p className="muted">
                Required fields: identity, request_key, command. The command includes conflict_id,
                expected_version, resolution and merged_value only for a merge, plus any extra
                fields in the original body.
              </p>
              <button className="primary-button" disabled={busy || !draft}>
                Review saved request
              </button>
            </form>
          ) : (
            <>
              <dl className="detail-grid">
                <div>
                  <dt>Conflict</dt>
                  <dd>{request.command.conflict_id}</dd>
                </div>
                <div>
                  <dt>Original key</dt>
                  <dd>{request.request_key}</dd>
                </div>
                <div>
                  <dt>Expected version</dt>
                  <dd>{request.command.expected_version}</dd>
                </div>
                <div>
                  <dt>Decision</dt>
                  <dd>{request.command.resolution}</dd>
                </div>
                {Object.entries(request.identity).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replace(/_/g, ' ')}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary>Review complete original command</summary>
                <pre
                  className="json-view"
                  style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {JSON.stringify(request.command, null, 2)}
                </pre>
              </details>
              <div className="heading-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy || recorded}
                  onClick={() => void lookup()}
                >
                  {busy
                    ? 'Checking…'
                    : recorded
                      ? 'Original decision recorded'
                      : 'Check original receipt'}
                </button>
                <button className="secondary-button" type="button" disabled={busy} onClick={save}>
                  Save request JSON
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  aria-expanded={showJson}
                  aria-controls="conflict-original-json"
                  onClick={() => setShowJson(!showJson)}
                >
                  {showJson ? 'Hide' : 'Show'} request JSON
                </button>
                <Link
                  className="panel-link"
                  href="/conflicts/receipt"
                  prefetch={false}
                  target="_blank"
                  rel="noreferrer"
                >
                  Check another request ↗
                </Link>
              </div>
              <div id="conflict-original-json" hidden={!showJson}>
                <label>
                  Original request JSON
                  <textarea
                    rows={8}
                    readOnly
                    spellCheck={false}
                    value={showJson ? encodeConflictRequest(request) : ''}
                  />
                </label>
              </div>
            </>
          )}
          {message && <p role="status">{message}</p>}
        </div>
      </Panel>
      {feedback && <ReceiptFeedback feedback={feedback} />}
    </div>
  );
}
export function ReceiptFeedback({ feedback }: { feedback: ConflictReceiptFeedback }) {
  if (feedback.status === 'error')
    return (
      <Panel title="Receipt not confirmed" icon="conflicts">
        <div className="side-detail" role="alert">
          <p>{receiptMessages[feedback.reason]}</p>
          {feedback.trace && <p>Read trace · {feedback.trace}</p>}
          {feedback.reason === 'signin' && (
            <Link href="/login" target="_blank" rel="noreferrer" prefetch={false}>
              Sign in in a new tab ↗
            </Link>
          )}
          <p>The original request remains above for another explicit check or export.</p>
        </div>
      </Panel>
    );
  const { data, trace_id } = feedback.response;
  if (data.status === 'not-observed')
    return (
      <Panel title="Outcome still unknown" icon="conflicts">
        <div className="side-detail" role="status">
          <Badge tone="yellow">No matching receipt observed</Badge>
          <p>
            The original request may still be committing, or no matching saved request was observed.
            This does not prove failure or authorize a new decision. Keep the original request for
            another explicit check.
          </p>
          <p>Read trace · {trace_id}</p>
        </div>
      </Panel>
    );
  const receipt = data.receipt;
  return (
    <Panel title="Original decision recorded" icon="conflicts">
      <div className="side-detail" role="status">
        <Badge tone="green">Original receipt confirmed</Badge>
        <p>
          The saved decision and event match this original request. Application to the source entity
          has not been checked.
        </p>
        <dl className="detail-grid">
          <div>
            <dt>Saved version</dt>
            <dd>{receipt.version}</dd>
          </div>
          <div>
            <dt>Decision</dt>
            <dd>{receipt.resolution}</dd>
          </div>
          <div>
            <dt>Event</dt>
            <dd>{receipt.event_id}</dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>{receipt.recorded_at}</dd>
          </div>
          <div>
            <dt>Original trace</dt>
            <dd>{receipt.original_trace_id}</dd>
          </div>
          <div>
            <dt>Read trace</dt>
            <dd>{trace_id}</dd>
          </div>
        </dl>
        <Link
          className="panel-link"
          href={{ pathname: '/conflicts/detail', query: { conflict: receipt.conflict_id } }}
          target="_blank"
          rel="noreferrer"
          prefetch={false}
        >
          Read current conflict details ↗
        </Link>
        <Link
          className="panel-link"
          href={{ pathname: '/audit', query: { resource: 'conflict:' + receipt.conflict_id } }}
          target="_blank"
          rel="noreferrer"
          prefetch={false}
        >
          View conflict audit ↗
        </Link>
      </div>
    </Panel>
  );
}
