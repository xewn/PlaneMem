'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProposalOriginal, ProposalSubmissionBinding } from '../original-model';
import { backupOperation } from '../../sync/receipt/backup-operation';
import { SavedCopyCleanupPanel } from '../saved-copy-cleanup-panel';
import {
  listBrowserProposalOriginals,
  proposalOriginalCleanup,
  type OriginalMetadata,
  type SavedProposalOriginal,
  type SavedProposalOriginalPage,
} from '../original-store';

export function SavedProposalOriginals({
  binding,
  disabled,
  storageEpoch,
  begin,
  end,
  onStorageChange,
  onSelect,
}: {
  binding: ProposalSubmissionBinding;
  disabled: boolean;
  storageEpoch: number;
  begin: () => boolean;
  end: () => void;
  onStorageChange: () => void;
  onSelect: (entry: SavedProposalOriginal) => void;
}) {
  const [page, setPage] = useState<SavedProposalOriginalPage>();
  const [after, setAfter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  const mounted = useRef(false);
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
    setPage(undefined);
    setAfter(null);
  }, [storageEpoch]);
  const selections = useMemo(() => page?.entries.map((entry) => entry.metadata), [page]);

  async function read(cursor: string | null) {
    if (!mounted.current || disabled || operation.current || !begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    release.current = end;
    setBusy(true);
    setAfter(cursor);
    setPage(undefined);
    setMessage('Reading saved request summaries…');
    try {
      const result = await backupOperation(controller.signal, (signal) =>
        listBrowserProposalOriginals(binding, cursor, signal),
      );
      if (!mounted.current || operation.current !== controller || controller.signal.aborted) return;
      setPage(result);
      setMessage(
        result.entries.length
          ? 'Select a request to read its complete content. Summaries do not confirm that a proposal was submitted.'
          : 'No saved requests were found on this page for this gateway and identity. You can still use an old tab copy or exported file.',
      );
    } catch {
      if (operation.current === controller && !controller.signal.aborted)
        setMessage(
          'The saved request list could not be read. Existing data was not changed. Retry this page or load an original by its key or file.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (mounted.current) setBusy(false);
        release.current?.();
        release.current = undefined;
      }
    }
  }
  const locked = disabled || busy;
  return (
    <section aria-busy={busy}>
      <h3>Saved in this browser</h3>
      <p className="muted">
        Lists up to 20 original requests for this gateway, project, account and client. This browser
        list is not a list of submitted or approved proposals. Other tabs may save requests while
        you browse; return to the first page to see earlier additions.
      </p>
      <div className="heading-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => void read(null)}
        >
          {page || after !== null ? 'First page' : 'Find saved requests'}
        </button>
        {(page || after !== null || message) && (
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() => void read(after)}
          >
            Reload this page
          </button>
        )}
        {page?.next && (
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() => void read(page.next)}
          >
            Next page
          </button>
        )}
      </div>
      {page && page.entries.length > 0 && (
        <ul style={{ overflowWrap: 'anywhere' }}>
          {page.entries.map((entry) => (
            <li key={entry.key}>
              <p>
                <strong>{entry.metadata.title}</strong> · {entry.metadata.kind} ·{' '}
                {entry.metadata.classification}
              </p>
              <p>
                Original request key · <code>{entry.metadata.request_key}</code>
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => onSelect(entry)}
              >
                Review saved original
              </button>
            </li>
          ))}
        </ul>
      )}
      <SavedCopyCleanupPanel<ProposalOriginal, OriginalMetadata>
        binding={binding}
        cleanup={proposalOriginalCleanup}
        entries={selections}
        summaryLabel={(entry) => `${entry.title} · ${entry.kind} · ${entry.classification}`}
        copyLabel={(entry) =>
          `${entry.draft.title} · ${entry.draft.kind} · ${entry.draft.classification}`
        }
        heading="Select and remove original submission copies from this page"
        findLabel="Find saved requests / First page"
        scopeNote="The directory contains summaries only. Inspect the complete selected requests before removing them. Removal affects only these saved browser copies; old tab copies, editing drafts, reviews, receipts, other pages and files are kept. It does not submit, query or cancel proposals. Keep a recovery file for unknown submission outcomes."
        disabled={locked}
        storageEpoch={storageEpoch}
        begin={begin}
        end={end}
        onStorageChange={onStorageChange}
      />
      {message && <p role="status">{message}</p>}
    </section>
  );
}
