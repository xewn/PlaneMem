'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { backupOperation } from '../sync/receipt/backup-operation';
import type { ProposalSubmissionBinding } from './original-model';
import { ReviewHistoryBackupPanel } from './review-history-backup-panel';
import {
  REVIEW_HISTORY_FILE_BYTES,
  reviewObservationStatus,
  type ReviewObservation,
} from './review-history-model';
import {
  inspectReviewHistory,
  listReviewHistory,
  loadReviewHistory,
  prepareReviewHistory,
  saveReviewHistory,
  type ReviewHistoryCandidate,
  type ReviewHistoryPage,
  type ReviewHistorySummary,
} from './review-history-store';

export function ReviewHistoryPanel({
  binding,
  live,
  confirmedLive,
  disabled = false,
  begin,
  end,
}: {
  binding: ProposalSubmissionBinding;
  live?: ReviewObservation;
  confirmedLive?: ReviewObservation;
  disabled?: boolean;
  begin?: () => boolean;
  end?: () => void;
}) {
  const [selected, setSelected] = useState<{
    value: ReviewHistoryCandidate;
    source: 'live' | 'browser' | 'file';
  }>();
  const [page, setPage] = useState<ReviewHistoryPage>();
  const [digest, setDigest] = useState('');
  const [busy, setBusy] = useState(false);
  const [storageEpoch, setStorageEpoch] = useState(0);
  const [message, setMessage] = useState(
    'Save complete historical observations explicitly. Loading a history copy does not query the gateway or send a review.',
  );
  const mounted = useRef(false);
  const active = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  const beginStorage = useCallback(() => {
    if (!mounted.current || active.current || (begin && !begin())) return false;
    active.current = true;
    release.current = end;
    setBusy(true);
    return true;
  }, [begin, end]);
  const endStorage = useCallback(() => {
    active.current = false;
    if (mounted.current) setBusy(false);
    release.current?.();
    release.current = undefined;
  }, []);
  const storageChanged = useCallback(() => {
    if (!mounted.current) return;
    setPage(undefined);
    setStorageEpoch((value) => value + 1);
    setMessage(
      'Saved history may have changed. Find saved review history again; compare any retained backup again before restoring. Received results and inspected copies are retained.',
    );
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
      active.current = false;
      release.current?.();
      release.current = undefined;
    };
  }, []);
  async function run<T>(
    work: (signal: AbortSignal, check: () => void) => Promise<T>,
    receive: (value: T) => void,
  ) {
    if (!mounted.current || disabled || operation.current || !beginStorage()) return;
    const controller = new AbortController();
    operation.current = controller;
    try {
      const result = await backupOperation(controller.signal, work);
      if (mounted.current && operation.current === controller && !controller.signal.aborted)
        receive(result);
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'The history operation could not be confirmed. Keep the received result, inspected copy or source file. Browser copies with conflicting or damaged content are never replaced. No review was sent.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        endStorage();
      }
    }
  }
  function inspect(value: ReviewHistoryCandidate | null, source: 'live' | 'browser' | 'file') {
    if (!value) {
      setPage(undefined);
      setMessage(
        'No history copy was found at that digest. This does not establish whether a review was sent or completed. Any inspected copy is retained below.',
      );
      return;
    }
    setSelected({ value, source });
    setMessage(
      'The complete historical observation is available below for inspection, saving and export. Internal consistency does not prove file authenticity or current proposal state.',
    );
  }
  function browse(after: string | null) {
    void run(
      (signal, check) => listReviewHistory(binding, after, signal, check),
      (value) => {
        setPage(value);
        setMessage(
          value.entries.length
            ? 'Choose a saved observation to inspect. Entries are ordered by content digest, not time.'
            : 'No saved review history on this page for the current gateway and account.',
        );
      },
    );
  }
  function read(value: string, selection?: ReviewHistorySummary) {
    void run(
      (signal, check) => loadReviewHistory(binding, value, signal, check, selection),
      (item) => inspect(item, 'browser'),
    );
  }
  const locked = disabled || busy;
  const document = selected?.value.file.document;
  const historical =
    document?.source === 'submission'
      ? { ...document.receipt.data, server_cursor: document.receipt.server_cursor }
      : document?.receipt.data.status === 'recorded'
        ? document.receipt.data.receipt
        : undefined;
  return (
    <section
      className="side-detail"
      aria-label="Historical review receipts"
      aria-busy={busy}
      style={{ overflowWrap: 'anywhere' }}
    >
      <h3>Historical review receipts</h3>
      <p>
        Keep the complete original request together with each received result. Browser clearing can
        remove saved history; export a separate file. These records do not establish the proposal's
        current state.
      </p>
      {[
        ...(live ? [{ label: 'Latest received result', value: live }] : []),
        ...(confirmedLive && confirmedLive !== live
          ? [{ label: 'Retained confirmed result', value: confirmedLive }]
          : []),
      ].map(({ label, value }) => (
        <div key={label}>
          <p>
            {label} · {value.observed_at} · {reviewObservationStatus(value)}
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() =>
              void run(
                (_signal, check) => prepareReviewHistory(value, check),
                (value) => inspect(value, 'live'),
              )
            }
          >
            Inspect {label.toLowerCase()} for saving
          </button>
        </div>
      ))}
      <div className="heading-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => browse(null)}
        >
          Find saved review history
        </button>
        {page?.next && (
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() => browse(page.next)}
          >
            Next history entries
          </button>
        )}
      </div>
      {page && (
        <ul>
          {page.entries.map((entry) => (
            <li key={entry.digest}>
              <p>
                {entry.proposal_id} · {entry.status} · {entry.source} · observed {entry.observed_at}{' '}
                · request <code>{entry.request_key}</code>
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => read(entry.digest, entry)}
              >
                Inspect saved observation
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        History content checksum
        <input
          value={digest}
          maxLength={64}
          disabled={locked}
          onChange={(event) => {
            if (!active.current && !disabled) setDigest(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={locked || !/^[a-f0-9]{64}$/.test(digest)}
        onClick={() => read(digest)}
      >
        Read history by checksum
      </button>
      <label>
        Import review history file
        <input
          type="file"
          accept="application/json,.json"
          disabled={locked}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void run(
              async (_signal, check) => {
                if (file.size < 1 || file.size > REVIEW_HISTORY_FILE_BYTES) throw new TypeError();
                const bytes = await file.arrayBuffer();
                check();
                if (bytes.byteLength !== file.size || bytes.byteLength > REVIEW_HISTORY_FILE_BYTES)
                  throw new TypeError();
                return inspectReviewHistory(
                  new TextDecoder('utf-8', { fatal: true }).decode(bytes),
                  binding,
                  check,
                );
              },
              (value) => inspect(value, 'file'),
            );
          }}
        />
      </label>
      {selected && document && (
        <div>
          <h4>Inspected historical observation</h4>
          <p>
            Loaded from ·{' '}
            {selected.source === 'live'
              ? 'this page’s received result'
              : selected.source === 'file'
                ? 'an imported file'
                : 'browser storage'}
          </p>
          <p>
            Historical result · {reviewObservationStatus(document)} · response path{' '}
            {document.source} · observed {document.observed_at}
          </p>
          {historical && (
            <p>
              Recorded event · {historical.event_id} · revision {historical.revision} · occurred{' '}
              {historical.occurred_at} · server cursor {historical.server_cursor}
            </p>
          )}
          {reviewObservationStatus(document) === 'not-observed' && (
            <p>
              No matching receipt was observed in this historical read. It does not prove failure,
              cancel an in-flight request or authorize another send.
            </p>
          )}
          <p>
            Proposal · {document.original.proposal_id} · reviewed revision{' '}
            {document.original.expected_revision} · decision {document.original.decision}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{document.original.reason}</pre>
          <p>
            Gateway · {document.original.binding.gateway_url} · project{' '}
            {document.original.binding.identity.project_id}
          </p>
          <p>
            Account · {document.original.binding.identity.actor_id} · client{' '}
            {document.original.binding.identity.client_id}
          </p>
          <p>
            Request key · <code>{document.original.request_key}</code> · trace{' '}
            <code>{document.receipt.trace_id}</code>
          </p>
          <p>
            Content checksum · <code>{selected.value.file.document_sha256}</code>
          </p>
          <details>
            <summary>Inspect or copy the full original request and receipt</summary>
            <textarea
              aria-label="Complete historical review observation"
              rows={14}
              readOnly
              spellCheck={false}
              value={selected.value.raw}
            />
          </details>
          <div className="heading-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() =>
                void run(
                  async (signal, check) => {
                    storageChanged();
                    return saveReviewHistory(selected.value.raw, binding, signal, check);
                  },
                  () =>
                    setMessage(
                      'The complete history copy was saved and read back. This confirms local storage only; keep an exported file for recovery.',
                    ),
                )
              }
            >
              Save inspected history in this browser
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() =>
                void run(
                  async (_signal, check) =>
                    inspectReviewHistory(selected.value.raw, binding, check),
                  (value) => {
                    const url = URL.createObjectURL(
                      new Blob([value.raw], { type: 'application/json' }),
                    );
                    try {
                      const link = window.document.createElement('a');
                      link.href = url;
                      link.download = 'proposal-review-history.json';
                      window.document.body.append(link);
                      try {
                        link.click();
                      } finally {
                        link.remove();
                      }
                    } finally {
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }
                    setMessage(
                      'History download requested. Check that your browser saved the complete file before leaving.',
                    );
                  },
                )
              }
            >
              Export inspected history
            </button>
            <Link
              href={
                '/proposals?status=all&proposal=' +
                encodeURIComponent(document.original.proposal_id)
              }
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open current proposal ↗
            </Link>
          </div>
          <p>
            A stored or imported file is historical reference. Its checksum detects content changes
            and is not a server signature. Loading or saving it does not confirm current
            permissions, change the proposal, resend the original request or clear an unknown
            outcome on another page.
          </p>
        </div>
      )}
      <ReviewHistoryBackupPanel
        binding={binding}
        disabled={locked}
        storageEpoch={storageEpoch}
        begin={beginStorage}
        end={endStorage}
        onStorageChange={storageChanged}
      />
      <p role="status">{message}</p>
    </section>
  );
}
