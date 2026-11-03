'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { proposalText } from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import type { BrowserRemovalResult } from '../sync/receipt/browser-store';
import { assertProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';
import { encodeReviewOriginal, type ProposalReviewOriginal } from './review-model';
import { loadReviewOriginal } from './review-store';
import { ReviewEditingBackupPanel } from './review-editing-backup-panel';
import {
  decodeReviewEditingDraft,
  encodeReviewEditingDraft,
  parseReviewEditingDraft,
  REVIEW_EDITING_BYTES,
  type ReviewEditingDraft,
} from './review-editing-model';
import {
  listReviewEditingDrafts,
  loadReviewEditingDraft,
  saveReviewEditingDraft,
  removeReviewEditingDraft,
  type ReviewEditingPage,
  type ReviewEditingSummary,
} from './review-editing-store';

interface ReviewEditor {
  requestKey: string;
  proposalId: string;
  revision: number;
  decision: string;
  reason: string;
  disabled: boolean;
  begin: () => boolean;
  end: () => void;
  onLoad: (draft: ReviewEditingDraft) => void;
  onOriginal: (original: ProposalReviewOriginal) => void;
}
export function ReviewEditingPanel({
  binding,
  editor,
}: {
  binding: ProposalSubmissionBinding;
  editor?: ReviewEditor;
}) {
  const [page, setPage] = useState<ReviewEditingPage>();
  const [reviewed, setReviewed] = useState<{
    draft: ReviewEditingDraft;
    source: 'browser' | 'file';
    epoch: number;
  }>();
  const candidate = reviewed?.draft;
  const [removalFresh, setRemovalFresh] = useState(false);
  const [removeConfirmed, setRemoveConfirmed] = useState(false);
  const [removalStatus, setRemovalStatus] = useState<BrowserRemovalResult | 'unknown'>();
  const [confirmed, setConfirmed] = useState(false);
  const [requestKey, setRequestKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [storageEpoch, setStorageEpoch] = useState(0);
  const [message, setMessage] = useState(
    'Save unfinished reasons separately from prepared reviews. Loading a draft never sends a decision.',
  );
  const retained = useRef<ReviewEditingDraft | undefined>(undefined);
  const mounted = useRef(false);
  const active = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  const parentBegin = editor?.begin;
  const parentEnd = editor?.end;
  const beginStorage = useCallback(() => {
    if (!mounted.current || active.current || (parentBegin && !parentBegin())) return false;
    active.current = true;
    release.current = parentEnd;
    setBusy(true);
    setConfirmed(false);
    setRemoveConfirmed(false);
    return true;
  }, [parentBegin, parentEnd]);
  const endStorage = useCallback(() => {
    active.current = false;
    if (mounted.current) setBusy(false);
    release.current?.();
    release.current = undefined;
  }, []);
  const storageChanged = useCallback(() => {
    if (!mounted.current) return;
    setPage(undefined);
    setConfirmed(false);
    setRemoveConfirmed(false);
    setRemovalFresh(false);
    setStorageEpoch((value) => value + 1);
    setMessage(
      'Saved drafts may have changed. Find saved review drafts again. Current text and inspected copies are retained; compare the backup again before restoring.',
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
    setConfirmed(false);
    setRemoveConfirmed(false);
  }, [editor?.requestKey]);
  const locked = busy || !!editor?.disabled;
  async function run<T>(
    work: (signal: AbortSignal, check: () => void) => Promise<T>,
    receive: (value: T) => void,
    options: { start?: () => void; failureMessage?: string } = {},
  ) {
    if (!mounted.current || locked || operation.current || !beginStorage()) return;
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
            'The draft operation could not be confirmed. Keep your current text, inspected copy or exported file. Different, incomplete or damaged saved copies are never replaced. Nothing was sent.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        endStorage();
      }
    }
  }
  function snapshot() {
    if (!editor) throw new TypeError();
    const draft = parseReviewEditingDraft({
      schema_version: 1,
      kind: 'proposal-review-editing-draft',
      binding,
      request_key: editor.requestKey,
      saved_at:
        retained.current?.request_key === editor.requestKey
          ? retained.current.saved_at
          : new Date().toISOString(),
      proposal_id: editor.proposalId,
      expected_revision: editor.revision,
      decision: editor.decision,
      reason: editor.reason,
    });
    retained.current = draft;
    return draft;
  }
  function inspect(draft: ReviewEditingDraft | null, source: 'browser' | 'file') {
    if (!draft) {
      setPage(undefined);
      setMessage(
        'No draft was found in that browser slot. Any previously inspected copy remains below; no fields were replaced.',
      );
      return;
    }
    assertProposalSubmissionBinding(draft.binding, binding);
    setReviewed({ draft, source, epoch: storageEpoch });
    setRemovalFresh(source === 'browser');
    setRemoveConfirmed(false);
    setRemovalStatus(undefined);
    setMessage(
      'Inspect the complete saved text. Resume requires the same proposal and reviewed revision, and a separate confirmation to replace the current fields.',
    );
  }
  function download(draft: ReviewEditingDraft) {
    const raw = JSON.stringify(decodeReviewEditingDraft(encodeReviewEditingDraft(draft)), null, 2);
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'proposal-review-editing-draft.json';
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
      'Draft download requested. Check that your browser saved the complete file before leaving.',
    );
  }
  function browse(after: string | null) {
    void run(
      (signal) => listReviewEditingDrafts(binding, after, signal),
      (value) => {
        setPage(value);
        setMessage(
          value.entries.length
            ? 'Choose a saved draft to inspect.'
            : 'No saved review drafts on this page for the current gateway and account.',
        );
      },
    );
  }
  function read(key: string, selection?: ReviewEditingSummary) {
    void run(
      (signal) => loadReviewEditingDraft(binding, key, signal, selection),
      (draft) => inspect(draft, 'browser'),
      { start: () => setRemovalFresh(false) },
    );
  }
  const canRemove =
    !!candidate &&
    reviewed?.source === 'browser' &&
    reviewed.epoch === storageEpoch &&
    removalFresh &&
    removalStatus === undefined;
  function remove() {
    if (!candidate || !canRemove || !removeConfirmed) return;
    void run(
      (signal) => removeReviewEditingDraft(binding, candidate, signal),
      (result) => {
        setRemovalStatus(result);
        setMessage(
          result === 'removed'
            ? 'The inspected browser draft was removed. Its retained text remains below for export or explicit resumption. Find saved review drafts again to refresh the directory.'
            : 'This browser draft was absent when checked. This does not prove an earlier removal completed or a review was never sent. The retained copy remains available for export.',
        );
      },
      {
        start: () => {
          setRemovalStatus('unknown');
          storageChanged();
          setMessage('Rechecking the complete inspected draft before removing its browser copy…');
        },
        failureMessage:
          'Removal could not be confirmed and may already have completed. Keep or export the inspected draft. Read and inspect the current browser copy again before another removal attempt. No review was sent.',
      },
    );
  }
  const matching =
    !!editor &&
    !!candidate &&
    candidate.proposal_id === editor.proposalId &&
    candidate.expected_revision === editor.revision;
  function resume() {
    if (!editor || !candidate || !matching || !confirmed) return;
    const selected = decodeReviewEditingDraft(encodeReviewEditingDraft(candidate));
    void run(
      async (signal, check) => {
        assertProposalSubmissionBinding(selected.binding, binding);
        const original = await loadReviewOriginal(binding, selected.request_key, signal);
        check();
        if (original) {
          const expected = encodeReviewOriginal({
            schema_version: 1,
            kind: 'proposal-review-submission',
            binding,
            request_key: selected.request_key,
            proposal_id: selected.proposal_id,
            expected_revision: selected.expected_revision,
            decision: selected.decision,
            reason: proposalText(selected.reason, 'reason', 2000),
          });
          if (encodeReviewOriginal(original) !== expected) throw new TypeError();
        }
        return original;
      },
      (original) => {
        if (original) editor.onOriginal(original);
        else {
          retained.current = selected;
          editor.onLoad(selected);
          setMessage(
            'Draft fields restored without sending or preparing. Review the current content and sources again. Further edits use a new request key.',
          );
        }
      },
    );
  }
  return (
    <section
      aria-label="Save and recover unfinished review drafts"
      aria-busy={busy}
      style={{ overflowWrap: 'anywhere' }}
    >
      <h3>Unfinished review drafts</h3>
      <p>
        Save the decision and reason you are still editing. These copies do not record approval or
        prove that a review was sent. Browser clearing can remove them; keep a separate file.
      </p>
      <ReviewEditingBackupPanel
        binding={binding}
        disabled={locked}
        storageEpoch={storageEpoch}
        begin={beginStorage}
        end={endStorage}
        onStorageChange={storageChanged}
      />
      {editor && (
        <div className="heading-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() =>
              void run(
                async (signal) => saveReviewEditingDraft(snapshot(), signal),
                (saved) => {
                  retained.current = saved;
                  setMessage(
                    'The complete editing draft was saved and read back. Keep an exported file for recovery.',
                  );
                },
                { start: storageChanged },
              )
            }
          >
            Save unfinished review in this browser
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() => void run(async () => snapshot(), download)}
          >
            Export current unfinished review
          </button>
        </div>
      )}
      <div className="heading-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => browse(null)}
        >
          Find saved review drafts
        </button>
        {page?.next && (
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() => browse(page.next)}
          >
            Next review drafts
          </button>
        )}
      </div>
      {page && (
        <ul>
          {page.entries.map((entry) => (
            <li key={entry.request_key}>
              <p>
                {entry.proposal_id} · revision {entry.expected_revision} ·{' '}
                {entry.decision || 'Undecided'} · {entry.saved_at} ·{' '}
                <code>{entry.request_key}</code>
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => read(entry.request_key, entry)}
              >
                Inspect saved review draft
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        Review draft request key
        <input
          value={requestKey}
          maxLength={255}
          disabled={locked}
          onChange={(event) => {
            if (!active.current && !editor?.disabled) setRequestKey(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={locked || !requestKey}
        onClick={() => read(requestKey)}
      >
        Read review draft by key
      </button>
      <label>
        Import unfinished review draft file
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
                if (file.size < 1 || file.size > REVIEW_EDITING_BYTES) throw new TypeError();
                const bytes = await file.arrayBuffer();
                check();
                if (bytes.byteLength !== file.size || bytes.byteLength > REVIEW_EDITING_BYTES)
                  throw new TypeError();
                return decodeReviewEditingDraft(
                  new TextDecoder('utf-8', { fatal: true }).decode(bytes),
                );
              },
              (draft) => inspect(draft, 'file'),
              { start: () => setRemovalFresh(false) },
            );
          }}
        />
      </label>
      {candidate && (
        <div className="side-detail">
          <h4>Inspected unfinished review</h4>
          <p>
            Proposal · {candidate.proposal_id} · reviewed revision {candidate.expected_revision}
          </p>
          <p>
            Decision · {candidate.decision || 'Undecided'} · saved {candidate.saved_at}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{candidate.reason}</pre>
          <p>
            Gateway · {candidate.binding.gateway_url} · project{' '}
            {candidate.binding.identity.project_id}
          </p>
          <p>
            Account · {candidate.binding.identity.actor_id} · client{' '}
            {candidate.binding.identity.client_id}
          </p>
          <p>
            Request key · <code>{candidate.request_key}</code>
          </p>
          <details>
            <summary>Copy the complete inspected draft JSON</summary>
            <textarea
              aria-label="Complete inspected review draft JSON"
              readOnly
              rows={8}
              spellCheck={false}
              value={JSON.stringify(candidate, null, 2)}
            />
          </details>
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() => void run(async () => candidate, download)}
          >
            Export inspected review draft
          </button>
          <div>
            <h4>Remove this browser draft copy</h4>
            <p>
              Export the inspected draft first if you want to keep it. Removing a saved copy keeps
              your current editor, prepared original reviews, other tabs, exported files and
              backups. It does not cancel or withdraw any review. A later explicit save or backup
              restore can save this draft here again.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() => read(candidate.request_key)}
            >
              Read current browser draft again
            </button>
            {canRemove ? (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={removeConfirmed}
                    disabled={locked}
                    onChange={(event) => {
                      if (!active.current && !editor?.disabled && canRemove)
                        setRemoveConfirmed(event.target.checked);
                    }}
                  />{' '}
                  I inspected the complete draft and want to remove only this saved browser copy.
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locked || !removeConfirmed}
                  onClick={remove}
                >
                  Remove inspected browser draft
                </button>
              </>
            ) : (
              <p role="status">
                {removalStatus === 'removed'
                  ? 'Removal of the inspected draft was confirmed for that operation.'
                  : removalStatus === 'not-present'
                    ? 'The draft was not present at the last check.'
                    : removalStatus === 'unknown'
                      ? 'Removal is not confirmed. Read and inspect the current browser draft again before another attempt.'
                      : reviewed?.source === 'file'
                        ? 'An imported file does not authorize browser deletion. Read and inspect the current browser copy first.'
                        : 'Storage may have changed or a read failed. Read and inspect the current browser draft again before removing it.'}
              </p>
            )}
          </div>
          <Link
            href={'/proposals?status=all&proposal=' + encodeURIComponent(candidate.proposal_id)}
            prefetch={false}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open current proposal and review form ↗
          </Link>
          {matching ? (
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={locked}
                  onChange={(event) => {
                    if (!active.current && !editor?.disabled) setConfirmed(event.target.checked);
                  }}
                />{' '}
                I inspected this draft and want to replace the current review fields. If this same
                review is already prepared, open its fixed original instead.
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={locked || !confirmed}
                onClick={resume}
              >
                Resume inspected review draft
              </button>
            </div>
          ) : (
            <p>
              Open this proposal, then inspect the draft in its review form to resume. A changed
              revision or completed review cannot be resumed from this editing copy. Keep or export
              the text for reference.
            </p>
          )}
        </div>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
