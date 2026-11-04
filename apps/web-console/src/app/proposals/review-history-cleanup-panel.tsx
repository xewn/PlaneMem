'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProposalSubmissionBinding } from './original-model';
import { reviewHistoryFileJson, reviewObservationStatus } from './review-history-model';
import {
  REVIEW_HISTORY_SELECTION_MAX_ENTRIES,
  type ReviewHistoryPage,
} from './review-history-store';
import {
  inspectReviewHistoryArchive,
  prepareReviewHistorySelection,
  removeReviewedHistorySelection,
  type ReviewHistoryBackupCandidate,
} from './review-history-backup';

export function ReviewHistoryCleanupPanel({
  binding,
  page,
  disabled,
  storageEpoch,
  begin,
  end,
  onStorageChange,
  getStorageGeneration,
}: {
  binding: ProposalSubmissionBinding;
  page: ReviewHistoryPage | undefined;
  disabled: boolean;
  storageEpoch: number;
  begin: () => boolean;
  end: () => void;
  onStorageChange: () => void;
  getStorageGeneration: () => number;
}) {
  const [selection, setSelection] = useState<{ page: ReviewHistoryPage; digests: string[] }>();
  const [reviewed, setReviewed] = useState<{
    candidate: ReviewHistoryBackupCandidate;
    page: ReviewHistoryPage;
    epoch: number;
    selectionKey: string;
  }>();
  const [fresh, setFresh] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  const chosen = selection?.page === page ? (selection?.digests ?? []) : [];
  const selectionKey = JSON.stringify(chosen);
  const current =
    !!reviewed &&
    fresh &&
    reviewed.page === page &&
    reviewed.epoch === storageEpoch &&
    reviewed.selectionKey === selectionKey;
  const files = useMemo(
    () =>
      reviewed?.candidate.file.document.entries.map((file) => ({
        file,
        raw: reviewHistoryFileJson(file),
      })) ?? [],
    [reviewed],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (operation.current) {
        operation.current.abort();
        operation.current = undefined;
        release.current?.();
        release.current = undefined;
      }
    };
  }, []);
  useEffect(() => {
    setFresh(false);
    setConfirmed(null);
    setSelection(undefined);
  }, [page, storageEpoch]);
  useEffect(() => {
    if (disabled) setConfirmed(null);
  }, [disabled]);

  function select(digest: string, checked: boolean) {
    if (
      !page ||
      disabled ||
      operation.current ||
      !page.entries.some((entry) => entry.digest === digest)
    )
      return;
    const next = new Set(chosen);
    if (checked) next.add(digest);
    else next.delete(digest);
    if (next.size > REVIEW_HISTORY_SELECTION_MAX_ENTRIES) return;
    setSelection({ page, digests: [...next].sort() });
    setFresh(false);
    setConfirmed(null);
  }
  function selectPage(checked: boolean) {
    if (
      !page ||
      disabled ||
      operation.current ||
      page.entries.length > REVIEW_HISTORY_SELECTION_MAX_ENTRIES
    )
      return;
    setSelection({
      page,
      digests: checked ? page.entries.map((entry) => entry.digest).sort() : [],
    });
    setFresh(false);
    setConfirmed(null);
  }
  async function run(action: 'inspect' | 'export' | 'remove') {
    if (disabled || operation.current || !mounted.current) return;
    if (action === 'inspect' && (!page || !chosen.length)) return;
    if ((action === 'export' || action === 'remove') && !reviewed) return;
    if (action === 'remove' && (!current || confirmed !== reviewed?.candidate.file.document_sha256))
      return;
    if (!begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    release.current = end;
    const generation = getStorageGeneration();
    setBusy(true);
    setConfirmed(null);
    if (action !== 'export') setFresh(false);
    const isCurrent = () =>
      mounted.current && operation.current === controller && !controller.signal.aborted;
    try {
      if (action === 'inspect') {
        setMessage('Reading every selected observation and verifying its complete contents…');
        const rows = page!.entries.filter((entry) => chosen.includes(entry.digest));
        if (rows.length !== chosen.length) throw new TypeError();
        const candidate = await prepareReviewHistorySelection(binding, rows, controller.signal);
        if (!isCurrent()) return;
        setReviewed({ candidate, page: page!, epoch: storageEpoch, selectionKey });
        if (generation !== getStorageGeneration()) {
          setMessage(
            'Saved history may have changed during this inspection. The complete subset is retained for export. Refresh the directory, select and inspect the current copies again before removal.',
          );
          return;
        }
        setFresh(true);
        setMessage(
          'Inspect every selected observation below. You can export this selected subset before deciding whether to remove its browser copies.',
        );
      } else if (action === 'export') {
        const candidate = await inspectReviewHistoryArchive(
          reviewed!.candidate.raw,
          binding,
          controller.signal,
        );
        if (!isCurrent()) return;
        const url = URL.createObjectURL(new Blob([candidate.raw], { type: 'application/json' }));
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = 'proposal-review-history-selected-backup.json';
          document.body.append(link);
          try {
            link.click();
          } finally {
            link.remove();
          }
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        setMessage(
          'Selected history download requested. This file contains only the inspected subset, not all saved history. Check that the complete file was saved; the history backup panel can import it for recovery.',
        );
      } else {
        onStorageChange();
        setMessage(
          'Rechecking all inspected observations before removing the matching browser copies…',
        );
        const result = await removeReviewedHistorySelection(
          reviewed!.candidate.raw,
          binding,
          reviewed!.candidate.file.document_sha256,
          controller.signal,
        );
        if (!isCurrent()) return;
        setMessage(
          `Removal check completed: ${result.removed} browser copies removed, ${result.not_present} already absent. Absence does not prove an earlier removal completed. The inspected subset remains available for export. Find saved review history again before any further removal.`,
        );
      }
    } catch {
      if (isCurrent())
        setMessage(
          action === 'remove'
            ? 'Removal could not be confirmed and may already have completed. Keep or export the retained subset. Find saved review history, select and inspect the current copies again before another removal attempt.'
            : 'The selection operation could not be confirmed. Any retained subset remains available for export. Refresh the directory and inspect the current selection again; no history was removed by this read or export.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (mounted.current) setBusy(false);
        release.current?.();
        release.current = undefined;
      }
    }
  }
  const locked = disabled || busy;
  return (
    <details className="side-detail">
      <summary>Inspect and remove selected history copies</summary>
      <div aria-busy={busy} style={{ overflowWrap: 'anywhere' }}>
        <p>
          Select up to {REVIEW_HISTORY_SELECTION_MAX_ENTRIES} observations from the current
          directory page. Read and inspect their full contents before confirming removal. Other
          pages and unselected observations are not included.
        </p>
        {!page?.entries.length && <p>Use Find saved review history to load a directory page.</p>}
        {page && page.entries.length > 0 && (
          <>
            <div className="heading-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => selectPage(true)}
              >
                Select this directory page
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={locked || !chosen.length}
                onClick={() => selectPage(false)}
              >
                Clear selection
              </button>
            </div>
            <ul>
              {page.entries.map((entry) => (
                <li key={entry.digest}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={chosen.includes(entry.digest)}
                      onChange={(event) => select(entry.digest, event.target.checked)}
                    />{' '}
                    {entry.proposal_id} · {entry.status} · {entry.source} · observed{' '}
                    {entry.observed_at} · <code>{entry.digest}</code>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          type="button"
          className="secondary-button"
          disabled={locked || !chosen.length}
          onClick={() => void run('inspect')}
        >
          Read and inspect selected history ({chosen.length})
        </button>
        {reviewed && (
          <>
            <h4>Retained inspected subset · {files.length} observations</h4>
            <p>
              Gateway · {reviewed.candidate.file.document.binding.gateway_url} · project{' '}
              {reviewed.candidate.file.document.binding.identity.project_id} · account{' '}
              {reviewed.candidate.file.document.binding.identity.actor_id} · client{' '}
              {reviewed.candidate.file.document.binding.identity.client_id}
            </p>
            <ul>
              {files.map(({ file, raw }) => (
                <li key={file.document_sha256}>
                  <details>
                    <summary>
                      {file.document.original.proposal_id} ·{' '}
                      {reviewObservationStatus(file.document)} · {file.document.source} · observed{' '}
                      {file.document.observed_at}
                    </summary>
                    <p>
                      Decision · {file.document.original.decision} · reviewed revision{' '}
                      {file.document.original.expected_revision} · request{' '}
                      <code>{file.document.original.request_key}</code>
                    </p>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{file.document.original.reason}</pre>
                    <p>
                      Trace · <code>{file.document.receipt.trace_id}</code> · checksum{' '}
                      <code>{file.document_sha256}</code>
                    </p>
                    <textarea
                      aria-label="Complete observation selected for removal"
                      rows={10}
                      readOnly
                      spellCheck={false}
                      value={raw}
                    />
                  </details>
                </li>
              ))}
            </ul>
            <p>
              Subset checksum · <code>{reviewed.candidate.file.document_sha256}</code>
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() => void run('export')}
            >
              Export inspected subset for recovery
            </button>
            {current ? (
              <>
                <label>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={confirmed === reviewed.candidate.file.document_sha256}
                    onChange={(event) => {
                      if (!disabled && !operation.current)
                        setConfirmed(
                          event.target.checked ? reviewed.candidate.file.document_sha256 : null,
                        );
                    }}
                  />{' '}
                  I inspected all {files.length} observations and want to remove only their browser
                  history copies.
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locked || confirmed !== reviewed.candidate.file.document_sha256}
                  onClick={() => void run('remove')}
                >
                  Remove inspected history copies
                </button>
              </>
            ) : (
              <p>
                This retained subset is available for export. Select and read current browser
                entries again before confirming removal.
              </p>
            )}
          </>
        )}
        <p>
          All selected copies are rechecked together. Any changed or damaged copy blocks the entire
          removal. Copies already absent are reported separately. Removing history does not undo
          reviews, cancel requests, clear unknown outcomes or change original requests, drafts,
          downloaded files or server records.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
