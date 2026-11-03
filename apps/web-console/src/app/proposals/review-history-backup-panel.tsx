'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProposalSubmissionBinding } from './original-model';
import type { ReviewHistoryBackupComparison } from './review-history-store';
import { reviewHistoryFileJson, reviewObservationStatus } from './review-history-model';
import {
  compareReviewHistoryArchive,
  inspectReviewHistoryArchive,
  loadReviewHistoryArchive,
  prepareReviewHistoryArchive,
  restoreReviewHistoryArchive,
  type ReviewHistoryBackupCandidate,
} from './review-history-backup';

export function ReviewHistoryBackupPanel({
  binding,
  disabled,
  storageEpoch,
  begin,
  end,
  onStorageChange,
}: {
  binding: ProposalSubmissionBinding;
  disabled: boolean;
  storageEpoch: number;
  begin: () => boolean;
  end: () => void;
  onStorageChange: () => void;
}) {
  const [reviewed, setReviewed] = useState<ReviewHistoryBackupCandidate>();
  const [comparison, setComparison] = useState<{
    digest: string;
    epoch: number;
    value: ReviewHistoryBackupComparison;
  }>();
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const observationFiles = useMemo(
    () =>
      reviewed?.file.document.entries.map((file) => ({ file, raw: reviewHistoryFileJson(file) })) ??
      [],
    [reviewed],
  );
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (operation.current) {
        operation.current.abort();
        operation.current = undefined;
        end();
      }
    };
  }, [end]);
  useEffect(() => {
    setConfirmed(null);
    setComparison(undefined);
  }, [storageEpoch]);

  async function run(
    action: 'prepare' | 'load' | 'compare' | 'restore' | 'download',
    source?: File,
  ) {
    if (disabled || operation.current || !mounted.current) return;
    if (action === 'load' && !source) return;
    if (['compare', 'restore', 'download'].includes(action) && !reviewed) return;
    if (
      action === 'restore' &&
      (!comparison?.value.can_restore ||
        !comparison.value.entries.length ||
        comparison.epoch !== storageEpoch ||
        comparison.digest !== reviewed?.file.document_sha256 ||
        confirmed !== comparison.digest)
    )
      return;
    if (!begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    const isCurrent = () =>
      mounted.current && operation.current === controller && !controller.signal.aborted;
    if (action !== 'download') {
      setConfirmed(null);
      setComparison(undefined);
      setMessage(
        action === 'restore'
          ? 'Checking every historical observation before restoring missing copies…'
          : 'Reading and checking the complete review history backup…',
      );
    }
    try {
      if (action === 'prepare' || action === 'load') {
        const result =
          action === 'prepare'
            ? await prepareReviewHistoryArchive(binding, controller.signal)
            : await loadReviewHistoryArchive(source!, binding, controller.signal);
        if (!isCurrent()) return;
        setReviewed(result);
        setMessage(
          action === 'prepare'
            ? 'The complete saved review history backup is ready to download. Save any received result in the history panel first if you want it included.'
            : 'The review history backup matches this gateway and account. Compare it with this browser before restoring.',
        );
      } else if (action === 'compare') {
        const result = await compareReviewHistoryArchive(reviewed!.raw, binding, controller.signal);
        if (!isCurrent()) return;
        setReviewed({ file: result.file, raw: result.raw });
        setComparison({
          digest: result.file.document_sha256,
          epoch: storageEpoch,
          value: result.comparison,
        });
        setMessage(
          'Comparison completed without saving. Restore checks every copy again; any changed or damaged copy blocks the whole import.',
        );
      } else if (action === 'restore') {
        onStorageChange();
        const result = await restoreReviewHistoryArchive(
          reviewed!.raw,
          binding,
          comparison!.digest,
          controller.signal,
        );
        if (!isCurrent()) return;
        setMessage(
          `Restore confirmed: ${result.added} historical observations added, ${result.already_present} identical copies kept. Use Find saved review history to inspect a copy. No review was sent.`,
        );
      } else {
        const result = await inspectReviewHistoryArchive(reviewed!.raw, binding, controller.signal);
        if (!isCurrent()) return;
        const url = URL.createObjectURL(new Blob([result.raw], { type: 'application/json' }));
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = 'proposal-review-history-backup.json';
          document.body.append(link);
          try {
            link.click();
          } finally {
            link.remove();
          }
          setMessage(
            'Backup download requested. Check that your browser saved the complete file before leaving.',
          );
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    } catch {
      if (isCurrent())
        setMessage(
          action === 'restore'
            ? 'Restore could not be confirmed and may already have completed. Keep the retained backup, compare again, then explicitly decide whether to restore. No review was sent by this import.'
            : 'The operation could not be confirmed. Any previously reviewed backup remains available below. Keep the source file and check the backup scope, size and contents.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (mounted.current) setBusy(false);
        end();
      }
    }
  }
  const locked = disabled || busy;
  const matching =
    reviewed &&
    comparison &&
    comparison.epoch === storageEpoch &&
    comparison.digest === reviewed.file.document_sha256
      ? comparison.value
      : undefined;
  return (
    <details className="side-detail">
      <summary>Back up or restore all saved review history</summary>
      <div aria-busy={busy} style={{ overflowWrap: 'anywhere' }}>
        <p>
          Back up all saved review history for this gateway, project, account and client. Save each
          received result in the history panel first if you want it included. Up to 100 observations
          and a 16 MiB document are supported; larger collections are rejected as a whole.
        </p>
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => void run('prepare')}
        >
          Prepare complete review history backup
        </button>
        <label>
          Load a review history backup file
          <input
            type="file"
            accept="application/json,.json"
            disabled={locked}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void run('load', file);
            }}
          />
        </label>
        {reviewed && (
          <>
            <p>
              Retained review history backup · {reviewed.file.document.entries.length} observations
            </p>
            <p>Gateway · {reviewed.file.document.binding.gateway_url}</p>
            <p>Project · {reviewed.file.document.binding.identity.project_id}</p>
            <p>
              Account · {reviewed.file.document.binding.identity.actor_id} · Client ·{' '}
              {reviewed.file.document.binding.identity.client_id}
            </p>
            <details>
              <summary>Inspect included original requests and historical receipts</summary>
              <ul>
                {observationFiles.map(({ file: entry, raw }) => (
                  <li key={entry.document_sha256}>
                    <details>
                      <summary>
                        {entry.document.original.proposal_id} ·{' '}
                        {reviewObservationStatus(entry.document)} · {entry.document.source} ·
                        observed {entry.document.observed_at}
                      </summary>
                      <p>
                        Original decision · {entry.document.original.decision} · reviewed revision{' '}
                        {entry.document.original.expected_revision} · request{' '}
                        <code>{entry.document.original.request_key}</code>
                      </p>
                      <pre style={{ whiteSpace: 'pre-wrap' }}>{entry.document.original.reason}</pre>
                      <p>
                        Trace · <code>{entry.document.receipt.trace_id}</code> · checksum{' '}
                        <code>{entry.document_sha256}</code>
                      </p>
                      <textarea
                        aria-label="Complete backed up review observation"
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
                Content checksum · <code>{reviewed.file.document_sha256}</code>
              </p>
            </details>
            <div className="heading-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => void run('download')}
              >
                Download retained review history backup
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => void run('compare')}
              >
                Compare with saved review history
              </button>
            </div>
          </>
        )}
        {matching && (
          <>
            <p>
              {matching.missing} missing · {matching.same} identical · {matching.different}{' '}
              different
            </p>
            <details>
              <summary>Review every comparison</summary>
              <ul>
                {matching.entries.map((entry) => (
                  <li key={entry.digest}>
                    {entry.proposal_id} · {entry.status} · {entry.source} · observed{' '}
                    {entry.observed_at} · request <code>{entry.request_key}</code> · checksum{' '}
                    <code>{entry.digest}</code> · {entry.state}
                  </li>
                ))}
              </ul>
            </details>
            {matching.different > 0 && (
              <p>
                Some browser copies contain different content at the same checksum. This is a
                conflict or damaged content; the entire restore is blocked and cannot overwrite
                them.
              </p>
            )}
            {matching.can_restore && matching.entries.length > 0 && (
              <>
                <label>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={confirmed === comparison!.digest}
                    onChange={(event) => {
                      if (!operation.current && !disabled)
                        setConfirmed(event.target.checked ? comparison!.digest : null);
                    }}
                  />{' '}
                  I inspected the historical observations and comparison. Add only the missing local
                  copies.
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locked || confirmed !== comparison!.digest}
                  onClick={() => void run('restore')}
                >
                  Restore missing review history copies
                </button>
              </>
            )}
          </>
        )}
        <p className="muted">
          The backup contains saved historical observations with their complete original requests
          and receipts. It does not copy the separate original-request or editing-draft libraries.
          Loading and comparing do not save anything. Restoring adds missing history copies without
          querying or sending a review, changing its current state or clearing another page's
          unknown outcome. Checksums validate internal consistency, not server authenticity. A
          historical not-observed result does not establish failure or authorize a resend. Unsaved
          observations are not included.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
