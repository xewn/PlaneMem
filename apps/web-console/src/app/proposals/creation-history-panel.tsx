'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { backupOperation } from '../sync/receipt/backup-operation';
import type { BrowserRemovalResult } from '../sync/receipt/browser-store';
import { encodeProposalOriginal, type ProposalSubmissionBinding } from './original-model';
import {
  CREATION_HISTORY_FILE_BYTES,
  creationRecordedReceipt,
  creationObservationStatus,
  type CreationObservation,
} from './creation-history-model';
import {
  inspectCreationHistory,
  prepareCreationHistory,
  type CreationHistoryCandidate,
} from './creation-history-file';
import {
  listCreationHistory,
  loadCreationHistory,
  saveCreationHistory,
  removeCreationHistory,
  type CreationHistoryPage,
  type CreationHistorySummary,
} from './creation-history-store';
import {
  CREATION_HISTORY_SCAN_LIMIT,
  parseCreationHistoryQuery,
  type CreationHistoryQuery,
} from './creation-history-query';
import { CreationHistoryBackupPanel } from './creation-history-backup-panel';
import { CreationHistoryCleanupPanel } from './creation-history-cleanup-panel';
import { subscribeCreationHistoryChanges } from './creation-history-changes';

export function CreationHistoryPanel({
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
  live?: CreationObservation;
  confirmedLive?: CreationObservation;
  retainedAutomatic?: CreationObservation;
  externalStorageEpoch?: number;
  disabled?: boolean;
  begin?: () => boolean;
  end?: () => void;
}) {
  const [selected, setSelected] = useState<{
    candidate: CreationHistoryCandidate;
    source: 'received' | 'file' | 'browser';
    epoch: number;
  }>();
  const [page, setPage] = useState<CreationHistoryPage>();
  const [filters, setFilters] = useState({
    proposal_id: '',
    request_key: '',
    status: '',
    source: '',
  });
  const [digest, setDigest] = useState('');
  const [localStorageEpoch, setStorageEpoch] = useState(0);
  const storageGeneration = useRef(0);
  const getStorageGeneration = useCallback(() => storageGeneration.current, []);
  // Revoke old qualifications in this render, before the effect clears the visible directory.
  const storageEpoch = localStorageEpoch + externalStorageEpoch;
  const lastExternalEpoch = useRef(externalStorageEpoch);
  const [removalFresh, setRemovalFresh] = useState(false);
  const [removeConfirmed, setRemoveConfirmed] = useState(false);
  const [removalStatus, setRemovalStatus] = useState<BrowserRemovalResult | 'unknown'>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Find a saved browser observation, inspect a received result or import a complete file. History copies do not update this page’s submission result.',
  );
  const mounted = useRef(false);
  const active = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  const beginStorage = useCallback(() => {
    if (
      !mounted.current ||
      active.current ||
      storageGeneration.current !== localStorageEpoch ||
      (begin && !begin())
    )
      return false;
    active.current = true;
    release.current = end;
    setBusy(true);
    setRemoveConfirmed(false);
    return true;
  }, [begin, end, localStorageEpoch]);
  const endStorage = useCallback(() => {
    active.current = false;
    if (mounted.current) setBusy(false);
    release.current?.();
    release.current = undefined;
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
    if (disabled) setRemoveConfirmed(false);
  }, [disabled]);
  const storageChanged = useCallback(() => {
    if (!mounted.current) return;
    storageGeneration.current += 1;
    setStorageEpoch(storageGeneration.current);
    setPage(undefined);
    setRemovalFresh(false);
    setRemoveConfirmed(false);
  }, []);
  useEffect(() => {
    if (lastExternalEpoch.current === externalStorageEpoch) return;
    lastExternalEpoch.current = externalStorageEpoch;
    storageChanged();
    setMessage(
      'Browser history may have changed. Find saved creation history again, and compare a retained backup again before restoring. Received results and inspected copies are retained.',
    );
  }, [externalStorageEpoch, storageChanged]);
  useEffect(() => {
    const invalidate = () => {
      if (!mounted.current) return;
      storageChanged();
      setMessage(
        'Saved history may have changed. Refresh the directory and inspect or compare again before removing or restoring copies. Retained files and received results are unchanged.',
      );
    };
    const unsubscribe = subscribeCreationHistoryChanges(binding, invalidate);
    const visible = () => {
      if (document.visibilityState === 'visible') invalidate();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) invalidate();
    };
    window.addEventListener('focus', invalidate);
    window.addEventListener('pageshow', restored);
    document.addEventListener('visibilitychange', visible);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', invalidate);
      window.removeEventListener('pageshow', restored);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [binding, storageChanged]);
  async function run<T>(
    work: (signal: AbortSignal, check: () => void) => Promise<T>,
    receive: (value: T) => void,
    options: {
      start?: () => void;
      failureMessage?: string;
      requireUnchangedStorage?: boolean;
    } = {},
  ) {
    if (!mounted.current || disabled || operation.current || !beginStorage()) return;
    const controller = new AbortController();
    operation.current = controller;
    try {
      options.start?.();
      const generation = getStorageGeneration();
      const candidate = await backupOperation(controller.signal, work);
      if (mounted.current && operation.current === controller && !controller.signal.aborted) {
        if (options.requireUnchangedStorage && generation !== getStorageGeneration()) {
          setMessage(
            'Saved history may have changed during this read. Its result was not applied. Refresh the directory or read the copy again; the previous inspected copy is retained.',
          );
          return;
        }
        receive(candidate);
      }
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          options.failureMessage ??
            'The history operation could not be confirmed. Keep the source file and any retained observation; the inspected copy remains available. No proposal was submitted. Existing damaged or different copies are never replaced.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        endStorage();
      }
    }
  }
  function inspect(
    candidate: CreationHistoryCandidate | null,
    source: 'received' | 'file' | 'browser',
  ) {
    if (!candidate) {
      setPage(undefined);
      setRemovalFresh(false);
      setMessage(
        'No complete history copy was found at that checksum. Any previously inspected copy is retained; missing local history does not establish a submission outcome.',
      );
      return;
    }
    setSelected({ candidate, source, epoch: storageEpoch });
    setRemovalFresh(source === 'browser');
    setRemoveConfirmed(false);
    setRemovalStatus(undefined);
    setMessage(
      'The complete historical observation is available for inspection and export. Its checksum establishes internal consistency, not authenticity or the proposal’s current state.',
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
      'History filters changed. Find saved creation history to search from the beginning.',
    );
  }
  function browse(continuation: CreationHistoryQuery | null) {
    void run(
      (signal, check) =>
        listCreationHistory(
          binding,
          parseCreationHistoryQuery(
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
            ? 'Choose a matching creation observation to inspect. Entries follow content checksums, not time; pages are separate reads.'
            : value.next
              ? 'No matches in this scan. Continue searching for later matches with the same filters.'
              : 'No matches in this final scan. Earlier pages and records added since searching began are not included.',
        );
      },
      {
        start: clearDirectory,
        requireUnchangedStorage: true,
        failureMessage:
          'History search could not be completed. Check the exact proposal ID and request key. Invalid filters, damaged stored records or an expired read stop the whole page; no partial results are shown. Inspected copies are retained.',
      },
    );
  }
  function read(value: string, entry?: CreationHistorySummary) {
    void run(
      (signal, check) => loadCreationHistory(binding, value, signal, check, entry),
      (candidate) => inspect(candidate, 'browser'),
      { start: () => setRemovalFresh(false), requireUnchangedStorage: true },
    );
  }
  function save() {
    if (!selected) return;
    void run(
      (signal, check) => saveCreationHistory(selected.candidate.raw, binding, signal, check),
      () => {
        setMessage(
          'The complete history copy was saved, read back and committed in this browser. Find saved history again to refresh the directory. Saving does not confirm a submission or change its observation time.',
        );
      },
      {
        start: storageChanged,
        failureMessage:
          'Browser history saving could not be confirmed and may already have completed. Keep or export the inspected copy; retrying the same content preserves its original time and response. Damaged or different copies are never replaced.',
      },
    );
  }
  const canRemove =
    selected?.source === 'browser' &&
    selected.epoch === storageEpoch &&
    removalFresh &&
    removalStatus === undefined;
  function remove() {
    if (!selected || !canRemove || !removeConfirmed) return;
    void run(
      (signal, check) => removeCreationHistory(selected.candidate.raw, binding, signal, check),
      (result) => {
        setRemovalStatus(result);
        setMessage(
          result === 'removed'
            ? 'The inspected creation history copy was removed from this browser. Its complete retained content remains available for export. No original request or proposal was removed.'
            : 'This history copy was absent when checked. The retained content is still available for export; this does not prove whether an earlier removal completed.',
        );
      },
      {
        start: () => {
          storageChanged();
          setRemovalStatus('unknown');
        },
        failureMessage:
          'History removal could not be confirmed and may already have completed. Keep or export the inspected copy. Read the browser copy again before another removal attempt. No proposal was cancelled.',
      },
    );
  }
  function download(originalOnly: boolean) {
    if (!selected) return;
    void run(
      (_signal, check) => inspectCreationHistory(selected.candidate.raw, binding, check),
      (candidate) => {
        const raw = originalOnly
          ? encodeProposalOriginal(candidate.file.document.original)
          : candidate.raw;
        const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = originalOnly
            ? 'proposal-original.json'
            : 'proposal-creation-history.json';
          document.body.append(link);
          try {
            link.click();
          } finally {
            link.remove();
          }
          setMessage(
            originalOnly
              ? 'Original request download requested. Check that it was saved, then use the original request recovery page to explicitly check its receipt. Extraction does not send or save a proposal.'
              : 'History file download requested. Check that the complete file was saved before leaving this page. The original observation time and response are unchanged.',
          );
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      },
    );
  }
  const locked = disabled || busy;
  const observation = selected?.candidate.file.document;
  const recorded = observation ? creationRecordedReceipt(observation) : undefined;
  return (
    <section
      className="side-detail"
      aria-label="Creation history"
      aria-busy={busy}
      style={{ overflowWrap: 'anywhere' }}
    >
      <h3>Creation history</h3>
      <p>
        Keep the complete original request and received response together. Inspect a result, then
        explicitly save it in this browser or export a separate file. Browser clearing can remove
        saved history. Importing does not save browser copies, query the gateway or send a proposal.
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
            {label} · {creationObservationStatus(value)} · {value.observed_at}
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() =>
              void run(
                (_signal, check) => prepareCreationHistory(value, check),
                (candidate) => inspect(candidate, 'received'),
                { start: () => setRemovalFresh(false) },
              )
            }
          >
            Inspect {label.toLowerCase()} for saving or export
          </button>
        </div>
      ))}
      <fieldset disabled={locked}>
        <legend>Filter saved creation history</legend>
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
            <option value="recorded">Creation recorded</option>
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
            <option value="submission">Creation submission</option>
            <option value="receipt-query">Receipt query</option>
          </select>
        </label>
        <p>
          Filters are combined. Each search checks up to {CREATION_HISTORY_SCAN_LIMIT} saved
          observations and shows the matches. Continue even when a scan has no matches. A result
          with no matching receipt has no proposal ID; leave that filter empty to find it.
        </p>
      </fieldset>
      <div className="heading-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => browse(null)}
        >
          Find saved creation history
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
      <p>
        Pages follow content checksums, not observation time. Each page is a separate read; newly
        saved or removed copies can affect later results. Find saved creation history starts again
        from the beginning.
      </p>
      {page && (
        <p role="status">
          This scan checked {page.scanned} observations and found {page.entries.length} matches.
          {page.next
            ? ' More saved observations remain to search.'
            : ' Reached the end of this read.'}
        </p>
      )}
      {page && (
        <ul>
          {page.entries.map((entry) => (
            <li key={entry.digest}>
              <p>
                {entry.proposal_id ?? 'No proposal observed'} · {entry.status} · {entry.source} ·
                observed {entry.observed_at} · request <code>{entry.request_key}</code>
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => read(entry.digest, entry)}
              >
                Inspect saved creation observation
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
            if (!active.current && !disabled) {
              setDigest(event.target.value);
              setRemovalFresh(false);
              setRemoveConfirmed(false);
            }
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
        Import complete creation history file
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
                check();
                if (file.size < 1 || file.size > CREATION_HISTORY_FILE_BYTES) throw new TypeError();
                const bytes = await file.arrayBuffer();
                check();
                if (
                  bytes.byteLength !== file.size ||
                  bytes.byteLength > CREATION_HISTORY_FILE_BYTES
                )
                  throw new TypeError();
                return inspectCreationHistory(
                  new TextDecoder('utf-8', { fatal: true }).decode(bytes),
                  binding,
                  check,
                );
              },
              (candidate) => inspect(candidate, 'file'),
              { start: () => setRemovalFresh(false) },
            );
          }}
        />
      </label>
      {selected && observation && (
        <div>
          <h4>Inspected creation observation</h4>
          <p>
            Loaded from ·{' '}
            {selected.source === 'received'
              ? 'this page’s received response'
              : selected.source === 'browser'
                ? 'browser storage'
                : 'an imported file'}
          </p>
          <p>
            {creationObservationStatus(observation)} · {observation.source} · observed{' '}
            {observation.observed_at}
          </p>
          {recorded ? (
            <p>
              Original proposal · {recorded.proposal_id} · revision {recorded.revision} · event{' '}
              {recorded.event_id} · occurred {recorded.occurred_at} · cursor{' '}
              {recorded.server_cursor}. This is a historical creation result, not the current
              proposal state.
            </p>
          ) : (
            <p>
              No matching receipt was observed in this historical read. This does not prove failure,
              cancel a submission or authorize a new one.
            </p>
          )}
          <p>
            Gateway · {observation.original.binding.gateway_url} · project{' '}
            {observation.original.binding.identity.project_id}
          </p>
          <p>
            Account · {observation.original.binding.identity.actor_id} · client{' '}
            {observation.original.binding.identity.client_id}
          </p>
          <p>
            Original request key · <code>{observation.original.request_key}</code> · trace{' '}
            <code>{observation.receipt.trace_id}</code>
          </p>
          <p>
            Content checksum · <code>{selected.candidate.file.document_sha256}</code>
          </p>
          <details>
            <summary>Inspect or copy the complete original request and response</summary>
            <textarea readOnly rows={16} spellCheck={false} value={selected.candidate.raw} />
          </details>
          <div className="heading-actions">
            <button type="button" className="secondary-button" disabled={locked} onClick={save}>
              Save inspected creation history in this browser
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() => download(false)}
            >
              Export inspected creation history
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() => download(true)}
            >
              Export its original request
            </button>
          </div>
          <p>
            Only a freshly read browser copy can be removed. Files and received results must be
            saved and read back through the browser entry first. Removal keeps the inspected content
            available for export and does not cancel a proposal or delete its original request.
          </p>
          <label>
            <input
              type="checkbox"
              checked={removeConfirmed}
              disabled={locked || !canRemove}
              onChange={(event) => {
                if (!active.current && !disabled && canRemove)
                  setRemoveConfirmed(event.target.checked);
              }}
            />{' '}
            I reviewed this complete browser history copy and want to remove it from this browser.
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={locked || !canRemove || !removeConfirmed}
            onClick={remove}
          >
            Remove inspected browser history copy
          </button>
          {removalStatus && (
            <p role="status">
              Removal result · {removalStatus}. Read the browser copy again before another removal
              attempt.
            </p>
          )}
        </div>
      )}
      <p role="status">{message}</p>
      <CreationHistoryCleanupPanel
        binding={binding}
        page={page}
        disabled={locked}
        storageEpoch={storageEpoch}
        begin={beginStorage}
        end={endStorage}
        onStorageChange={storageChanged}
        getStorageGeneration={getStorageGeneration}
      />
      <p>
        Filters apply to this directory and its selected-copy actions. The backup below includes all
        saved creation history for the current gateway and account, regardless of these filters.
      </p>
      <CreationHistoryBackupPanel
        binding={binding}
        disabled={locked}
        storageEpoch={storageEpoch}
        begin={beginStorage}
        end={endStorage}
        onStorageChange={storageChanged}
        getStorageGeneration={getStorageGeneration}
      />
      <p className="muted">
        This page clears old history confirmations when it hears about a storage attempt or regains
        focus. Messages can be missed; refresh before acting. Notifications never load or change
        history, and every removal or restore still checks the stored contents again.
      </p>
      <Link href="/proposals/recover" prefetch={false} target="_blank" rel="noopener noreferrer">
        Open original request recovery ↗
      </Link>
    </section>
  );
}
