'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProposalSubmissionBinding } from '../original-model';
import type { ProposalBackupComparison } from '../original-store';
import {
  loadProposalBackup,
  prepareProposalBackup,
  previewProposalBackup,
  restoreProposalBackup,
  type ReviewedProposalBackup,
} from '../original-backup';

export function ProposalBackupPanel({
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
  const [reviewed, setReviewed] = useState<ReviewedProposalBackup>();
  const [comparison, setComparison] = useState<{
    digest: string;
    epoch: number;
    value: ProposalBackupComparison;
  }>();
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'A backup contains complete request content for this gateway and identity. It does not contain submission receipts or old tab-only copies.',
  );
  useEffect(() => {
    setComparison(undefined);
    setConfirmed(null);
  }, [storageEpoch]);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      if (operation.current) {
        operation.current.abort();
        operation.current = undefined;
        end();
      }
    },
    [end],
  );

  async function run(action: 'prepare' | 'load' | 'compare' | 'restore', source?: File) {
    if (disabled || operation.current) return;
    if (action === 'load' && !source) return;
    if ((action === 'compare' || action === 'restore') && !reviewed) return;
    if (
      action === 'restore' &&
      (!comparison ||
        comparison.epoch !== storageEpoch ||
        comparison.digest !== reviewed?.file.document_sha256 ||
        confirmed !== comparison.digest ||
        !comparison.value.can_restore ||
        comparison.value.total === 0)
    )
      return;
    if (!begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setConfirmed(null);
    setComparison(undefined);
    setMessage(
      action === 'restore'
        ? 'Checking every original before saving missing browser copies…'
        : 'Reading and verifying the complete backup…',
    );
    try {
      if (action === 'prepare' || action === 'load') {
        const result =
          action === 'prepare'
            ? await prepareProposalBackup(binding, controller.signal)
            : await loadProposalBackup(source!, binding, controller.signal);
        if (operation.current !== controller) return;
        setReviewed(result);
        setMessage(
          action === 'prepare'
            ? 'The complete scoped backup is ready. Download it and check that your browser saved the file.'
            : 'The complete backup and its checksum match this gateway and identity. Compare it with this browser before restoring.',
        );
      } else if (action === 'compare') {
        const result = await previewProposalBackup(reviewed!.raw, binding, controller.signal);
        if (operation.current !== controller) return;
        setReviewed(result);
        setComparison({
          digest: result.file.document_sha256,
          epoch: storageEpoch,
          value: result.comparison,
        });
        setMessage(
          result.comparison.can_restore
            ? 'Comparison complete. Only missing copies will be added after confirmation. The target is checked again during import.'
            : 'Different or unreadable existing copies block the entire import. Keep both sources; nothing was replaced.',
        );
      } else {
        onStorageChange();
        const result = await restoreProposalBackup(
          reviewed!.raw,
          binding,
          reviewed!.file.document_sha256,
          controller.signal,
        );
        if (operation.current !== controller) return;
        setMessage(
          `Browser import confirmed: ${result.added} added, ${result.already_present} already present. Reload the saved request list to find them. No proposal was submitted.`,
        );
      }
    } catch {
      if (operation.current !== controller) return;
      setMessage(
        action === 'restore'
          ? 'The import outcome could not be confirmed. Keep the retained backup and original file. Compare again before an explicit retry; no proposal was submitted.'
          : 'The complete backup or comparison could not be read. Check its size, identity and saved data. Any previously retained backup is still available; no import or submission was started.',
      );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        setBusy(false);
        end();
      }
    }
  }
  function download() {
    if (!reviewed || disabled || operation.current || !begin()) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([reviewed.raw], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'proposal-originals-backup.json';
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setMessage(
        'Backup download requested. Check that the complete file was saved, and keep it with the same care as its most sensitive request.',
      );
    } catch {
      setComparison(undefined);
      setConfirmed(null);
      setMessage(
        'The backup download could not be started. The retained backup remains available on this page.',
      );
    } finally {
      if (url) {
        const savedUrl = url;
        setTimeout(() => URL.revokeObjectURL(savedUrl), 1000);
      }
      end();
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
      <summary>Back up or restore saved requests</summary>
      <div className="handoff-form" aria-busy={busy} style={{ overflowWrap: 'anywhere' }}>
        <p>
          Back up every saved browser request for this gateway, project, account and client. The
          limit is 100 requests and a 16 MiB document; larger collections fail without producing a
          partial backup. Save old tab-only copies separately first.
        </p>
        <p>
          Files exported from selected requests contain only that subset. Comparison and restoration
          cover the listed requests and still check old tab copies for conflicts.
        </p>
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => void run('prepare')}
        >
          Prepare complete browser backup
        </button>
        <label>
          Load a complete backup file
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
            <p>Retained backup · {reviewed.file.document.entries.length} requests</p>
            <p>Gateway · {reviewed.file.document.binding.gateway_url}</p>
            <p>Project · {reviewed.file.document.binding.identity.project_id}</p>
            <p>
              Account · {reviewed.file.document.binding.identity.actor_id} · Client ·{' '}
              {reviewed.file.document.binding.identity.client_id}
            </p>
            <p>
              Checksum · <code>{reviewed.file.document_sha256}</code>
            </p>
            <details>
              <summary>Review requests included in this backup</summary>
              <ul>
                {reviewed.file.document.entries.map((entry) => (
                  <li key={entry.request_key}>
                    {entry.draft.title} · {entry.draft.kind} · {entry.draft.classification} ·{' '}
                    <code>{entry.request_key}</code>
                  </li>
                ))}
              </ul>
            </details>
            <div className="heading-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={download}
              >
                Download retained backup
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => void run('compare')}
              >
                Compare with this browser
              </button>
            </div>
          </>
        )}
        {matching && (
          <>
            <p>
              {matching.missing} missing · {matching.same} identical · {matching.different}{' '}
              different · {matching.blocked} unreadable or blocked
            </p>
            <details>
              <summary>Review comparison for every request</summary>
              <ul>
                {matching.entries.map((entry) => (
                  <li key={entry.request_key}>
                    {entry.title} · <code>{entry.request_key}</code> · {entry.state}
                  </li>
                ))}
              </ul>
            </details>
            {matching.can_restore && matching.total > 0 && (
              <>
                <label className="context-archive-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed === reviewed?.file.document_sha256}
                    disabled={locked}
                    onChange={(event) => {
                      if (!operation.current)
                        setConfirmed(event.target.checked ? reviewed!.file.document_sha256 : null);
                    }}
                  />
                  I reviewed this backup and comparison. Add only its missing local copies.
                </label>
                <button
                  type="button"
                  className="primary-button"
                  disabled={locked || confirmed !== reviewed?.file.document_sha256}
                  onClick={() => void run('restore')}
                >
                  Restore missing browser copies
                </button>
              </>
            )}
          </>
        )}
        <p className="muted">
          Loading and comparing do not save or submit requests. Importing preserves matching copies
          and rejects conflicting ones; it never submits proposals. A checksum detects content
          changes, not the source or truth of the requests. Keep the original file if an import is
          interrupted.
        </p>
        <p role="status">{message}</p>
      </div>
    </details>
  );
}
