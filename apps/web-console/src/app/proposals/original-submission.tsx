'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProposalMutationReceipt } from '@planemem/contracts';
import { validateProposalReceipt } from '../../lib/mutation-receipts';
import { submitSavedProposal } from './actions';
import {
  decodeProposalOriginal,
  encodeProposalOriginal,
  type ProposalOriginal,
} from './original-model';
import { preserveBrowserProposalOriginal } from './original-store';

export function OriginalProposalSubmission({
  original,
  saveOnMount = false,
}: {
  original: ProposalOriginal;
  saveOnMount?: boolean;
}) {
  const [request] = useState(() => decodeProposalOriginal(encodeProposalOriginal(original)));
  const [message, setMessage] = useState(
    'The original request is frozen. Save a copy and review it before sending.',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ProposalMutationReceipt>();
  const active = useRef(false);
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const save = useCallback(async () => {
    if (active.current || !mounted.current) return;
    const controller = new AbortController();
    operation.current = controller;
    active.current = true;
    setBusy(true);
    try {
      await preserveBrowserProposalOriginal(request, controller.signal);
      if (mounted.current && operation.current === controller)
        setMessage(
          'The complete original request was saved and read back in this browser. It can be found from recovery after closing this tab.',
        );
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'Browser saving could not be confirmed, or an existing copy is damaged or different. Keep this page open and export the original. Sending is blocked until saving succeeds.',
        );
    } finally {
      if (mounted.current && operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        setBusy(false);
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
      active.current = false;
    };
  }, [save, saveOnMount]);
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
    if (active.current || !confirmed || receipt || !mounted.current) return;
    const controller = new AbortController();
    operation.current = controller;
    active.current = true;
    setBusy(true);
    setConfirmed(false);
    try {
      try {
        await preserveBrowserProposalOriginal(request, controller.signal);
      } catch {
        if (mounted.current && operation.current === controller)
          setMessage(
            'The original request could not be saved and read back. No submission was sent. Export it or retry saving; an existing different copy is never replaced.',
          );
        return;
      }
      if (!mounted.current || controller.signal.aborted || operation.current !== controller) return;
      setMessage('Waiting for the original submission. Its outcome is not yet confirmed.');
      const form = new FormData();
      form.set('original', encodeProposalOriginal(request));
      form.set('confirmed', 'yes');
      const result = await submitSavedProposal(form);
      if (!mounted.current || operation.current !== controller) return;
      if (result.original !== encodeProposalOriginal(request)) throw new TypeError();
      if (result.status === 'saved') {
        validateProposalReceipt(result.receipt, { status: 'proposed', revision: 1 });
        setReceipt(result.receipt);
        setMessage(
          'The gateway confirmed the original submission. Keep the saved request for your records.',
        );
      } else setMessage(result.message);
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'The original submission is not confirmed. Keep its content and key unchanged; explicitly retry this same request when access is restored.',
        );
    } finally {
      if (mounted.current && operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        setBusy(false);
      }
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
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void save()}
        >
          Save original in this browser
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={download}>
          Export original request
        </button>
        <Link href="/proposals/recover" prefetch={false} target="_blank" rel="noopener noreferrer">
          Open saved request recovery ↗
        </Link>
      </div>
      <p className="muted">
        Browser copies can survive closing tabs in this browser profile. Clearing browser data can
        remove them; other devices need an exported file. Keep a separate export. Loading or saving
        a request does not submit it, and a saved request does not confirm its outcome.
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
            {busy ? 'Working…' : 'Send or retry original submission'}
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
