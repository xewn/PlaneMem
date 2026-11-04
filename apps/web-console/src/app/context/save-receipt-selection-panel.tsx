'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PackSaveBinding } from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import type { PackReceiptBackupCandidate } from './save-receipt-backup-model';
import {
  PACK_RECEIPT_SELECTION_MAX_ENTRIES,
  inspectPackReceiptBackup,
  preparePackReceiptSelection,
  removePackReceiptBackup,
  type PackReceiptCandidate,
  type PackReceiptHistoryPage,
} from './save-receipt-store';

interface Selection {
  page: PackReceiptHistoryPage;
  digests: string[];
}
interface ReviewedSelection {
  candidate: PackReceiptBackupCandidate;
  page: PackReceiptHistoryPage;
  selectionKey: string;
  reviewGeneration: number;
  storageGeneration: number;
}
const confirmationKey = (review: ReviewedSelection) =>
  JSON.stringify([review.candidate.file.document_sha256, review.reviewGeneration]);

function download(candidate: PackReceiptBackupCandidate) {
  const url = URL.createObjectURL(new Blob([candidate.raw], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = `context-pack-history-selection-${candidate.file.document_sha256}.json`;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function PackReceiptSelectionPanel({
  binding,
  page,
  disabled,
  reviewGeneration,
  storageGeneration,
  getReviewGeneration,
  getStorageGeneration,
  begin,
  end,
  onSelectionChange,
  onHistoryWrite,
  onReview,
}: {
  binding: PackSaveBinding;
  page: PackReceiptHistoryPage | undefined;
  disabled: boolean;
  reviewGeneration: number;
  storageGeneration: number;
  getReviewGeneration: () => number;
  getStorageGeneration: () => number;
  begin: () => boolean;
  end: () => void;
  onSelectionChange: () => void;
  onHistoryWrite: () => void;
  onReview: (entry: PackReceiptCandidate) => void;
}) {
  const [selection, setSelection] = useState<Selection>();
  const selectionRef = useRef<Selection | undefined>(undefined);
  const [review, setReview] = useState<ReviewedSelection>();
  const reviewRef = useRef<ReviewedSelection | undefined>(undefined);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const confirmedRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Select observations on this page, then inspect the complete selected copies.',
  );
  const active = useRef(false);
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  const chosen = selection?.page === page ? (selection?.digests ?? []) : [];
  const selectionKey = JSON.stringify(chosen);
  const ready =
    !!review &&
    review.page === page &&
    review.selectionKey === selectionKey &&
    review.reviewGeneration === reviewGeneration &&
    review.storageGeneration === storageGeneration;
  const files = useMemo(
    () =>
      review?.candidate.file.document.entries.map((file) => ({
        file,
        raw: JSON.stringify(file, null, 2),
      })) ?? [],
    [review?.candidate],
  );

  function clearConfirmation() {
    confirmedRef.current = null;
    setConfirmed(null);
  }
  function retain(next: ReviewedSelection) {
    reviewRef.current = next;
    setReview(next);
  }
  function currentReview() {
    const captured = reviewRef.current;
    const selected = selectionRef.current;
    return captured &&
      selected &&
      captured.page === page &&
      selected.page === page &&
      captured.selectionKey === JSON.stringify(selected.digests) &&
      captured.reviewGeneration === getReviewGeneration() &&
      captured.storageGeneration === getStorageGeneration()
      ? captured
      : undefined;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      release.current?.();
      release.current = undefined;
    };
  }, []);
  useEffect(() => {
    confirmedRef.current = null;
    setConfirmed(null);
  }, [page, disabled, reviewGeneration, storageGeneration]);

  function select(digests: string[]) {
    if (!page || active.current || disabled || getReviewGeneration() !== reviewGeneration) return;
    const next = [...new Set(digests)].sort();
    if (
      next.length > PACK_RECEIPT_SELECTION_MAX_ENTRIES ||
      next.some((digest) => !page.entries.some((entry) => entry.file.document_sha256 === digest))
    )
      return;
    clearConfirmation();
    const value = { page, digests: next };
    selectionRef.current = value;
    setSelection(value);
    onSelectionChange();
    setMessage(
      'Selection changed. Inspect the selected copies before removal. Any earlier reviewed subset remains available for export.',
    );
  }
  function toggle(digest: string, checked: boolean) {
    const selected = selectionRef.current;
    const previous = selected && selected.page === page ? selected.digests : [];
    select(checked ? [...previous, digest] : previous.filter((value) => value !== digest));
  }

  async function run(kind: 'inspect' | 'export' | 'remove') {
    if (!mounted.current || active.current || disabled) return;
    const selected = selectionRef.current;
    const captured = reviewRef.current;
    const eligible = currentReview();
    if (
      kind === 'inspect' &&
      (!page || !selected || selected.page !== page || !selected.digests.length)
    )
      return;
    if (kind !== 'inspect' && !captured) return;
    if (kind === 'remove' && (!eligible || confirmedRef.current !== confirmationKey(eligible)))
      return;
    if (!begin()) return;
    const startedReview = getReviewGeneration();
    const startedStorage = getStorageGeneration();
    const controller = new AbortController();
    operation.current = controller;
    release.current = end;
    active.current = true;
    setBusy(true);
    clearConfirmation();
    setMessage(
      kind === 'inspect'
        ? 'Reading and checking every selected copy. Any earlier reviewed subset is retained.'
        : kind === 'export'
          ? 'Checking the complete reviewed subset before requesting its download.'
          : 'Checking all reviewed copies before removal and reading back their absence.',
    );
    try {
      if (kind === 'remove') {
        try {
          onHistoryWrite();
        } catch {
          /* Storage outcome is independent of notification. */
        }
      }
      const result = await backupOperation(controller.signal, async (signal, check) => {
        if (kind === 'inspect') {
          if (!page || !selected || selected.page !== page) throw new TypeError();
          const entries = page.entries.filter((entry) =>
            selected.digests.includes(entry.file.document_sha256),
          );
          if (entries.length !== selected.digests.length) throw new TypeError();
          return {
            kind: 'inspected' as const,
            candidate: await preparePackReceiptSelection(
              entries.map((entry) => entry.raw),
              binding,
              signal,
              check,
            ),
          };
        }
        if (!captured) throw new TypeError();
        if (kind === 'export')
          return {
            kind: 'exported' as const,
            candidate: await inspectPackReceiptBackup(captured.candidate.raw, binding, check),
          };
        return {
          kind: 'removed' as const,
          result: await removePackReceiptBackup(
            captured.candidate.raw,
            binding,
            captured.candidate.file.document.entries.map((entry) => entry.document_sha256),
            signal,
            check,
          ),
        };
      });
      if (!mounted.current || operation.current !== controller) return;
      if (controller.signal.aborted) throw new TypeError();
      const unchanged =
        startedReview === getReviewGeneration() && startedStorage === getStorageGeneration();
      if (result.kind === 'inspected') {
        retain({
          candidate: result.candidate,
          page: page!,
          selectionKey: JSON.stringify(selected!.digests),
          reviewGeneration: startedReview,
          storageGeneration: startedStorage,
        });
        setMessage(
          unchanged
            ? 'Every selected copy was read in full and checked. Review the complete observations below, export this subset, then confirm any removal separately.'
            : 'History may have changed during inspection. The complete subset is retained for export; read the directory again and inspect a new selection before removal.',
        );
      } else if (result.kind === 'exported') {
        download(result.candidate);
        // Export can keep the same reviewed selection eligible, but always revokes its confirmation.
        if (eligible && unchanged) retain({ ...eligible, reviewGeneration: startedReview });
        setMessage(
          'A download of the reviewed subset was requested. This does not confirm the file was saved. The subset remains here; any removal needs a separate confirmation.',
        );
      } else {
        setMessage(
          `Removal completed: ${result.result.removed} browser copies removed, ${result.result.already_absent} already absent (${result.result.total} selected). Keep or export the reviewed subset. Read history again before another removal.`,
        );
      }
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          kind === 'remove'
            ? 'Removal could not be confirmed; the transaction may have committed. The complete subset is retained for export. Read history again, select and inspect current copies before any further removal.'
            : 'The complete selection could not be inspected or exported. Copies may have changed, be missing or damaged, or the operation may have stopped. Any earlier reviewed subset remains available; no partial subset was accepted.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        release.current?.();
        release.current = undefined;
        if (mounted.current) setBusy(false);
      }
    }
  }

  return (
    <section aria-label="Selected history copies" className="handoff-form">
      <h2>Review and organize selected observations</h2>
      <p>
        Select up to {PACK_RECEIPT_SELECTION_MAX_ENTRIES} observations from the current page. Other
        pages are not included.
      </p>
      {!page && <p>Read a matching history page to make a new selection.</p>}
      <div>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || disabled || !page?.entries.length}
          onClick={() => select(page!.entries.map((entry) => entry.file.document_sha256))}
        >
          Select this page
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || disabled || !chosen.length}
          onClick={() => select([])}
        >
          Clear selection
        </button>
      </div>
      {page?.entries.map((entry) => (
        <div key={entry.file.document_sha256}>
          <label className="confirmation-box">
            <input
              type="checkbox"
              checked={chosen.includes(entry.file.document_sha256)}
              disabled={busy || disabled}
              onChange={(event) => toggle(entry.file.document_sha256, event.target.checked)}
            />
            <span style={{ overflowWrap: 'anywhere' }}>
              {entry.file.document.observed_at} · {entry.file.document.original.request_key} ·{' '}
              {entry.file.document.receipt.data.status}
            </span>
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || disabled}
            onClick={() => {
              if (active.current || disabled || getReviewGeneration() !== reviewGeneration) return;
              clearConfirmation();
              onSelectionChange();
              onReview(entry);
            }}
          >
            Review complete observation
          </button>
        </div>
      ))}
      <p>{chosen.length} selected on this page.</p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || disabled || !chosen.length}
        onClick={() => void run('inspect')}
      >
        Inspect complete selected copies
      </button>
      {busy && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => operation.current?.abort()}
        >
          Stop waiting
        </button>
      )}
      <p role="status">{message}</p>
      {review && (
        <>
          <h3>Reviewed subset · {files.length} observations</h3>
          {!ready && (
            <p>
              This retained subset may differ from the current selection or browser history. Inspect
              a current page selection before removing copies.
            </p>
          )}
          <p>
            Export keeps the exact subset shown below, even after the page or selection changes. It
            can be imported through the history backup panel for comparison and explicit
            restoration.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || disabled}
            onClick={() => void run('export')}
          >
            Export reviewed subset
          </button>
          {files.map(({ file, raw }) => (
            <details key={file.document_sha256}>
              <summary>
                {file.document.observed_at} · {file.document.original.request_key} ·{' '}
                {file.document.receipt.data.status}
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{raw}</pre>
            </details>
          ))}
          <fieldset
            disabled={busy || disabled || !ready}
            className="handoff-form"
            style={{ minWidth: 0 }}
          >
            <legend>Remove the reviewed browser copies</legend>
            <label className="confirmation-box">
              <input
                type="checkbox"
                checked={ready && confirmed === confirmationKey(review)}
                onChange={(event) => {
                  const current = currentReview();
                  if (active.current || disabled || !current) return;
                  const next = event.target.checked ? confirmationKey(current) : null;
                  confirmedRef.current = next;
                  setConfirmed(next);
                }}
              />
              I have reviewed these complete observations and kept a separate copy. Remove their
              matching browser copies.
            </label>
            <p>
              Every selected copy is checked again before any deletion. Changed or incomplete copies
              block the whole removal; already absent copies are counted separately. Server packs
              and original request files are unchanged.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || disabled || !ready || confirmed !== confirmationKey(review)}
              onClick={() => void run('remove')}
            >
              Remove reviewed browser copies
            </button>
          </fieldset>
        </>
      )}
    </section>
  );
}
