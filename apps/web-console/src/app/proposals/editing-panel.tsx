'use client';

import { useEffect, useRef, useState } from 'react';
import { proposalReceiptJson } from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import {
  assertProposalSubmissionBinding,
  encodeProposalOriginal,
  type ProposalOriginal,
  type ProposalSubmissionBinding,
} from './original-model';
import { loadBrowserProposalOriginal, loadLegacyProposalOriginal } from './original-store';
import {
  decodeProposalEditingDraft,
  encodeProposalEditingDraft,
  parseProposalEditingDraft,
  proposalEditingCommand,
  PROPOSAL_EDITING_BYTES,
  type ProposalEditingDraft,
  type ProposalEditingFields,
} from './editing-model';
import {
  listProposalEditingDrafts,
  loadProposalEditingDraft,
  saveProposalEditingDraft,
  type ProposalEditingPage,
} from './editing-store';

export function ProposalEditingPanel({
  binding,
  requestKey,
  fields,
  disabled,
  restricted,
  begin,
  end,
  onLoad,
  onOriginal,
}: {
  binding: ProposalSubmissionBinding;
  requestKey: string;
  fields: ProposalEditingFields;
  disabled: boolean;
  restricted: boolean;
  begin: () => boolean;
  end: () => void;
  onLoad: (draft: ProposalEditingDraft) => void;
  onOriginal: (original: ProposalOriginal) => void;
}) {
  const [page, setPage] = useState<ProposalEditingPage>();
  const [candidate, setCandidate] = useState<ProposalEditingDraft>();
  const [replace, setReplace] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const operation = useRef<AbortController | undefined>(undefined);
  const retained = useRef<ProposalEditingDraft | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
    };
  }, []);
  useEffect(() => setReplace(null), [requestKey]);
  function snapshot() {
    const draft = parseProposalEditingDraft({
      schema_version: 1,
      kind: 'proposal-editing-draft',
      binding,
      request_key: requestKey,
      saved_at:
        retained.current?.request_key === requestKey
          ? retained.current.saved_at
          : new Date().toISOString(),
      fields,
    });
    retained.current = draft;
    return draft;
  }
  async function run<T>(
    work: (signal: AbortSignal, check: () => void) => Promise<T>,
    receive: (result: T) => void,
  ) {
    if (disabled || operation.current || !begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    setMessage('Reading or saving the complete editing draft…');
    try {
      const result = await backupOperation(controller.signal, work);
      if (mounted.current && operation.current === controller && !controller.signal.aborted)
        receive(result);
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'The draft operation could not be confirmed. Keep your current text and any exported file. Reload saved drafts before retrying a save.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        end();
      }
    }
  }
  function review(draft: ProposalEditingDraft) {
    assertProposalSubmissionBinding(draft.binding, binding);
    if (draft.fields.values.classification === 'restricted' && !restricted) throw new TypeError();
    setCandidate(draft);
    setReplace(null);
    setMessage(
      'Review this saved editing copy, then confirm before replacing your current fields. Sources and submission results have not been checked.',
    );
  }
  async function readPage(after: string | null) {
    await run(
      (signal) => listProposalEditingDrafts(binding, after, signal),
      (result) => {
        setPage(result);
        setMessage(
          result.entries.length
            ? 'Select a saved editing draft to review it.'
            : 'No editing drafts on this page for this project and account.',
        );
      },
    );
  }
  return (
    <section aria-label="Save and resume editing drafts">
      <h3>Save your editing draft</h3>
      <p className="muted">
        Save unfinished fields in this browser or export a file to continue later. Preparing or
        submitting a proposal remains a separate step.
      </p>
      <div className="heading-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() =>
            void run(
              async (signal) => saveProposalEditingDraft(snapshot(), signal),
              (saved) => {
                retained.current = saved;
                setMessage(
                  'Editing draft saved in this browser. Keep a file copy if you need it on another device.',
                );
              },
            )
          }
        >
          Save editing draft
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() =>
            void run(
              async () => snapshot(),
              (draft) => {
                const raw = JSON.stringify(
                  decodeProposalEditingDraft(encodeProposalEditingDraft(draft)),
                  null,
                  2,
                );
                const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
                try {
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'proposal-editing-draft.json';
                  link.click();
                  setMessage(
                    'Draft file download requested. Check that the file was saved before leaving.',
                  );
                } finally {
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
              },
            )
          }
        >
          Export editing draft
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() => void readPage(null)}
        >
          Find saved drafts
        </button>
        {page?.next && (
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={() => void readPage(page.next)}
          >
            Next saved drafts
          </button>
        )}
      </div>
      <label>
        Import an editing draft file
        <input
          type="file"
          accept="application/json,.json"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void run(async (_signal, check) => {
              if (file.size < 1 || file.size > PROPOSAL_EDITING_BYTES) throw new TypeError();
              const raw = new TextDecoder('utf-8', { fatal: true }).decode(
                await file.arrayBuffer(),
              );
              check();
              const draft = decodeProposalEditingDraft(raw);
              assertProposalSubmissionBinding(draft.binding, binding);
              return draft;
            }, review);
          }}
        />
      </label>
      {page && (
        <ul>
          {page.entries.map((entry) => (
            <li key={entry.request_key}>
              <p>
                {entry.title || 'Untitled draft'} · {entry.classification} · saved {entry.saved_at}
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled}
                onClick={() =>
                  void run((signal) => loadProposalEditingDraft(binding, entry, signal), review)
                }
              >
                Review editing draft
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidate && (
        <div>
          <p>
            Selected: {candidate.fields.values.title || 'Untitled draft'} ·{' '}
            {candidate.fields.values.kind} · {candidate.fields.sources.length} sources · saved{' '}
            {candidate.saved_at}
          </p>
          <details>
            <summary>Review saved text</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {candidate.fields.values.content || '(No content yet)'}
            </pre>
          </details>
          <label>
            <input
              type="checkbox"
              checked={replace === requestKey}
              disabled={disabled}
              onChange={(event) => setReplace(event.target.checked ? requestKey : null)}
            />{' '}
            I want to replace the current editor fields with this saved copy.
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || replace !== requestKey}
            onClick={() =>
              void run(
                async (signal, check) => {
                  assertProposalSubmissionBinding(candidate.binding, binding);
                  if (candidate.fields.values.classification === 'restricted' && !restricted)
                    throw new TypeError();
                  const legacy = loadLegacyProposalOriginal(binding, candidate.request_key);
                  const browser = await loadBrowserProposalOriginal(
                    binding,
                    candidate.request_key,
                    signal,
                  );
                  check();
                  if (
                    legacy &&
                    browser &&
                    encodeProposalOriginal(legacy) !== encodeProposalOriginal(browser)
                  )
                    throw new TypeError();
                  const original = browser ?? legacy;
                  if (
                    original &&
                    proposalReceiptJson(original.draft) !==
                      proposalReceiptJson(proposalEditingCommand(candidate.fields))
                  )
                    throw new TypeError();
                  return { draft: candidate, original };
                },
                ({ draft, original }) => {
                  if (original) {
                    onOriginal(original);
                    return;
                  }
                  retained.current = draft;
                  onLoad(draft);
                  setCandidate(undefined);
                  setReplace(null);
                  setMessage(
                    'Editing draft loaded. Review its fields and sources before preparing a submission.',
                  );
                },
              )
            }
          >
            Continue from this copy
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
