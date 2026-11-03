'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { backupOperation } from '../sync/receipt/backup-operation';
import { submitSavedProposalReview } from './review-actions';
import {
  decodeReviewOriginal,
  encodeReviewOriginal,
  parseReviewReceipt,
  type ProposalReviewOriginal,
  type ProposalReviewReceipt,
} from './review-model';
import { saveReviewOriginal } from './review-store';

export function OriginalProposalReview({
  original,
  saveOnMount = false,
}: {
  original: ProposalReviewOriginal;
  saveOnMount?: boolean;
}) {
  const [request] = useState(() => decodeReviewOriginal(encodeReviewOriginal(original)));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ProposalReviewReceipt>();
  const [message, setMessage] = useState(
    'The original decision is fixed. Save or export it, then review it before explicitly sending.',
  );
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const save = useCallback(async () => {
    if (!mounted.current || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      await backupOperation(controller.signal, (signal) => saveReviewOriginal(request, signal));
      if (mounted.current && operation.current === controller)
        setMessage(
          'The complete original review was saved and read back in this browser. Keep an exported file for recovery on another device.',
        );
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'Browser saving could not be confirmed. Keep this page open or export the complete request. Sending requires a verified browser copy; damaged or different copies are never replaced.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (mounted.current) setBusy(false);
      }
    }
  }, [request]);
  useEffect(() => {
    mounted.current = true;
    if (saveOnMount) void save();
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
    };
  }, [save, saveOnMount]);
  async function send() {
    if (!mounted.current || operation.current || !confirmed || receipt) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setConfirmed(false);
    setMessage('Saving the complete original before sending the review…');
    let dispatched = false;
    try {
      const result = await backupOperation(controller.signal, async (signal, check) => {
        await saveReviewOriginal(request, signal);
        check();
        if (!mounted.current || operation.current !== controller) throw new TypeError();
        const data = new FormData();
        data.set('original', encodeReviewOriginal(request));
        data.set('confirmed', 'yes');
        check();
        dispatched = true;
        setMessage(
          'Waiting for the original review result. Keep its decision, reason, version and key unchanged.',
        );
        const result = await submitSavedProposalReview(data);
        check();
        return result;
      });
      if (!mounted.current || operation.current !== controller) return;
      if (result.original !== encodeReviewOriginal(request)) throw new TypeError();
      if (result.status === 'saved') {
        setReceipt(parseReviewReceipt(result.receipt, request, result.receipt.trace_id));
        setMessage(
          'The gateway confirmed the original review. This is its historical result; open the proposal for current details.',
        );
      } else setMessage(result.message);
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          dispatched
            ? 'The review result remains unknown. The request may still complete. Keep the saved original and retry only this same decision, reason, version and key.'
            : 'The original could not be saved and verified, so this attempt did not send a review. Keep or export the original, then retry saving.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (mounted.current) setBusy(false);
      }
    }
  }
  function download() {
    if (!mounted.current || operation.current) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'proposal-review-original.json';
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setMessage(
        'Review file download requested. Check that the complete file was saved before leaving this page.',
      );
    } catch {
      setMessage(
        'The download could not be started. The complete original remains available below for copying.',
      );
    } finally {
      if (url) {
        const saved = url;
        setTimeout(() => URL.revokeObjectURL(saved), 1000);
      }
    }
  }
  return (
    <div className="handoff-form" style={{ overflowWrap: 'anywhere' }} aria-busy={busy}>
      <h3>Original review decision</h3>
      <p>
        Proposal · {request.proposal_id} · reviewed revision {request.expected_revision}
      </p>
      <p>Decision · {request.decision === 'confirm' ? 'Confirm as reviewed' : 'Reject'}</p>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{request.reason}</pre>
      <p>Project · {request.binding.identity.project_id}</p>
      <p>
        Account · {request.binding.identity.actor_id} · Client ·{' '}
        {request.binding.identity.client_id}
      </p>
      <p>Gateway · {request.binding.gateway_url}</p>
      <p>
        Original request key · <code>{request.request_key}</code>
      </p>
      <details>
        <summary>Review or copy complete original JSON</summary>
        <textarea rows={10} readOnly spellCheck={false} value={JSON.stringify(request, null, 2)} />
      </details>
      <div className="heading-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void save()}
        >
          Save original review in this browser
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={download}>
          Export original review
        </button>
        <Link
          href="/proposals/recover-review"
          prefetch={false}
          target="_blank"
          rel="noopener noreferrer"
        >
          Recover a saved review ↗
        </Link>
        <Link
          href={'/proposals?status=all&proposal=' + encodeURIComponent(request.proposal_id)}
          prefetch={false}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open current proposal ↗
        </Link>
      </div>
      <p className="muted">
        Saving and loading do not send a decision or confirm its outcome. Browser data can be
        cleared; keep a separate file. The gateway requires the original account and client, a human
        identity and review permission for every send or retry. A retry can record the decision if
        the original never arrived. It is not a read-only status check.
      </p>
      {!receipt && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => {
                if (!operation.current) setConfirmed(event.target.checked);
              }}
            />{' '}
            I reviewed this original decision and its supporting sources and want to send or retry
            the same request.
          </label>
          <button className="primary-button" disabled={busy || !confirmed}>
            Send or retry original review
          </button>
        </form>
      )}
      {receipt && (
        <p>
          Confirmed historical result · {receipt.data.status} · revision {receipt.data.revision} ·{' '}
          {receipt.data.occurred_at}
        </p>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
