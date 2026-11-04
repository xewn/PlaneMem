'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { proposalReceiptJson, type ProposalMutationReceipt } from '@planemem/contracts';
import {
  creationRecordedReceipt,
  parseCreationObservation,
  type CreationObservation,
} from './creation-history-model';
import { CreationHistoryPanel } from './creation-history-panel';
import { prepareCreationHistory } from './creation-history-file';
import { saveCreationHistory } from './creation-history-store';
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
  const [observation, setObservation] = useState<CreationObservation>();
  const [confirmedObservation, setConfirmedObservation] = useState<CreationObservation>();
  const [automaticHistory, setAutomaticHistory] = useState(false);
  const [historyStorageEpoch, setHistoryStorageEpoch] = useState(0);
  const [automaticAttempt, setAutomaticAttempt] = useState<{
    document: CreationObservation;
    status: 'saving' | 'saved' | 'unknown';
    digest?: string;
  }>();
  const active = useRef(false);
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const beginHistory = useCallback(() => {
    if (!mounted.current || active.current) return false;
    active.current = true;
    setBusy(true);
    setConfirmed(false);
    return true;
  }, []);
  const endHistory = useCallback(() => {
    active.current = false;
    if (mounted.current) setBusy(false);
  }, []);
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
  /** A local history failure must not overwrite an already received creation result. */
  async function retainObservation(document: CreationObservation, controller: AbortController) {
    if (!mounted.current || operation.current !== controller) return;
    setAutomaticAttempt({ document, status: 'saving' });
    setHistoryStorageEpoch((value) => value + 1);
    try {
      const saved = await backupOperation(controller.signal, async (signal, check) => {
        const candidate = await prepareCreationHistory(document, check);
        check();
        return saveCreationHistory(candidate.raw, request.binding, signal, check);
      });
      if (!mounted.current || operation.current !== controller) return;
      if (controller.signal.aborted) throw new TypeError();
      setAutomaticAttempt({ document, status: 'saved', digest: saved.file.document_sha256 });
    } catch {
      if (!mounted.current || operation.current !== controller) return;
      setAutomaticHistory(false);
      setAutomaticAttempt({ document, status: 'unknown' });
    }
  }
  async function retryHistorySave() {
    if (!mounted.current || active.current || automaticAttempt?.status !== 'unknown') return;
    const document = automaticAttempt.document;
    const controller = new AbortController();
    operation.current = controller;
    active.current = true;
    setBusy(true);
    setConfirmed(false);
    try {
      await retainObservation(document, controller);
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        if (mounted.current) setBusy(false);
      }
    }
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
        const document = parseCreationObservation({
          schema_version: 1,
          kind: 'proposal-creation-observation',
          original: request,
          observed_at: new Date().toISOString(),
          source: 'submission',
          receipt: result.receipt,
        });
        if (document.source !== 'submission') throw new TypeError();
        setReceipt(document.receipt.data);
        setObservation(document);
        setConfirmedObservation(document);
        setMessage(
          'The gateway confirmed the original submission. Keep the saved request for your records.',
        );
        if (automaticHistory) await retainObservation(document, controller);
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
    if (active.current || !mounted.current) return;
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
      const document = parseCreationObservation({
        schema_version: 1,
        kind: 'proposal-creation-observation',
        original: request,
        observed_at: new Date().toISOString(),
        source: 'receipt-query',
        receipt: result.receipt,
      });
      if (document.source !== 'receipt-query') throw new TypeError();
      setObservation(document);
      const view = document.receipt.data;
      if (view.status === 'not-observed') {
        setMessage(
          'No matching original creation receipt was observed in this read. This does not prove failure or cancel an in-flight submission. Keep the original unchanged; no new creation request was sent.',
        );
      } else if (
        confirmedObservation &&
        proposalReceiptJson(creationRecordedReceipt(confirmedObservation)) !==
          proposalReceiptJson(creationRecordedReceipt(document))
      ) {
        setMessage(
          'This query returned different creation facts from the retained confirmed result. Both observations remain available for inspection and export. The previous confirmation is retained; no new submission was sent.',
        );
      } else {
        setConfirmedObservation(document);
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
      if (automaticHistory) await retainObservation(document, controller);
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
          disabled={busy}
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
        check its original receipt before deciding whether to retry. When automatic history saving
        is enabled, a received result starts a separate local save with up to 30 seconds of waiting.
        Stopping that save preserves the received result.
      </p>
      {busy && operation.current && (
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
      <section className="side-detail" aria-label="Automatic creation history retention">
        <label>
          <input
            type="checkbox"
            checked={automaticHistory}
            disabled={busy || automaticAttempt?.status === 'unknown'}
            onChange={(event) => {
              if (!active.current && automaticAttempt?.status !== 'unknown')
                setAutomaticHistory(event.target.checked);
            }}
          />{' '}
          Automatically save newly received creation results in this browser
        </label>
        <p>
          Applies to future valid send and receipt-query results on this page, including reads that
          found no matching receipt or differ from a retained confirmation. Enabling does not query,
          send or save earlier observations. Other actions wait for each local save attempt. This
          choice resets when you leave; keep exported files for longer-term recovery.
        </p>
        {automaticAttempt && (
          <div role="status">
            <p>
              Last local retention attempt · {automaticAttempt.document.observed_at} ·{' '}
              {automaticAttempt.status === 'saving'
                ? 'Saving the complete received observation…'
                : automaticAttempt.status === 'saved'
                  ? 'The complete history copy was saved and read back. This does not establish the current proposal state.'
                  : 'Local saving could not be confirmed and may already have completed. Automatic retention is off. The complete observation is retained below for inspection and export; the received creation result is unchanged.'}
            </p>
            {automaticAttempt.digest && (
              <p>
                History checksum · <code>{automaticAttempt.digest}</code>
              </p>
            )}
            {automaticAttempt.status === 'unknown' && (
              <>
                <p>
                  Retry this same local save before enabling automatic retention again. This keeps
                  the original observation time and response; it does not query or send a proposal.
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void retryHistorySave()}
                >
                  Retry saving the retained observation locally
                </button>
              </>
            )}
          </div>
        )}
      </section>
      <CreationHistoryPanel
        binding={request.binding}
        live={observation}
        confirmedLive={confirmedObservation}
        retainedAutomatic={automaticAttempt?.document}
        externalStorageEpoch={historyStorageEpoch}
        disabled={busy}
        begin={beginHistory}
        end={endHistory}
      />
      <p>
        <Link
          href="/proposals/creation-history"
          prefetch={false}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open saved creation history ↗
        </Link>
      </p>
    </div>
  );
}
