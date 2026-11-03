'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProposalSubmissionBinding } from '../original-model';
import {
  listBrowserProposalOriginals,
  type SavedProposalOriginal,
  type SavedProposalOriginalPage,
} from '../original-store';

export function SavedProposalOriginals({
  binding,
  disabled,
  onSelect,
}: {
  binding: ProposalSubmissionBinding;
  disabled: boolean;
  onSelect: (entry: SavedProposalOriginal) => void;
}) {
  const [page, setPage] = useState<SavedProposalOriginalPage>();
  const [after, setAfter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = undefined;
    },
    [],
  );

  async function read(cursor: string | null) {
    if (disabled || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setAfter(cursor);
    setPage(undefined);
    setMessage('Reading saved request summaries…');
    try {
      const result = await listBrowserProposalOriginals(binding, cursor, controller.signal);
      if (operation.current !== controller || controller.signal.aborted) return;
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
        setBusy(false);
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
      {message && <p role="status">{message}</p>}
    </section>
  );
}
