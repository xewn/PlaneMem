'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { backupOperation } from '../sync/receipt/backup-operation';
import type { BrowserRemovalResult } from '../sync/receipt/browser-store';
import type { ProposalSubmissionBinding } from './original-model';
import {
  parseReviewHistoryQuery,
  REVIEW_HISTORY_PAGE_SIZE,
  REVIEW_HISTORY_SCAN_LIMIT,
  type ReviewHistoryQuery,
} from './review-history-query';
import { ReviewHistoryBackupPanel } from './review-history-backup-panel';
import { ReviewHistoryCleanupPanel } from './review-history-cleanup-panel';
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
  removeReviewHistory,
  saveReviewHistory,
  type ReviewHistoryCandidate,
  type ReviewHistoryPage,
  type ReviewHistorySummary,
} from './review-history-store';

export function ReviewHistoryPanel({
  binding,
  live,
  confirmedLive,
  retainedAutomatic,
  externalStorageEpoch = 0,
  disabled = false,
  begin,
  end,
}: {
  binding: ProposalSubmissionBinding;
  live?: ReviewObservation;
  confirmedLive?: ReviewObservation;
  retainedAutomatic?: ReviewObservation;
  externalStorageEpoch?: number;
  disabled?: boolean;
  begin?: () => boolean;
  end?: () => void;
}) {
  const [selected, setSelected] = useState<{
    value: ReviewHistoryCandidate;
    source: 'live' | 'browser' | 'file';
    epoch: number;
  }>();
  const [removalFresh, setRemovalFresh] = useState(false);
  const [removeConfirmed, setRemoveConfirmed] = useState(false);
  const [removalStatus, setRemovalStatus] = useState<BrowserRemovalResult | 'unknown'>();
  const [page, setPage] = useState<ReviewHistoryPage>();
  const [filters, setFilters] = useState({
    proposal_id: '',
    request_key: '',
    status: '',
    source: '',
  });
  const [digest, setDigest] = useState('');
  const [busy, setBusy] = useState(false);
  const [localStorageEpoch, setStorageEpoch] = useState(0);
  // External writes invalidate eligibility in this render, before the clearing effect runs.
  const storageEpoch = localStorageEpoch + externalStorageEpoch;
  const lastExternalEpoch = useRef(externalStorageEpoch);
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
    setRemoveConfirmed(false);
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
    setRemoveConfirmed(false);
    setRemovalFresh(false);
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
  useEffect(() => {
    if (lastExternalEpoch.current === externalStorageEpoch) return;
    lastExternalEpoch.current = externalStorageEpoch;
    storageChanged();
  }, [externalStorageEpoch, storageChanged]);
  useEffect(() => {
    if (disabled) setRemoveConfirmed(false);
  }, [disabled]);
  async function run<T>(
    work: (signal: AbortSignal, check: () => void) => Promise<T>,
    receive: (value: T) => void,
    options: { start?: () => void; failureMessage?: string } = {},
  ) {
    if (!mounted.current || disabled || operation.current || !beginStorage()) return;
    const controller = new AbortController();
    operation.current = controller;
    try {
      options.start?.();
      const result = await backupOperation(controller.signal, work);
      if (mounted.current && operation.current === controller && !controller.signal.aborted)
        receive(result);
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          options.failureMessage ??
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
    setSelected({ value, source, epoch: storageEpoch });
    setRemovalFresh(source === 'browser');
    setRemoveConfirmed(false);
    setRemovalStatus(undefined);
    setMessage(
      'The complete historical observation is available below for inspection, saving and export. Internal consistency does not prove file authenticity or current proposal state.',
    );
  }
  function clearDirectory() {
    setPage(undefined);
    setRemovalFresh(false);
    setRemoveConfirmed(false);
  }
  function changeFilter(name: keyof typeof filters, value: string) {
    if (active.current || disabled) return;
    setFilters((previous) => ({ ...previous, [name]: value }));
    clearDirectory();
    setMessage(
      'History filters changed. Find saved review history to apply them from the beginning.',
    );
  }
  function browse(continuation: ReviewHistoryQuery | null) {
    void run(
      (signal, check) =>
        listReviewHistory(
          binding,
          parseReviewHistoryQuery(
            continuation ?? {
              proposal_id: filters.proposal_id || null,
              request_key: filters.request_key || null,
              status: filters.status || null,
              source: filters.source || null,
              after: null,
            },
          ),
          signal,
          check,
        ),
      (value) => {
        setPage(value);
        setMessage(
          value.entries.length
            ? 'Choose a matching saved observation to inspect. Entries are ordered by content digest, not time.'
            : value.next
              ? 'No matches in this scan. Continue scanning for later matches with the same filters.'
              : 'No matches in this final scan. Earlier pages and records added since scanning began are not included.',
        );
      },
      {
        start: clearDirectory,
        failureMessage:
          'History search could not be completed. Check the exact proposal ID and request key. Invalid filters, damaged stored records or an expired read stop the whole page; no partial results are shown. Inspected copies are retained.',
      },
    );
  }
  function read(value: string, selection?: ReviewHistorySummary) {
    void run(
      (signal, check) => loadReviewHistory(binding, value, signal, check, selection),
      (item) => inspect(item, 'browser'),
      { start: () => setRemovalFresh(false) },
    );
  }
  const locked = disabled || busy;
  const canRemove =
    selected?.source === 'browser' &&
    selected.epoch === storageEpoch &&
    removalFresh &&
    removalStatus === undefined;
  function remove() {
    if (!selected || !canRemove || !removeConfirmed) return;
    void run(
      (signal, check) => removeReviewHistory(selected.value.raw, binding, signal, check),
      (result) => {
        setRemovalStatus(result);
        setMessage(
          result === 'removed'
            ? 'The inspected history copy was removed from this browser. Its complete retained content remains available below for export. Find saved review history again to refresh the directory.'
            : 'This history copy was absent when checked. This does not prove an earlier removal completed or a review was never recorded. The retained copy remains available for export.',
        );
      },
      {
        start: () => {
          setRemovalStatus('unknown');
          storageChanged();
          setMessage(
            'Rechecking the complete inspected observation before removing its browser copy…',
          );
        },
        failureMessage:
          'Removal could not be confirmed and may already have completed. Keep or export the inspected history. Read and inspect the current browser copy again before another removal attempt. No review was sent or cancelled.',
      },
    );
  }
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
        ...(retainedAutomatic && retainedAutomatic !== live && retainedAutomatic !== confirmedLive
          ? [{ label: 'Retained automatic-save observation', value: retainedAutomatic }]
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
                { start: () => setRemovalFresh(false) },
              )
            }
          >
            Inspect {label.toLowerCase()} for saving
          </button>
        </div>
      ))}
      <fieldset disabled={locked}>
        <legend>Find saved review history</legend>
        <label>
          Proposal ID (exact, optional)
          <input
            value={filters.proposal_id}
            maxLength={26}
            onChange={(event) => changeFilter('proposal_id', event.target.value)}
          />
        </label>
        <label>
          Original request key (exact, optional)
          <input
            value={filters.request_key}
            maxLength={255}
            onChange={(event) => changeFilter('request_key', event.target.value)}
          />
        </label>
        <label>
          Historical result
          <select
            value={filters.status}
            onChange={(event) => changeFilter('status', event.target.value)}
          >
            <option value="">All results</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
            <option value="not-observed">No matching receipt observed</option>
          </select>
        </label>
        <label>
          Response source
          <select
            value={filters.source}
            onChange={(event) => changeFilter('source', event.target.value)}
          >
            <option value="">All sources</option>
            <option value="submission">Review submission</option>
            <option value="receipt-query">Receipt query</option>
          </select>
        </label>
        <p>
          Filters are combined. Each read checks up to {REVIEW_HISTORY_SCAN_LIMIT} saved
          observations and returns up to {REVIEW_HISTORY_PAGE_SIZE} matches. Continue even when a
          scan has no matches. Pages follow content checksums, not time; changes in another page can
          affect later reads.
        </p>
      </fieldset>
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
            Continue history search
          </button>
        )}
      </div>
      {page && (
        <p role="status">
          This scan checked {page.scanned} observations and found {page.entries.length} matches.
          {page.next
            ? ' More stored observations remain to scan.'
            : ' Reached the end of this read.'}
        </p>
      )}
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
              { start: () => setRemovalFresh(false) },
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
          <div className="side-detail" aria-label="Remove inspected browser history copy">
            <h4>Remove this browser history copy</h4>
            <p>
              Export the inspected observation or retain a complete backup before removing it if you
              want to keep its contents. This removes only the matching saved observation from this
              browser. Received results, original reviews, editing drafts, other observations,
              downloaded files and server records remain separate.
            </p>
            {canRemove ? (
              <>
                <label>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={removeConfirmed}
                    onChange={(event) => {
                      if (!active.current && !disabled) setRemoveConfirmed(event.target.checked);
                    }}
                  />{' '}
                  I inspected the complete historical observation and want to remove only this
                  browser copy.
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locked || !removeConfirmed}
                  onClick={remove}
                >
                  Remove inspected browser history copy
                </button>
              </>
            ) : (
              <p>
                {removalStatus === 'removed'
                  ? 'Removal of the inspected history copy was confirmed for that operation.'
                  : removalStatus === 'not-present'
                    ? 'The history copy was absent at the last removal check.'
                    : removalStatus === 'unknown'
                      ? 'Removal is not confirmed. Read and inspect the current browser copy again before another attempt.'
                      : selected.source !== 'browser'
                        ? 'A received result or imported file is not a freshly inspected browser copy. Read the browser copy before removing it.'
                        : 'Storage may have changed or a read failed. Read and inspect the current browser copy again before removing it.'}
              </p>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() => read(selected.value.file.document_sha256)}
            >
              Read this history copy from the browser again
            </button>
            <p>
              Removing local history does not undo a review, cancel a request, clear an unknown
              result or allow a resend. Any retained backup can restore the local copy later.
            </p>
          </div>
          <p>
            A stored or imported file is historical reference. Its checksum detects content changes
            and is not a server signature. Loading or saving it does not confirm current
            permissions, change the proposal, resend the original request or clear an unknown
            outcome on another page.
          </p>
        </div>
      )}
      <ReviewHistoryCleanupPanel
        binding={binding}
        page={page}
        disabled={locked}
        storageEpoch={storageEpoch}
        begin={beginStorage}
        end={endStorage}
        onStorageChange={storageChanged}
      />
      <p>
        History filters limit the directory and its selected-copy actions. The backup below still
        covers all history for this gateway and account.
      </p>
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
