'use client';

import { useEffect, useRef, useState } from 'react';
import type { PackSaveBinding } from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import {
  PACK_RECEIPT_BACKUP_FILE_BYTES,
  type PackReceiptBackupCandidate,
} from './save-receipt-backup-model';
import {
  PACK_RECEIPT_MAX_VOLUMES,
  PACK_RECEIPT_VOLUMES_MAX_ENTRIES,
  PACK_RECEIPT_VOLUMES_SET_BYTES,
  type PackReceiptVolumesCandidate,
} from './save-receipt-volumes-model';
import { inspectPackReceiptVolumes, preparePackReceiptVolumes } from './save-receipt-store';

function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function PackReceiptVolumesPanel({
  binding,
  disabled,
  getStorageGeneration,
  begin,
  end,
  onSelect,
}: {
  binding: PackSaveBinding;
  disabled: boolean;
  getStorageGeneration: () => number;
  begin: () => boolean;
  end: () => void;
  onSelect: (backup: PackReceiptBackupCandidate, label: string) => void;
}) {
  const [collection, setCollection] = useState<PackReceiptVolumesCandidate>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Prepare a complete set, or select its manifest and all volume files together.',
  );
  const mounted = useRef(false);
  const active = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      release.current?.();
      release.current = undefined;
    };
  }, []);

  async function run(
    kind: 'prepare' | 'import' | 'manifest' | 'volume' | 'select',
    sources?: File[],
    index?: number,
  ) {
    if (kind === 'import' && !sources?.length) return;
    if (kind !== 'prepare' && kind !== 'import' && !collection) return;
    if (
      (kind === 'volume' || kind === 'select') &&
      (index === undefined ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        !collection?.volumes[index])
    )
      return;
    if (!mounted.current || active.current || disabled || !begin()) return;
    const startedGeneration = getStorageGeneration();
    const captured = collection;
    const files = sources ? [...sources] : [];
    active.current = true;
    release.current = end;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      const result = await backupOperation(controller.signal, async (signal, check) => {
        if (kind === 'prepare') return preparePackReceiptVolumes(binding, signal, check);
        if (kind === 'import') {
          if (
            files.length < 2 ||
            files.length > PACK_RECEIPT_MAX_VOLUMES + 1 ||
            files.some((file) => file.size < 1 || file.size > PACK_RECEIPT_BACKUP_FILE_BYTES) ||
            files.reduce((total, file) => total + file.size, 0) > PACK_RECEIPT_VOLUMES_SET_BYTES
          )
            throw new TypeError();
          const raws: string[] = [];
          for (const file of files) {
            check();
            const bytes = await file.arrayBuffer();
            check();
            if (bytes.byteLength !== file.size) throw new TypeError();
            raws.push(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          }
          return inspectPackReceiptVolumes(raws, binding, check);
        }
        if (!captured) throw new TypeError();
        return inspectPackReceiptVolumes(
          [captured.raw, ...captured.volumes.map((volume) => volume.raw)],
          binding,
          check,
        );
      });
      if (!mounted.current || operation.current !== controller) return;
      if (kind === 'prepare' || kind === 'import') {
        if (kind === 'prepare' && startedGeneration !== getStorageGeneration()) {
          setMessage(
            'History may have changed during preparation. Prepare again; any earlier complete set is retained.',
          );
          return;
        }
        setCollection(result);
        setMessage(
          'The manifest, every declared volume and every observation were checked. Save the manifest and all volumes separately. Nothing was restored.',
        );
      } else if (kind === 'select') {
        const volume = result.volumes[index!];
        if (!volume) throw new TypeError();
        const label = `Volume ${index! + 1} of ${result.volumes.length} · set ${result.file.document_sha256}`;
        onSelect(volume, label);
        setMessage(
          `Volume ${index! + 1} is loaded below. Compare it with browser history and confirm any change separately. Other volumes are retained here.`,
        );
      } else {
        const volume = index === undefined ? undefined : result.volumes[index];
        if (kind === 'manifest')
          download(result.raw, `context-pack-history-manifest-${result.file.document_sha256}.json`);
        else if (volume)
          download(
            volume.raw,
            `context-pack-history-volume-${index! + 1}-${volume.file.document_sha256}.json`,
          );
        else throw new TypeError();
        setMessage(
          'A download was requested. This does not confirm that the browser saved it. Keep the manifest and every volume; partial sets cannot be imported here.',
        );
      }
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'The complete set could not be confirmed. It may be incomplete, duplicated, damaged, from a different identity, over the limit, or the operation may have stopped. Any earlier set and selected backup are retained; no history was changed.',
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
    <section className="handoff-form" aria-label="History backup volumes">
      <h3>Back up larger histories in volumes</h3>
      <p>
        One complete read can include up to {PACK_RECEIPT_VOLUMES_MAX_ENTRIES} observations in at
        most {PACK_RECEIPT_MAX_VOLUMES} volumes of 100. Keep the manifest and every volume. List
        filters do not limit this backup. Histories above this limit or containing damaged copies
        are rejected without truncation.
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || disabled}
        onClick={() => void run('prepare')}
      >
        Prepare complete volume set
      </button>
      <label>
        Import manifest and all volumes for review
        <input
          type="file"
          multiple
          accept="application/json,.json"
          disabled={busy || disabled}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length) void run('import', files);
          }}
        />
      </label>
      {collection && (
        <>
          <p>
            {collection.file.document.total_entries} observations · {collection.volumes.length}{' '}
            volumes · manifest SHA-256: {collection.file.document_sha256}
          </p>
          <p>
            Checksums establish internal consistency, not server authenticity or current server
            state. Imported completeness is relative to the supplied manifest.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || disabled}
            onClick={() => void run('manifest')}
          >
            Export manifest
          </button>
          <details>
            <summary>Complete manifest</summary>
            <pre>{collection.raw}</pre>
          </details>
          <table>
            <caption>Keep every volume listed in this manifest</caption>
            <thead>
              <tr>
                <th scope="col">Volume</th>
                <th scope="col">Observations</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {collection.volumes.map((volume, index) => (
                <tr key={volume.file.document_sha256}>
                  <td>
                    {index + 1}
                    <details>
                      <summary>Volume checksum</summary>
                      <code>{volume.file.document_sha256}</code>
                    </details>
                  </td>
                  <td>{volume.file.document.entries.length}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || disabled}
                      onClick={() => void run('volume', undefined, index)}
                    >
                      Export volume {index + 1}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || disabled}
                      onClick={() => void run('select', undefined, index)}
                    >
                      Review volume {index + 1} below
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Compare and restore one selected volume at a time below. Each volume commits separately;
            one successful restore does not mean the entire set was restored. Selecting a volume
            clears earlier comparison and confirmation.
          </p>
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
