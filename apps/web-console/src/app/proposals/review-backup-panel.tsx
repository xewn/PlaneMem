'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProposalSubmissionBinding } from './original-model';
import type { ReviewBackupComparison } from './review-store';
import {
  compareReviewOriginalsBackup,
  loadReviewOriginalsBackup,
  prepareReviewOriginalsBackup,
  restoreReviewOriginalsBackup,
  type ReviewBackupCandidate,
} from './review-backup';

export function ReviewBackupPanel({
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
  const [reviewed, setReviewed] = useState<ReviewBackupCandidate>();
  const [comparison, setComparison] = useState<{
    digest: string;
    epoch: number;
    value: ReviewBackupComparison;
  }>();
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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
    setComparison(undefined);
    setConfirmed(null);
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
        comparison.epoch !== storageEpoch ||
        !comparison.value.entries.length ||
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
          ? 'Checking all original reviews before restoring missing copies…'
          : 'Reading and checking the complete review backup…',
      );
    }
    try {
      if (action === 'prepare' || action === 'load') {
        const result =
          action === 'prepare'
            ? await prepareReviewOriginalsBackup(binding, controller.signal)
            : await loadReviewOriginalsBackup(source!, binding, controller.signal);
        if (!isCurrent()) return;
        setReviewed(result);
        setMessage(
          action === 'prepare'
            ? 'The complete saved-review backup is ready to download. Unsaved decisions and historical receipts are not included.'
            : 'The review backup matches this gateway and account. Compare it with this browser before restoring.',
        );
      } else if (action === 'compare') {
        const result = await compareReviewOriginalsBackup(
          reviewed!.raw,
          binding,
          controller.signal,
        );
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
        const result = await restoreReviewOriginalsBackup(
          reviewed!.raw,
          binding,
          comparison!.digest,
          controller.signal,
        );
        if (!isCurrent()) return;
        setMessage(
          `Restore confirmed: ${result.added} reviews added, ${result.already_present} identical copies kept. Use Find saved original reviews to choose a copy. No review was sent.`,
        );
      } else {
        const url = URL.createObjectURL(new Blob([reviewed!.raw], { type: 'application/json' }));
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = 'proposal-review-originals-backup.json';
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
      <summary>Back up or restore all saved original reviews</summary>
      <div aria-busy={busy} style={{ overflowWrap: 'anywhere' }}>
        <p>
          Back up all saved original reviews for this gateway, project, account and client. Save
          your original review first if you want it included. Up to 100 requests and a 4 MiB
          document are supported; larger collections are rejected as a whole.
        </p>
        <p>
          Files exported from a selected group contain only that subset. Comparison and restoration
          cover only the original reviews listed in the file.
        </p>
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => void run('prepare')}
        >
          Prepare complete review backup
        </button>
        <label>
          Load an original review backup file
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
            <p>Retained review backup · {reviewed.file.document.entries.length} requests</p>
            <p>Gateway · {reviewed.file.document.binding.gateway_url}</p>
            <p>Project · {reviewed.file.document.binding.identity.project_id}</p>
            <p>
              Account · {reviewed.file.document.binding.identity.actor_id} · Client ·{' '}
              {reviewed.file.document.binding.identity.client_id}
            </p>
            <details>
              <summary>Inspect included decisions and reasons</summary>
              <ul>
                {reviewed.file.document.entries.map((entry) => (
                  <li key={entry.request_key}>
                    <details>
                      <summary>
                        {entry.proposal_id} · {entry.decision} · reviewed revision{' '}
                        {entry.expected_revision} · <code>{entry.request_key}</code>
                      </summary>
                      <pre style={{ whiteSpace: 'pre-wrap' }}>{entry.reason}</pre>
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
                Download retained review backup
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => void run('compare')}
              >
                Compare with saved reviews
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
                  <li key={entry.request_key}>
                    {entry.proposal_id} · {entry.decision} · reviewed revision{' '}
                    {entry.expected_revision} · <code>{entry.request_key}</code> · {entry.state}
                  </li>
                ))}
              </ul>
            </details>
            {matching.different > 0 && (
              <p>
                Some copies differ in their original decision, reason, revision or proposal. Review
                them individually; this backup cannot overwrite them.
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
                      if (!operation.current)
                        setConfirmed(event.target.checked ? comparison!.digest : null);
                    }}
                  />{' '}
                  I inspected the original decisions and comparison. Add only the missing copies.
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locked || confirmed !== comparison!.digest}
                  onClick={() => void run('restore')}
                >
                  Restore missing review copies
                </button>
              </>
            )}
          </>
        )}
        <p className="muted">
          This backup contains complete saved text, including sensitive local copies. Keep the
          downloaded file accordingly. Only saved original reviews are included; unfinished input,
          creation requests, editing drafts and receipts are separate. Loading and comparing do not
          save anything. Restoring adds missing local copies without sending or querying a review.
          The checksum detects content changes; it does not prove who created the file or whether
          any review was sent or recorded.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
