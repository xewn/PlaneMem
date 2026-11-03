'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { backupOperation } from '../../sync/receipt/backup-operation';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from '../original-model';
import {
  decodeReviewOriginal,
  REVIEW_ORIGINAL_BYTES,
  type ProposalReviewOriginal,
} from '../review-model';
import {
  listReviewOriginals,
  loadReviewOriginal,
  type SavedReview,
  type SavedReviewPage,
} from '../review-store';
import { OriginalProposalReview } from '../review-submission';
import { ReviewBackupPanel } from '../review-backup-panel';

export function ProposalReviewRecovery({ binding }: { binding: ProposalSubmissionBinding }) {
  const [requestKey, setRequestKey] = useState('');
  const [raw, setRaw] = useState('');
  const [page, setPage] = useState<SavedReviewPage>();
  const [original, setOriginal] = useState<ProposalReviewOriginal>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Find a saved original review, enter its request key or load its complete file. Loading does not save or send a decision.',
  );
  const mounted = useRef(false);
  const loaded = useRef(false);
  const active = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const beginBackup = useCallback(() => {
    if (!mounted.current || active.current || loaded.current) return false;
    active.current = true;
    setBusy(true);
    return true;
  }, []);
  const endBackup = useCallback(() => {
    active.current = false;
    if (mounted.current) setBusy(false);
  }, []);
  const storageChanged = useCallback(() => {
    if (!mounted.current) return;
    setPage(undefined);
    setMessage(
      'The saved review list needs to be read again after an import attempt. Keep the backup if the outcome is unknown.',
    );
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
      active.current = false;
    };
  }, []);
  async function run<T>(
    work: (signal: AbortSignal, check: () => void) => Promise<T>,
    receive: (result: T) => void,
  ) {
    if (!mounted.current || active.current || loaded.current) return;
    const controller = new AbortController();
    operation.current = controller;
    active.current = true;
    setBusy(true);
    setMessage('Reading the complete original review…');
    try {
      const result = await backupOperation(controller.signal, work);
      if (mounted.current && operation.current === controller && !controller.signal.aborted)
        receive(result);
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'The complete review could not be read or does not match this gateway, project, account and client. Keep the original file; reload the directory or choose another copy. Nothing was sent.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  function load(value: ProposalReviewOriginal | null) {
    if (!value) {
      setMessage(
        'No original was found in that exact browser slot. This does not establish whether a review was sent. Try an exported file or another saved copy.',
      );
      return;
    }
    assertProposalSubmissionBinding(value.binding, binding);
    loaded.current = true;
    setOriginal(value);
  }
  function browse(after: string | null) {
    void run(
      (signal) => listReviewOriginals(binding, after, signal),
      (result) => {
        setPage(result);
        setMessage(
          result.entries.length
            ? 'Choose an original review to inspect its complete decision.'
            : 'No saved reviews on this page for the current account and project.',
        );
      },
    );
  }
  function fromBrowser(selection?: SavedReview) {
    void run(
      (signal) =>
        loadReviewOriginal(binding, selection?.request_key ?? requestKey, signal, selection),
      load,
    );
  }
  if (original) return <OriginalProposalReview original={original} />;
  return (
    <div className="handoff-form" aria-busy={busy} style={{ overflowWrap: 'anywhere' }}>
      <p>
        Account · {binding.identity.actor_id} · Client · {binding.identity.client_id}
      </p>
      <p>
        Project · {binding.identity.project_id} · Gateway · {binding.gateway_url}
      </p>
      <ReviewBackupPanel
        binding={binding}
        disabled={busy}
        begin={beginBackup}
        end={endBackup}
        onStorageChange={storageChanged}
      />
      <div className="heading-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => browse(null)}
        >
          Find saved original reviews
        </button>
        {page?.next && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => browse(page.next)}
          >
            Next saved reviews
          </button>
        )}
      </div>
      {page && (
        <ul>
          {page.entries.map((entry) => (
            <li key={entry.request_key}>
              <p>
                {entry.proposal_id} · {entry.decision} · reviewed revision {entry.expected_revision}{' '}
                · <code>{entry.request_key}</code>
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => fromBrowser(entry)}
              >
                Load original review
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        Original review request key
        <input
          value={requestKey}
          maxLength={255}
          disabled={busy}
          onChange={(event) => {
            if (!active.current) setRequestKey(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || !requestKey}
        onClick={() => fromBrowser()}
      >
        Read original by key
      </button>
      <label>
        Import original review file
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void run(async (_signal, check) => {
              if (file.size < 1 || file.size > REVIEW_ORIGINAL_BYTES) throw new TypeError();
              const bytes = await file.arrayBuffer();
              check();
              if (bytes.byteLength !== file.size || bytes.byteLength > REVIEW_ORIGINAL_BYTES)
                throw new TypeError();
              return decodeReviewOriginal(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
            }, load);
          }}
        />
      </label>
      <label>
        Or paste complete original review JSON
        <textarea
          rows={8}
          value={raw}
          maxLength={REVIEW_ORIGINAL_BYTES}
          disabled={busy}
          onChange={(event) => {
            if (!active.current) setRaw(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || !raw}
        onClick={() => void run(async () => decodeReviewOriginal(raw), load)}
      >
        Review imported original
      </button>
      <p className="muted">
        Saved requests describe the original intent, not its outcome. Browser clearing can remove
        copies. Keep an exported file; unprepared reasons and decisions from older pages cannot be
        reconstructed here.
      </p>
      <p role="status">{message}</p>
    </div>
  );
}
