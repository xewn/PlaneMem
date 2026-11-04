'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseProposalCreateReceiptEnvelope,
  type ProposalMutationReceipt,
} from '@planemem/contracts';
import { validateProposalReceipt } from '../../lib/mutation-receipts';
import { backupOperation } from '../sync/receipt/backup-operation';
import { submitSavedProposal, readSavedProposalReceipt } from './actions';
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
    setConfirmed(false);
    setMessage('Saving and checking the complete original request in this browser…');
    try {
      await backupOperation(controller.signal, (signal) =>
        preserveBrowserProposalOriginal(request, signal),
      );
      if (mounted.current && operation.current === controller)
        setMessage(
          'The complete original request was saved and read back in this browser. It can be found from recovery after closing this tab.',
        );
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'Browser saving could not be confirmed. It may already have completed; stopping or timing out does not remove a saved copy. Keep or export the original, then retry saving. Existing damaged or different copies are never replaced. This action did not send a submission.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
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
      active.current = false;
    };
  }, [save, saveOnMount]);
  function stopWaiting() {
    if (!mounted.current || !active.current || !operation.current) return;
    // Abort only the local wait. An already dispatched server action can still complete.
    operation.current.abort();
  }
  function download() {
    if (active.current || !mounted.current) return;
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
    setMessage('Saving and checking the complete original before sending…');
    let dispatched = false;
    try {
      const result = await backupOperation(controller.signal, async (signal, check) => {
        await preserveBrowserProposalOriginal(request, signal);
        check();
        if (!mounted.current || operation.current !== controller) throw new TypeError();
        const form = new FormData();
        form.set('original', encodeProposalOriginal(request));
        form.set('confirmed', 'yes');
        check();
        dispatched = true;
        setMessage('Waiting for the original submission. Its outcome is not yet confirmed.');
        const response = await submitSavedProposal(form);
        check();
        return response;
      });
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
          dispatched
            ? 'The original submission is not confirmed and may still complete. Stopping or timing out only ends this page’s wait. Keep the original content and key; check its receipt before deciding whether to explicitly retry the same request.'
            : 'Saving and checking the original could not be confirmed, so this attempt did not send a submission. A browser copy may already have been saved. Keep or export the original, then explicitly retry saving or sending the same request.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function checkReceipt() {
    if (active.current || receipt || !mounted.current) return;
    const controller = new AbortController();
    operation.current = controller;
    active.current = true;
    setBusy(true);
    setConfirmed(false);
    setMessage('Reading the original creation receipt. No creation request is being sent.');
    try {
      const result = await backupOperation(controller.signal, async (_signal, check) => {
        const form = new FormData();
        form.set('original', encodeProposalOriginal(request));
        check();
        const response = await readSavedProposalReceipt(form);
        check();
        return response;
      });
      if (!mounted.current || operation.current !== controller) return;
      if (result.original !== encodeProposalOriginal(request)) throw new TypeError();
      if (result.status === 'unavailable') {
        setMessage(result.message);
        return;
      }
      const view = parseProposalCreateReceiptEnvelope(
        result.receipt,
        {
          identity: request.binding.identity,
          request_key: request.request_key,
          draft: request.draft,
        },
        result.receipt.trace_id,
      ).data;
      if (view.status === 'not-observed') {
        setMessage(
          'No matching original creation receipt was observed in this read. This does not prove failure or cancel an in-flight submission. Keep the original unchanged; no new creation request was sent.',
        );
      } else {
        const saved = view.receipt;
        setReceipt({
          proposal_id: saved.proposal_id,
          status: saved.status,
          revision: saved.revision,
          event_id: saved.event_id,
          occurred_at: saved.occurred_at,
          replayed: true,
        });
        setMessage(
          'The original creation was confirmed from its historical receipt. The proposal may since have been reviewed or expired; open its details for current information.',
        );
      }
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'The complete creation receipt could not be confirmed. Stopping or timing out does not establish whether an earlier submission completed. Keep the original request and explicitly check again when ready. This query did not send a creation command.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  return (
    <div className="handoff-form" style={{ overflowWrap: 'anywhere' }} aria-busy={busy}>
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
          disabled={busy || !!receipt}
          onClick={() => void checkReceipt()}
        >
          Check original submission result
        </button>
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
        This page waits up to 30 seconds for each save, save-and-send attempt or receipt query.
        Stopping the wait keeps the original request. A submission already sent may still complete;
        check its original receipt before deciding whether to retry.
      </p>
      {busy && (
        <button type="button" className="secondary-button" onClick={stopWaiting}>
          Stop waiting on this page
        </button>
      )}
      <p className="muted">
        Browser copies can survive closing tabs in this browser profile. Clearing browser data can
        remove them; other devices need an exported file. Keep a separate export. Loading or saving
        a request does not submit it, and a saved request does not confirm its outcome.
      </p>
      <p className="muted">
        Checking the original result only reads its receipt and is available even when browser
        saving fails. An unavailable or unobserved receipt never changes the original content or
        key.
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
              onChange={(event) => {
                if (!active.current) setConfirmed(event.target.checked);
              }}
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
