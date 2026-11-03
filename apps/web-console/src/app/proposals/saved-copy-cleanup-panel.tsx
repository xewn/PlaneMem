'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProposalSubmissionBinding } from './original-model';
import {
  SAVED_COPY_SELECTION_LIMIT,
  type SavedCopy,
  type ReviewedSavedSelection,
  type SavedCopyCleanup,
} from './saved-copy-cleanup';

export interface SavedCopyCleanupPanelProps<
  Copy extends SavedCopy,
  Summary extends { request_key: string },
> {
  binding: ProposalSubmissionBinding;
  cleanup: SavedCopyCleanup<Copy, Summary>;
  entries: Summary[] | undefined;
  summaryLabel: (entry: Summary) => string;
  copyLabel: (copy: Copy) => string;
  heading: string;
  findLabel: string;
  scopeNote: string;
  disabled: boolean;
  storageEpoch: number;
  begin: () => boolean;
  end: () => void;
  onStorageChange: () => void;
}

export function SavedCopyCleanupPanel<
  Draft extends SavedCopy,
  Summary extends { request_key: string },
>({
  binding,
  cleanup,
  entries,
  summaryLabel,
  copyLabel,
  heading,
  findLabel,
  scopeNote,
  disabled,
  storageEpoch,
  begin,
  end,
  onStorageChange,
}: SavedCopyCleanupPanelProps<Draft, Summary>) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState<ReviewedSavedSelection<Draft>>();
  const [inspectedKey, setInspectedKey] = useState('');
  const [eligibility, setEligibility] = useState<{
    digest: string;
    epoch: number;
    page: Summary[];
    selection: string;
  }>();
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
      release.current?.();
      release.current = undefined;
    };
  }, []);
  useEffect(() => {
    setSelected([]);
    setEligibility(undefined);
    setConfirmed(null);
  }, [entries, storageEpoch]);
  const selection = JSON.stringify([...selected].sort());
  const matching =
    !!reviewed &&
    eligibility?.digest === reviewed.file.document_sha256 &&
    eligibility.epoch === storageEpoch &&
    eligibility.page === entries &&
    eligibility.selection === selection;
  const locked = disabled || busy;
  function choose(ids: string[]) {
    const unique = [...new Set(ids)];
    if (locked || operation.current || unique.length > SAVED_COPY_SELECTION_LIMIT) return;
    setSelected(unique);
    setEligibility(undefined);
    setConfirmed(null);
    setMessage('Selection changed. Inspect the complete selected copies before removing any.');
  }
  async function run(action: 'inspect' | 'download' | 'remove') {
    if (!mounted.current || disabled || operation.current) return;
    const page = entries;
    const selections = page?.filter((entry) => selected.includes(entry.request_key)) ?? [];
    if (
      action === 'inspect' &&
      (!page ||
        selected.length < 1 ||
        selected.length > SAVED_COPY_SELECTION_LIMIT ||
        selections.length !== selected.length)
    )
      return;
    if (action !== 'inspect' && !reviewed) return;
    if (action === 'remove' && (!matching || confirmed !== reviewed!.file.document_sha256)) return;
    if (!begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    release.current = end;
    setBusy(true);
    const current = () =>
      mounted.current && operation.current === controller && !controller.signal.aborted;
    if (action !== 'download') {
      setEligibility(undefined);
      setConfirmed(null);
    }
    try {
      if (action === 'inspect') {
        setMessage('Reading the complete selected browser copies together…');
        const result = await cleanup.prepare(binding, selections, controller.signal);
        if (!current()) return;
        setReviewed(result);
        setInspectedKey('');
        setEligibility({
          digest: result.file.document_sha256,
          epoch: storageEpoch,
          page: page!,
          selection,
        });
        setMessage(
          'Selected copies are ready for inspection and export. Review their complete contents, then separately confirm removal if wanted.',
        );
      } else if (action === 'remove') {
        onStorageChange();
        setMessage('Rechecking all selected copies before removing them together…');
        const result = await cleanup.remove(
          reviewed!.raw,
          binding,
          reviewed!.file.document_sha256,
          controller.signal,
        );
        if (!current()) return;
        setMessage(
          `Storage check completed: ${result.removed} copies removed, ${result.not_present} already absent. Absence does not prove an earlier removal succeeded. The retained selection remains available for export; use ${findLabel} again before another removal.`,
        );
      } else {
        const url = URL.createObjectURL(new Blob([reviewed!.raw], { type: 'application/json' }));
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = cleanup.filename;
          document.body.append(link);
          try {
            link.click();
          } finally {
            link.remove();
          }
          setMessage(
            'Selected-copy download requested. Check that the complete file was saved. This file contains only the retained selection, not the entire collection.',
          );
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    } catch {
      if (current()) {
        setEligibility(undefined);
        setConfirmed(null);
        setMessage(
          action === 'remove'
            ? `Removal could not be confirmed and may already have completed. Keep or export the retained selection. Use ${findLabel} and inspect a fresh selection before another removal attempt.`
            : `The operation could not be confirmed. Any retained selection remains available for export. Use ${findLabel} and inspect the current copies before removing them.`,
        );
      }
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (mounted.current) setBusy(false);
        release.current?.();
        release.current = undefined;
      }
    }
  }
  const inspected = reviewed?.file.document.entries.find(
    (entry) => entry.request_key === inspectedKey,
  );
  return (
    <details className="side-detail">
      <summary>{heading}</summary>
      <div aria-busy={busy} style={{ overflowWrap: 'anywhere' }}>
        <p>
          Select up to {SAVED_COPY_SELECTION_LIMIT} copies from the current browser directory page.
          Inspect the complete selection and optionally export a recovery file before confirming
          removal. Selection is limited to a {cleanup.documentBytes / (1024 * 1024)} MiB document;
          it does not require a complete collection backup.
        </p>
        <p className="muted">{scopeNote}</p>
        {!entries?.length ? (
          <p>Use {findLabel} to load a directory page with copies to select.</p>
        ) : (
          <>
            <div className="heading-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={locked || entries.length > SAVED_COPY_SELECTION_LIMIT}
                onClick={() => choose(entries.map((entry) => entry.request_key))}
              >
                Select this page
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={locked || !selected.length}
                onClick={() => choose([])}
              >
                Clear selection
              </button>
            </div>
            <ul>
              {entries.map((entry) => (
                <li key={entry.request_key}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={selected.includes(entry.request_key)}
                      onChange={(event) =>
                        choose(
                          event.target.checked
                            ? [...selected, entry.request_key]
                            : selected.filter((id) => id !== entry.request_key),
                        )
                      }
                    />{' '}
                    {summaryLabel(entry)} · <code>{entry.request_key}</code>
                  </label>
                </li>
              ))}
            </ul>
            <p>{selected.length} copies selected</p>
            <button
              type="button"
              className="secondary-button"
              disabled={locked || !selected.length}
              onClick={() => void run('inspect')}
            >
              Inspect complete selected copies
            </button>
          </>
        )}
        {reviewed && (
          <>
            <p>
              Retained selection · {reviewed.file.document.entries.length} copies · This is a
              selected subset, not a complete collection backup.
            </p>
            <label>
              Inspect each retained copy
              <select
                value={inspectedKey}
                disabled={locked}
                onChange={(event) => setInspectedKey(event.target.value)}
              >
                <option value="">Choose a retained copy</option>
                {reviewed.file.document.entries.map((entry) => (
                  <option key={entry.request_key} value={entry.request_key}>
                    {copyLabel(entry)} · {entry.request_key}
                  </option>
                ))}
              </select>
            </label>
            {inspected && (
              <textarea
                aria-label="Complete selected browser copy"
                readOnly
                rows={10}
                spellCheck={false}
                value={JSON.stringify(inspected, null, 2)}
              />
            )}
            <p>
              Selection checksum · <code>{reviewed.file.document_sha256}</code>
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() => void run('download')}
            >
              Download retained selection for recovery
            </button>
            {matching ? (
              <>
                <label>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={confirmed === reviewed.file.document_sha256}
                    onChange={(event) => {
                      if (!operation.current)
                        setConfirmed(event.target.checked ? reviewed.file.document_sha256 : null);
                    }}
                  />{' '}
                  I inspected these complete copies and want to remove this selection from this
                  browser.
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locked || confirmed !== reviewed.file.document_sha256}
                  onClick={() => void run('remove')}
                >
                  Remove inspected browser copies
                </button>
              </>
            ) : (
              <p>
                Inspect the current selection again to enable removal. This retained copy remains
                available for export.
              </p>
            )}
          </>
        )}
        <p className="muted">
          Every target is checked again; changed or damaged copies block the whole removal. The
          selected recovery file can be loaded in the matching backup controls and restored after
          comparison and confirmation. Explicit restoration can recreate removed copies.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
