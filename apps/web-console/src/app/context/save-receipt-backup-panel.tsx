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
  inspectPackReceiptBackup,
  preparePackReceiptBackup,
  restorePackReceiptBackup,
} from './save-receipt-store';

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
  getStorageGeneration,
  begin,
  end,
  onHistoryWrite,
}: {
  binding: PackSaveBinding;
  disabled: boolean;
  reviewGeneration: number;
  getStorageGeneration: () => number;
  begin: () => boolean;
  end: () => void;
  onHistoryWrite: () => void;
}) {
  const [backup, setBackup] = useState<PackReceiptBackupCandidate>();
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<number | null>(null);
  const reviewedRef = useRef<number | null>(null);
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

  async function run(kind: 'prepare' | 'import' | 'export' | 'restore', source?: File) {
    if ((kind === 'export' || kind === 'restore') && !backup) return;
    if (kind === 'import' && !source) return;
    if (kind === 'restore' && reviewedRef.current !== reviewGeneration) return;
    if (!mounted.current || active.current || disabled || !begin()) return;
    const startedGeneration = getStorageGeneration();
    const captured = backup;
    active.current = true;
    reviewedRef.current = null;
    setReviewed(null);
    release.current = end;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      if (kind === 'restore') {
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
        if (kind === 'restore')
          return {
            kind: 'restored' as const,
            restored: await restorePackReceiptBackup(captured.raw, binding, signal, check),
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
      } else if (result.kind === 'restored') {
        setMessage(
          `Restore completed: ${result.restored.added} added, ${result.restored.already_present} identical copies retained (${result.restored.total} total). The backup remains here. Read history again to see the current directory.`,
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
            ? 'Restore could not be confirmed; the transaction may have committed. This backup remains available. Keep it and read history again before another explicit restore. No gateway request was sent.'
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
      <h2>Back up and restore browser history</h2>
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
          <label className="confirmation-box">
            <input
              type="checkbox"
              checked={reviewed === reviewGeneration}
              disabled={busy || disabled}
              onChange={(event) => {
                if (active.current || disabled) return;
                const value = event.target.checked ? reviewGeneration : null;
                reviewedRef.current = value;
                setReviewed(value);
              }}
            />
            I reviewed this backup and want to add its missing observations to this browser.
          </label>
          <p>
            Restore retains identical copies. Different or incomplete stored copies reject the whole
            restore; other history is kept.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || disabled || reviewed !== reviewGeneration}
            onClick={() => void run('restore')}
          >
            Restore missing observations
          </button>
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
      <p role="status">{message}</p>
    </section>
  );
}
