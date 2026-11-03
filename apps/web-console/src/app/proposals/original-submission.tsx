'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ProposalMutationReceipt } from '@planemem/contracts';
import { validateProposalReceipt } from '../../lib/mutation-receipts';
import { submitSavedProposal } from './actions';
import {
  decodeProposalOriginal,
  encodeProposalOriginal,
  preserveProposalOriginal,
  type ProposalOriginal,
} from './original-model';

export function OriginalProposalSubmission({ original }: { original: ProposalOriginal }) {
  const [request] = useState(() => decodeProposalOriginal(encodeProposalOriginal(original)));
  const [message, setMessage] = useState(
    'The original request is frozen. Save a copy and review it before sending.',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ProposalMutationReceipt>();
  const active = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    try {
      preserveProposalOriginal(request);
      setMessage(
        'The complete original request is saved in this tab. Export a copy to keep it after closing the tab.',
      );
    } catch {
      setMessage(
        'Saving in this tab could not be confirmed. Keep this page open and export the original. Sending remains blocked until local saving succeeds.',
      );
    }
    return () => {
      mounted.current = false;
    };
  }, [request]);
  function save() {
    if (active.current) return;
    try {
      preserveProposalOriginal(request);
      setMessage('Original request saved and read back in this tab.');
    } catch {
      setMessage(
        'The saved copy is unavailable, damaged or different. Existing data was not overwritten. Keep an exported copy.',
      );
    }
  }
  function download() {
    if (active.current) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'proposal-original.json';
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setMessage(
        'Download requested. Keep the complete file with the same care as the proposal content; check that your browser saved it.',
      );
    } catch {
      setMessage('Download could not be started. Keep this page open and try again.');
    } finally {
      if (url) {
        const savedUrl = url;
        setTimeout(() => URL.revokeObjectURL(savedUrl), 1000);
      }
    }
  }
  async function send() {
    if (active.current || !confirmed || receipt) return;
    active.current = true;
    setBusy(true);
    setConfirmed(false);
    try {
      try {
        preserveProposalOriginal(request);
      } catch {
        setMessage(
          'The original request could not be saved and read back. No submission was sent. Export it or retry saving; an existing different copy is never replaced.',
        );
        return;
      }
      if (!mounted.current) return;
      setMessage('Waiting for the original submission. Its outcome is not yet confirmed.');
      const form = new FormData();
      form.set('original', encodeProposalOriginal(request));
      form.set('confirmed', 'yes');
      const result = await submitSavedProposal(form);
      if (!mounted.current) return;
      if (result.original !== encodeProposalOriginal(request)) throw new TypeError();
      if (result.status === 'saved') {
        validateProposalReceipt(result.receipt, { status: 'proposed', revision: 1 });
        setReceipt(result.receipt);
        setMessage(
          'The gateway confirmed the original submission. Keep the saved request for your records.',
        );
      } else setMessage(result.message);
    } catch {
      if (mounted.current)
        setMessage(
          'The original submission is not confirmed. Keep its content and key unchanged; explicitly retry this same request when access is restored.',
        );
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="handoff-form" style={{ overflowWrap: 'anywhere' }}>
      <h3>{request.draft.title}</h3>
      <p>
        {request.draft.kind} · {request.draft.classification}
      </p>
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
        <summary>Review complete original content and sources</summary>
        <pre>{JSON.stringify(request, null, 2)}</pre>
      </details>
      <div className="heading-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={save}>
          Save original in this tab
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={download}>
          Export original request
        </button>
        <Link href="/proposals/recover" prefetch={false}>
          Open recovery in this tab
        </Link>
      </div>
      <p className="muted">
        Tab storage can be cleared and does not reliably carry over to other tabs or devices. Keep
        an exported file before leaving. Loading or saving a request does not submit it.
      </p>
      {!receipt && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="context-archive-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I reviewed this complete original request and want to send it with the same key.
          </label>
          <button className="primary-button" disabled={busy || !confirmed}>
            {busy ? 'Waiting for confirmation…' : 'Send or retry original submission'}
          </button>
        </form>
      )}
      <p role="status">{message}</p>
      {receipt && (
        <Link
          className="panel-link"
          href={'/proposals?status=all&proposal=' + encodeURIComponent(receipt.proposal_id)}
        >
          Open confirmed submission
        </Link>
      )}
    </div>
  );
}
