'use client';

import { useEffect, useRef, useState } from 'react';
import type { PackSaveBinding } from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import {
  PACK_RECEIPT_BACKUP_FILE_BYTES,
  PACK_RECEIPT_BACKUP_MAX_ENTRIES,
  type PackReceiptBackupCandidate,
} from './save-receipt-backup-model';
import {
  comparePackReceiptBackup,
  inspectPackReceiptBackup,
  preparePackReceiptBackup,
  removePackReceiptBackup,
  restorePackReceiptBackup,
  type PackReceiptRestoreComparison,
} from './save-receipt-store';

interface BackupPreview {
  comparison: PackReceiptRestoreComparison;
  backupRaw: string;
  reviewGeneration: number;
  storageGeneration: number;
}

const comparisonLabels = {
  missing: 'No browser copy',
  identical: 'Matching browser copy',
  conflict: 'Conflict — changes blocked',
};

function download(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = 'context-pack-save-history-backup.json';
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function PackReceiptBackupPanel({
  binding,
  disabled,
  reviewGeneration,
  getReviewGeneration,
  getStorageGeneration,
  begin,
  end,
  onHistoryWrite,
}: {
  binding: PackSaveBinding;
  disabled: boolean;
  reviewGeneration: number;
  getReviewGeneration: () => number;
  getStorageGeneration: () => number;
  begin: () => boolean;
  end: () => void;
  onHistoryWrite: () => void;
}) {
  const [backup, setBackup] = useState<PackReceiptBackupCandidate>();
  const [preview, setPreview] = useState<BackupPreview>();
  const currentPreview =
    preview?.reviewGeneration === reviewGeneration && preview.backupRaw === backup?.raw
      ? preview
      : undefined;
  const canRestore =
    !!currentPreview &&
    currentPreview.comparison.conflicting === 0 &&
    currentPreview.comparison.missing > 0;
  const canRemove =
    !!currentPreview &&
    currentPreview.comparison.conflicting === 0 &&
    currentPreview.comparison.identical > 0;
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<number | null>(null);
  const reviewedRef = useRef<number | null>(null);
  const [removalReviewed, setRemovalReviewed] = useState<number | null>(null);
  const removalReviewedRef = useRef<number | null>(null);
  const [message, setMessage] = useState(
    'Prepare the complete history for this identity, or import a backup for review. Directory filters do not limit a backup.',
  );
  const mounted = useRef(false);
  const active = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (disabled) {
      reviewedRef.current = null;
      setReviewed(null);
      removalReviewedRef.current = null;
      setRemovalReviewed(null);
    }
  }, [disabled]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      release.current?.();
      release.current = undefined;
    };
  }, []);

  function previewIsCurrent() {
    return (
      !!currentPreview &&
      currentPreview.reviewGeneration === getReviewGeneration() &&
      currentPreview.storageGeneration === getStorageGeneration()
    );
  }

  async function run(
    kind: 'prepare' | 'import' | 'export' | 'compare' | 'restore' | 'remove',
    source?: File,
  ) {
    if (kind !== 'prepare' && kind !== 'import' && !backup) return;
    if (kind === 'import' && !source) return;
    if (
      kind === 'restore' &&
      (!canRestore || reviewedRef.current !== reviewGeneration || !previewIsCurrent())
    )
      return;
    if (
      kind === 'remove' &&
      (!canRemove || removalReviewedRef.current !== reviewGeneration || !previewIsCurrent())
    )
      return;
    const removalDigests =
      kind === 'remove'
        ? currentPreview!.comparison.entries
            .filter((entry) => entry.status === 'identical')
            .map((entry) => entry.document_sha256)
        : [];
    if (!mounted.current || active.current || disabled || !begin()) return;
    const startedGeneration = getStorageGeneration();
    const startedReviewGeneration = getReviewGeneration();
    const captured = backup;
    setPreview(undefined);
    active.current = true;
    reviewedRef.current = null;
    setReviewed(null);
    removalReviewedRef.current = null;
    setRemovalReviewed(null);
    release.current = end;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      if (kind === 'restore' || kind === 'remove') {
        try {
          onHistoryWrite();
        } catch {
          /* Storage results remain independent of page notification. */
        }
      }
      const result = await backupOperation(controller.signal, async (signal, check) => {
        if (kind === 'prepare')
          return {
            kind: 'backup' as const,
            backup: await preparePackReceiptBackup(binding, signal, check),
          };
        if (kind === 'import') {
          if (!source || source.size < 1 || source.size > PACK_RECEIPT_BACKUP_FILE_BYTES)
            throw new TypeError();
          const bytes = await source.arrayBuffer();
          check();
          if (bytes.byteLength !== source.size) throw new TypeError();
          return {
            kind: 'backup' as const,
            backup: await inspectPackReceiptBackup(
              new TextDecoder('utf-8', { fatal: true }).decode(bytes),
              binding,
              check,
            ),
          };
        }
        if (!captured) throw new TypeError();
        if (kind === 'compare')
          return {
            kind: 'comparison' as const,
            comparison: await comparePackReceiptBackup(captured.raw, binding, signal, check),
          };
        if (kind === 'restore')
          return {
            kind: 'restored' as const,
            restored: await restorePackReceiptBackup(captured.raw, binding, signal, check),
          };
        if (kind === 'remove')
          return {
            kind: 'removed' as const,
            removed: await removePackReceiptBackup(
              captured.raw,
              binding,
              removalDigests,
              signal,
              check,
            ),
          };
        return {
          kind: 'export' as const,
          backup: await inspectPackReceiptBackup(captured.raw, binding, check),
        };
      });
      if (!mounted.current || operation.current !== controller) return;
      if (result.kind === 'backup') {
        if (kind === 'prepare' && startedGeneration !== getStorageGeneration()) {
          setMessage(
            'Browser history may have changed while preparing this backup. Prepare it again. Any earlier complete backup remains available below.',
          );
          return;
        }
        setBackup(result.backup);
        setMessage(
          'The complete backup and every observation checksum match this identity. Review or export it; no history was restored.',
        );
      } else if (result.kind === 'comparison') {
        if (
          !captured ||
          startedGeneration !== getStorageGeneration() ||
          startedReviewGeneration !== getReviewGeneration()
        ) {
          setMessage(
            'History may have changed during comparison. Compare again before restoring or removing copies. Your complete backup is retained.',
          );
          return;
        }
        setPreview({
          comparison: result.comparison,
          backupRaw: captured.raw,
          reviewGeneration: startedReviewGeneration,
          storageGeneration: startedGeneration,
        });
        setMessage(
          result.comparison.conflicting
            ? 'Some target copies differ or are incomplete. Restore and removal are blocked. Keep this backup; no history was changed.'
            : result.comparison.missing
              ? 'Comparison is ready. Review the observations below before choosing restore or removal. No history has been changed.'
              : result.comparison.total
                ? 'Every backup observation already has an identical browser copy. Nothing needs to be restored.'
                : 'This backup contains no observations. There is nothing to restore or remove.',
        );
      } else if (result.kind === 'restored') {
        setMessage(
          `Restore completed: ${result.restored.added} added, ${result.restored.already_present} identical copies retained (${result.restored.total} total). The backup remains here. Read history again to see the current directory.`,
        );
      } else if (result.kind === 'removed') {
        setMessage(
          `Removal completed: ${result.removed.removed} browser copies removed, ${result.removed.already_absent} already absent (${result.removed.total} selected). This backup remains available for export or a new comparison and explicit restore. Read history again to see the current directory.`,
        );
      } else {
        download(result.backup.raw);
        setMessage(
          'A backup download was requested. Keep the file; this does not confirm that the browser stored the download.',
        );
      }
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          kind === 'restore'
            ? 'Restore could not be confirmed; the transaction may have committed. This backup remains available. Keep it and compare again before another explicit restore. No gateway request was sent.'
            : kind === 'remove'
              ? 'Removal could not be confirmed; the transaction may have committed. Keep or export this complete backup and compare again before another explicit change. No gateway request was sent.'
              : kind === 'compare'
                ? 'Comparison could not be completed. No partial preview was accepted and no history was changed. Your complete backup remains available; compare again before restoring or removing copies.'
                : 'The complete backup could not be prepared, imported or exported. It may exceed the limit, contain damaged records, differ from this identity, or the operation may have stopped. Any earlier backup below is unchanged; no partial backup was accepted.',
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
    <section aria-label="Context pack history backup" className="handoff-form">
      <h2>Back up, restore or remove browser history copies</h2>
      <p>
        A complete backup covers this gateway, project, account, client and permission scope,
        regardless of the list filters. At most {PACK_RECEIPT_BACKUP_MAX_ENTRIES} observations fit
        in one backup (4 MiB plus 1 KiB). Larger or damaged histories are rejected without
        truncation.
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || disabled}
        onClick={() => void run('prepare')}
      >
        Prepare complete history backup
      </button>
      <label>
        Import history backup for review
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy || disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void run('import', file);
          }}
        />
      </label>
      {backup && (
        <>
          <p>
            Backup ready for review · {backup.file.document.entries.length} observations · SHA-256 ·{' '}
            {backup.file.document_sha256}
          </p>
          <p>
            Each observation keeps its original time and result. A checksum does not authenticate
            the server or establish current server state.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || disabled}
            onClick={() => void run('export')}
          >
            Export this complete backup
          </button>
          <details>
            <summary>Complete backup, originals and historical receipts</summary>
            <pre>{backup.raw}</pre>
          </details>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || disabled}
            onClick={() => void run('compare')}
          >
            Compare with browser history
          </button>
          {currentPreview ? (
            <div>
              <p>
                {currentPreview.comparison.total} observations compared ·{' '}
                {currentPreview.comparison.missing} absent · {currentPreview.comparison.identical}{' '}
                matching browser copies · {currentPreview.comparison.conflicting} conflicts
              </p>
              {!!currentPreview.comparison.entries.length && (
                <details>
                  <summary>Review each observation before making changes</summary>
                  <table>
                    <caption>Backup observations compared with browser copies</caption>
                    <thead>
                      <tr>
                        <th scope="col">Original request</th>
                        <th scope="col">Observed (UTC)</th>
                        <th scope="col">Browser copy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentPreview.comparison.entries.map((entry) => (
                        <tr key={entry.document_sha256}>
                          <td>
                            {entry.request_key}
                            <details>
                              <summary>Observation checksum</summary>
                              <code>{entry.document_sha256}</code>
                            </details>
                          </td>
                          <td>{entry.observed_at}</td>
                          <td>{comparisonLabels[entry.status]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          ) : (
            <p>
              Compare this backup with browser history before confirming restoration or removal.
            </p>
          )}
          <label className="confirmation-box">
            <input
              type="checkbox"
              checked={canRestore && reviewed === reviewGeneration}
              disabled={busy || disabled || !canRestore}
              onChange={(event) => {
                if (active.current || disabled || !canRestore || !previewIsCurrent()) return;
                const value = event.target.checked ? reviewGeneration : null;
                reviewedRef.current = value;
                setReviewed(value);
                removalReviewedRef.current = null;
                setRemovalReviewed(null);
              }}
            />
            I reviewed this comparison and backup and want to add its missing observations to this
            browser.
          </label>
          <p>
            Restore retains identical copies. Different or incomplete stored copies reject the whole
            restore; other history is kept. Comparison only covers targets in this backup at the
            time of reading. Restore checks them again; counts may change. Any new operation or
            reported history change requires another comparison and confirmation.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || disabled || !canRestore || reviewed !== reviewGeneration}
            onClick={() => void run('restore')}
          >
            Restore missing observations
          </button>
          <fieldset
            className="handoff-form"
            disabled={busy || disabled || !canRemove}
            style={{ minWidth: 0 }}
          >
            <legend>Remove matching browser copies from this backup</legend>
            <p>
              {currentPreview
                ? `${currentPreview.comparison.identical} matching copies were found in the preview.`
                : 'A current comparison is required to select matching copies.'}{' '}
              Only those copies are selected for removal. Observations absent in the preview and
              history outside this backup are kept. The backup here remains available; keep an
              exported file before leaving this page.
            </p>
            <label className="confirmation-box">
              <input
                type="checkbox"
                checked={canRemove && removalReviewed === reviewGeneration}
                onChange={(event) => {
                  if (active.current || disabled || !canRemove || !previewIsCurrent()) return;
                  const value = event.target.checked ? reviewGeneration : null;
                  removalReviewedRef.current = value;
                  setRemovalReviewed(value);
                  reviewedRef.current = null;
                  setReviewed(null);
                }}
              />
              I have kept a separate backup and reviewed the selected matching copies. Remove those
              browser copies.
            </label>
            <p>
              Every selected copy is checked again before any deletion. A changed or incomplete copy
              rejects the whole removal. Copies already absent are skipped. Server packs and
              original requests are unchanged.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || disabled || !canRemove || removalReviewed !== reviewGeneration}
              onClick={() => void run('remove')}
            >
              Remove selected matching browser copies
            </button>
          </fieldset>
        </>
      )}
      {busy && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => operation.current?.abort()}
        >
          Stop waiting
        </button>
      )}
      <p role="status">
        {preview && !currentPreview
          ? 'The previous comparison no longer applies after page activity or a possible history change. Your backup is retained; compare again before restoring or removing copies.'
          : message}
      </p>
    </section>
  );
}
