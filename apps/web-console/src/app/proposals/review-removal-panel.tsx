'use client';

import { useEffect, useRef, useState } from 'react';
import { backupOperation } from '../sync/receipt/backup-operation';
import type { BrowserRemovalResult } from '../sync/receipt/browser-store';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';
import {
  decodeReviewOriginal,
  encodeReviewOriginal,
  type ProposalReviewOriginal,
} from './review-model';
import { removeReviewOriginal } from './review-store';

export function ReviewRemovalPanel({
  binding,
  original,
  disabled,
  canRemove,
  begin,
  end,
  onStorageChange,
  onReload,
}: {
  binding: ProposalSubmissionBinding;
  original: ProposalReviewOriginal;
  disabled: boolean;
  canRemove: boolean;
  begin: () => boolean;
  end: () => void;
  onStorageChange: () => void;
  onReload: () => void;
}) {
  const [request] = useState(() => {
    const saved = decodeReviewOriginal(encodeReviewOriginal(original));
    assertProposalSubmissionBinding(saved.binding, binding);
    return saved;
  });
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<BrowserRemovalResult | 'unknown'>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Inspect the complete saved decision below. Export a separate copy before removing it if you need to retain it.',
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
    if (!canRemove) setConfirmed(false);
  }, [canRemove]);
  async function run(action: 'remove' | 'download') {
    if (!mounted.current || disabled || operation.current) return;
    if (action === 'remove' && (!canRemove || !confirmed || outcome !== undefined)) return;
    if (!begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    const current = () =>
      mounted.current && operation.current === controller && !controller.signal.aborted;
    try {
      if (action === 'remove') {
        setConfirmed(false);
        setOutcome('unknown');
        onStorageChange();
        setMessage('Rechecking the complete original before removing this browser copy…');
        const result = await backupOperation(controller.signal, (signal) =>
          removeReviewOriginal(binding, request, signal),
        );
        if (!current()) return;
        setOutcome(result);
        setMessage(
          result === 'removed'
            ? 'The inspected browser copy was removed. The complete retained copy below is still available to export. Refresh the directory for current saved entries.'
            : 'This exact browser copy was absent when checked. This does not establish whether an earlier removal completed. The retained copy below is still available to export.',
        );
      } else {
        const raw = JSON.stringify(request, null, 2);
        const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = 'proposal-review-original.json';
          document.body.append(link);
          try {
            link.click();
          } finally {
            link.remove();
          }
          setMessage(
            'Original review download requested. Check that your browser saved the complete file.',
          );
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    } catch {
      if (current())
        setMessage(
          action === 'remove'
            ? 'Removal could not be confirmed. Keep or export the complete retained copy. Read and inspect the current browser copy again before another removal attempt.'
            : 'The download could not be started. The complete original remains below for copying.',
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
  return (
    <section
      className="side-detail"
      aria-label="Inspect and remove one saved review"
      aria-busy={busy}
      style={{ overflowWrap: 'anywhere' }}
    >
      <h3>Inspected browser review copy</h3>
      <p>
        Proposal · {request.proposal_id} · reviewed revision {request.expected_revision}
      </p>
      <p>Original decision · {request.decision === 'confirm' ? 'Confirm as reviewed' : 'Reject'}</p>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{request.reason}</pre>
      <p>Gateway · {request.binding.gateway_url}</p>
      <p>Project · {request.binding.identity.project_id}</p>
      <p>
        Account · {request.binding.identity.actor_id} · Client ·{' '}
        {request.binding.identity.client_id}
      </p>
      <p>
        Original request key · <code>{request.request_key}</code>
      </p>
      <details>
        <summary>Copy the complete retained original JSON</summary>
        <textarea rows={10} readOnly spellCheck={false} value={JSON.stringify(request, null, 2)} />
      </details>
      <div className="heading-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => void run('download')}
        >
          Export inspected original review
        </button>
        <button type="button" className="secondary-button" disabled={locked} onClick={onReload}>
          Read current browser copy again
        </button>
      </div>
      {outcome === undefined && canRemove ? (
        <div>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={locked}
              onChange={(event) => {
                if (!operation.current && !disabled && canRemove)
                  setConfirmed(event.target.checked);
              }}
            />{' '}
            I inspected this original decision and want to remove only its saved copy from this
            browser.
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={locked || !confirmed}
            onClick={() => void run('remove')}
          >
            Remove inspected browser copy
          </button>
        </div>
      ) : (
        <p>
          {outcome === 'removed'
            ? 'Removal of the inspected copy was confirmed for that operation.'
            : outcome === 'not-present'
              ? 'The copy was not present at the last check.'
              : outcome === 'unknown'
                ? 'Removal is not confirmed. Read the current copy again before another attempt.'
                : 'Storage may have changed. Read and inspect the current browser copy again before removing it.'}
        </p>
      )}
      <p className="muted">
        Removing a local copy does not cancel an in-flight review or withdraw a recorded decision.
        Other tabs, files, backups and server receipts are kept. This action sends no review and
        queries no receipt. A later explicit save, import or send can save the original here again.
      </p>
      <p role="status">{message}</p>
    </section>
  );
}
