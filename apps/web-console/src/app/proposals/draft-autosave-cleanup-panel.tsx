'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProposalSubmissionBinding } from './original-model';
import { AUTOSAVE_SELECTION_MAX_ENTRIES, type AutosaveDraft } from './draft-autosave-backup-model';
import type { ReviewedAutosaveBackup } from './draft-autosave-backup';
import type { DraftAutosaveCleanup } from './draft-autosave-cleanup';

export function DraftAutosaveCleanupPanel<
  Draft extends AutosaveDraft,
  Summary extends { session_id: string },
>({
  binding,
  cleanup,
  entries,
  summaryLabel,
  draftLabel,
  disabled,
  storageEpoch,
  begin,
  end,
  onStorageChange,
}: {
  binding: ProposalSubmissionBinding;
  cleanup: DraftAutosaveCleanup<Draft, Summary>;
  entries: Summary[] | undefined;
  summaryLabel: (entry: Summary) => string;
  draftLabel: (draft: Draft) => string;
  disabled: boolean;
  storageEpoch: number;
  begin: () => boolean;
  end: () => void;
  onStorageChange: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState<ReviewedAutosaveBackup<Draft>>();
  const [inspectedSession, setInspectedSession] = useState('');
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
    if (locked || operation.current || unique.length > AUTOSAVE_SELECTION_MAX_ENTRIES) return;
    setSelected(unique);
    setEligibility(undefined);
    setConfirmed(null);
    setMessage('Selection changed. Inspect the complete selected copies before removing any.');
  }
  async function run(action: 'inspect' | 'download' | 'remove') {
    if (!mounted.current || disabled || operation.current) return;
    const page = entries;
    const selections = page?.filter((entry) => selected.includes(entry.session_id)) ?? [];
    if (
      action === 'inspect' &&
      (!page ||
        selected.length < 1 ||
        selected.length > AUTOSAVE_SELECTION_MAX_ENTRIES ||
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
        setMessage('Reading the complete selected automatic copies together…');
        const result = await cleanup.prepare(binding, selections, controller.signal);
        if (!current()) return;
        setReviewed(result);
        setInspectedSession('');
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
          `Storage check completed: ${result.removed} copies removed, ${result.not_present} already absent. Absence does not prove an earlier removal succeeded. The retained selection remains available for export; find automatic drafts again before another removal.`,
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
            ? 'Removal could not be confirmed and may already have completed. Keep or export the retained selection. Find automatic drafts and inspect a fresh selection before another removal attempt.'
            : 'The operation could not be confirmed. Any retained selection remains available for export. Reload the automatic directory and inspect the current copies before removing them.',
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
    (entry) => entry.session_id === inspectedSession,
  );
  return (
    <details className="side-detail">
      <summary>Select and remove automatic copies from this page</summary>
      <div aria-busy={busy} style={{ overflowWrap: 'anywhere' }}>
        <p>
          Select up to {AUTOSAVE_SELECTION_MAX_ENTRIES} copies from the current automatic directory
          page. Inspect the complete selection and optionally export a recovery file before
          confirming removal. Selection is limited to a {cleanup.documentBytes / (1024 * 1024)} MiB
          document; it does not require a complete collection backup.
        </p>
        {!entries?.length ? (
          <p>Find automatic drafts to load a directory page with copies to select.</p>
        ) : (
          <>
            <div className="heading-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={locked || entries.length > AUTOSAVE_SELECTION_MAX_ENTRIES}
                onClick={() => choose(entries.map((entry) => entry.session_id))}
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
                <li key={entry.session_id}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={selected.includes(entry.session_id)}
                      onChange={(event) =>
                        choose(
                          event.target.checked
                            ? [...selected, entry.session_id]
                            : selected.filter((id) => id !== entry.session_id),
                        )
                      }
                    />{' '}
                    {summaryLabel(entry)} · <code>{entry.session_id}</code>
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
                value={inspectedSession}
                disabled={locked}
                onChange={(event) => setInspectedSession(event.target.value)}
              >
                <option value="">Choose a retained copy</option>
                {reviewed.file.document.entries.map((entry) => (
                  <option key={entry.session_id} value={entry.session_id}>
                    {draftLabel(entry.draft)} · {entry.draft.saved_at} · {entry.session_id}
                  </option>
                ))}
              </select>
            </label>
            {inspected && (
              <textarea
                aria-label="Complete selected automatic copy"
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
                  Remove inspected automatic copies
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
          Automatic saving pauses before inspection or removal. Every target is checked again;
          changed or damaged copies block the whole removal. Current editor text, manual snapshots,
          prepared requests and remote proposals are kept. Removal does not send or cancel a review.
          The selected recovery file can be loaded in the matching automatic backup controls and
          restored after comparison and confirmation. Explicit restoration can recreate removed
          copies.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
