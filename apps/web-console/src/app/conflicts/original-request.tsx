'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ConflictReceiptQuery } from '@planemem/contracts';
import { submitConflictOriginal } from './actions';
import { checkConflictReceipt } from './receipt/actions';
import { ReceiptFeedback } from './receipt/form';
import {
  decodeConflictRequest,
  encodeConflictRequest,
  parseConflictReceiptFeedback,
  type ConflictReceiptFeedback,
} from './receipt/model';
import { parseConflictSubmissionFeedback, submissionMessages } from './original-model';
import { preserveBrowserConflictOriginal } from './original-store';

export function OriginalConflictRequest({
  original,
  prepared = false,
}: {
  original: ConflictReceiptQuery;
  prepared?: boolean;
}) {
  const [request] = useState(() => decodeConflictRequest(encodeConflictRequest(original)));
  const [feedback, setFeedback] = useState<ConflictReceiptFeedback>();
  const [message, setMessage] = useState(
    prepared
      ? 'Original request prepared. Review it below before explicitly sending it.'
      : 'Original request restored. Its outcome is unknown until its receipt is checked.',
  );
  const [storageMessage, setStorageMessage] = useState('');
  const [trace, setTrace] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(!prepared);
  const [showJson, setShowJson] = useState(false);
  const active = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const recorded = feedback?.status === 'checked' && feedback.response.data.status === 'recorded';
  async function preserve() {
    try {
      await preserveBrowserConflictOriginal(request);
      if (mounted.current)
        setStorageMessage(
          'Complete original request saved and read back in this browser. Keep an exported copy for backup.',
        );
      return true;
    } catch {
      if (mounted.current)
        setStorageMessage(
          'The original request could not be saved and read back, or the browser or old tab slot contains a different or damaged request. No decision was sent. Export this request; receipt checks remain available. Existing data was not replaced.',
        );
      return false;
    }
  }
  async function save() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    try {
      await preserve();
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function send() {
    if (active.current || recorded || !confirmed) return;
    active.current = true;
    setBusy(true);
    setConfirmed(false);
    try {
      if (!(await preserve())) return;
      // Leaving during local preservation must not start a new server action afterward.
      if (!mounted.current) return;
      setAttempted(true);
      setFeedback(undefined);
      setTrace('');
      setMessage(
        'Waiting for the original decision request. Keep this page open; its outcome is not yet confirmed.',
      );
      const form = new FormData();
      form.set('request', encodeConflictRequest(request));
      form.set('confirmed', 'yes');
      const returned = parseConflictSubmissionFeedback(await submitConflictOriginal(form), request);
      if (!mounted.current) return;
      setMessage(submissionMessages[returned.reason]);
      setTrace(returned.trace ?? '');
    } catch {
      if (mounted.current) setMessage(submissionMessages.unavailable);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function check() {
    if (active.current || recorded) return;
    active.current = true;
    setBusy(true);
    setConfirmed(false);
    try {
      const form = new FormData();
      form.set('request', encodeConflictRequest(request));
      const returned = parseConflictReceiptFeedback(await checkConflictReceipt(form), request);
      if (!mounted.current) return;
      setFeedback(returned);
      setMessage(
        returned.status === 'checked' && returned.response.data.status === 'recorded'
          ? 'The original receipt is confirmed. Keep the saved request for your records.'
          : 'The original decision outcome remains unknown. Keep this request unchanged.',
      );
    } catch {
      if (!mounted.current) return;
      setFeedback({ status: 'error', request, reason: 'unavailable' });
      setMessage('The receipt could not be confirmed. Keep this original request unchanged.');
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function exportOriginal() {
    if (active.current) return;
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
      setMessage('Original request JSON prepared for download. Keep the complete file unchanged.');
    } catch {
      setShowJson(true);
      setMessage('Copy and keep the complete original request JSON below.');
    } finally {
      if (url) {
        const savedUrl = url;
        setTimeout(() => URL.revokeObjectURL(savedUrl), 1000);
      }
    }
  }
  return (
    <div className="side-detail" aria-busy={busy}>
      <h3>Frozen original decision</h3>
      <dl className="detail-grid">
        <div>
          <dt>Conflict</dt>
          <dd>{request.command.conflict_id}</dd>
        </div>
        <div>
          <dt>Original request key</dt>
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
        {Object.entries(request.identity).map(([name, value]) => (
          <div key={name}>
            <dt>{name.replace(/_/g, ' ')}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>Complete original command</summary>
        <pre className="json-view" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {JSON.stringify(request.command, null, 2)}
        </pre>
      </details>
      <p>
        Save this original in the browser to recover it after reopening a tab in the same profile.
        Browser data can be cleared or evicted, so keep an exported copy too. Saved JSON may contain
        account identifiers and merged content.
      </p>
      <p>
        Every send keeps the original identity, version, parameters and key. A missing receipt does
        not prove failure. No operation below applies the decision to its source entity.
      </p>
      {!recorded && (
        <form
          className="handoff-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="confirmation-box">
            <input
              type="checkbox"
              required
              disabled={busy}
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {attempted
              ? 'I have reviewed the unknown outcome and explicitly authorize resending this exact original request.'
              : 'I confirm sending this exact original decision.'}
          </label>
          <button className="primary-button" disabled={busy || !confirmed}>
            {attempted ? 'Resend original decision' : 'Send original decision'}
          </button>
        </form>
      )}
      <div className="heading-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={busy || recorded}
          onClick={() => void check()}
        >
          Check original receipt
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => void save()}
        >
          Save original in this browser
        </button>
        <button className="secondary-button" type="button" disabled={busy} onClick={exportOriginal}>
          Export original request
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          aria-expanded={showJson}
          onClick={() => setShowJson(!showJson)}
        >
          {showJson ? 'Hide' : 'Show'} request JSON
        </button>
      </div>
      {showJson && (
        <label>
          Complete original request JSON
          <textarea rows={9} readOnly spellCheck={false} value={encodeConflictRequest(request)} />
        </label>
      )}
      <div aria-live="polite">
        <p>{message}</p>
        {storageMessage && <p>{storageMessage}</p>}
        {trace && <p>Submission trace · {trace}</p>}
      </div>
      {feedback && <ReceiptFeedback feedback={feedback} />}
      {!busy && (
        <>
          <Link href="/conflicts/recover" prefetch={false}>
            Recover a saved original conflict request
          </Link>
          <Link
            href={{
              pathname: '/conflicts/detail',
              query: { conflict: request.command.conflict_id },
            }}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Read current details ↗
          </Link>
          <Link href="/login" target="_blank" rel="noreferrer" prefetch={false}>
            Renew the original sign-in ↗
          </Link>
        </>
      )}
    </div>
  );
}
