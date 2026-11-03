'use client';

import { useEffect, useRef, useState } from 'react';
import { proposalReceiptJson } from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import type { BrowserRemovalResult } from '../sync/receipt/browser-store';
import { EditingBackupPanel } from './editing-backup-panel';
import { useEditingAutosave } from './use-editing-autosave';
import {
  listEditingAutosaves,
  loadEditingAutosave,
  removeEditingAutosave,
  type EditingAutosavePage,
} from './editing-autosave-store';
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
  removeProposalEditingDraft,
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
  const [automaticPage, setAutomaticPage] = useState<EditingAutosavePage>();
  const autosave = useEditingAutosave({ binding, requestKey, fields, disabled, restricted });
  const [reviewed, setReviewed] = useState<{
    draft: ProposalEditingDraft;
    source: 'browser' | 'file' | 'autosave';
    session?: string;
  }>();
  const candidate = reviewed?.draft;
  const [removeConfirmed, setRemoveConfirmed] = useState(false);
  const [removalStatus, setRemovalStatus] = useState<BrowserRemovalResult | 'unknown'>();
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
    if (disabled || operation.current || !beginManual()) return;
    const controller = new AbortController();
    operation.current = controller;
    setMessage('Reading or updating the saved editing draft…');
    try {
      const result = await backupOperation(controller.signal, work);
      if (mounted.current && operation.current === controller && !controller.signal.aborted)
        receive(result);
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'The draft operation could not be confirmed. Keep your current text and any reviewed copy or exported file. Find saved or automatic drafts again before another storage change.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        end();
      }
    }
  }
  function beginManual() {
    if (!begin()) return false;
    autosave.pause();
    return true;
  }
  function review(
    draft: ProposalEditingDraft,
    source: 'browser' | 'file' | 'autosave',
    session?: string,
  ) {
    assertProposalSubmissionBinding(draft.binding, binding);
    if (draft.fields.values.classification === 'restricted' && !restricted) throw new TypeError();
    if (source === 'autosave' && !session) throw new TypeError();
    setReviewed({ draft, source, ...(session ? { session } : {}) });
    setReplace(null);
    setRemoveConfirmed(false);
    setRemovalStatus(undefined);
    setMessage(
      'Review this saved editing copy, then confirm before replacing your current fields. Sources and submission results have not been checked.',
    );
  }
  function download(draft: ProposalEditingDraft) {
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
      setMessage('Draft file download requested. Check that the file was saved before leaving.');
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
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
  async function readAutomaticPage(after: string | null) {
    await run(
      (signal) => listEditingAutosaves(binding, after, signal),
      (result) => {
        setAutomaticPage(result);
        setMessage(
          result.entries.length
            ? 'Select an automatic copy to review it. Automatic saving is paused while you review stored drafts.'
            : 'No automatic copies on this page for this project and account.',
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
      <label>
        <input
          type="checkbox"
          checked={autosave.enabled}
          disabled={disabled || (!autosave.enabled && !autosave.allowed)}
          onChange={(event) => {
            if (operation.current) return;
            if (event.target.checked) autosave.start();
            else autosave.pause();
          }}
        />{' '}
        Automatically save this editor in this browser
      </label>
      <p role="status">{autosave.message}</p>
      <p className="muted">
        Each start keeps one latest automatic copy after a short pause in typing. Draft actions
        pause automatic saving. Manual snapshots and their backups are separate; export an automatic
        copy or continue from it and save a manual snapshot to keep an archive.
      </p>
      <div className="heading-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() => void readAutomaticPage(null)}
        >
          Find automatic drafts
        </button>
        {automaticPage?.next && (
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={() => void readAutomaticPage(automaticPage.next)}
          >
            Next automatic drafts
          </button>
        )}
      </div>
      {automaticPage && (
        <ul>
          {automaticPage.entries.map((entry) => (
            <li key={entry.session_id}>
              <p>
                {entry.title || 'Untitled draft'} · {entry.classification} · automatically saved{' '}
                {entry.saved_at}
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled}
                onClick={() =>
                  void run(
                    (signal) => loadEditingAutosave(binding, entry, signal),
                    (draft) => review(draft, 'autosave', entry.session_id),
                  )
                }
              >
                Review automatic draft
              </button>
            </li>
          ))}
        </ul>
      )}
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
          onClick={() => void run(async () => snapshot(), download)}
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
            void run(
              async (_signal, check) => {
                if (file.size < 1 || file.size > PROPOSAL_EDITING_BYTES) throw new TypeError();
                const raw = new TextDecoder('utf-8', { fatal: true }).decode(
                  await file.arrayBuffer(),
                );
                check();
                const draft = decodeProposalEditingDraft(raw);
                assertProposalSubmissionBinding(draft.binding, binding);
                return draft;
              },
              (draft) => review(draft, 'file'),
            );
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
                  void run(
                    (signal) => loadProposalEditingDraft(binding, entry, signal),
                    (draft) => review(draft, 'browser'),
                  )
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
            Selected{' '}
            {reviewed?.source === 'autosave'
              ? 'automatic'
              : reviewed?.source === 'file'
                ? 'file'
                : 'manual'}{' '}
            copy: {candidate.fields.values.title || 'Untitled draft'} ·{' '}
            {candidate.fields.values.kind} · {candidate.fields.sources.length} sources · saved{' '}
            {candidate.saved_at}
          </p>
          <details>
            <summary>Review saved text</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {candidate.fields.values.content || '(No content yet)'}
            </pre>
          </details>
          <details>
            <summary>Review or copy all saved fields</summary>
            <label>
              Complete selected editing copy
              <textarea
                rows={10}
                readOnly
                spellCheck={false}
                value={JSON.stringify(candidate, null, 2)}
              />
            </label>
          </details>
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={() => void run(async () => candidate, download)}
          >
            Export selected copy
          </button>
          {(reviewed?.source === 'browser' || reviewed?.source === 'autosave') && (
            <div>
              <p>
                You can remove this saved editing copy from this browser. Your current editor,
                prepared requests and submitted proposals are kept. Export the selected copy first
                if you want to keep it after leaving this page.
              </p>
              {removalStatus === undefined ? (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={removeConfirmed}
                      disabled={disabled}
                      onChange={(event) => {
                        if (!operation.current) setRemoveConfirmed(event.target.checked);
                      }}
                    />{' '}
                    I want to remove this selected editing copy from this browser.
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={disabled || !removeConfirmed}
                    onClick={() => {
                      if (!removeConfirmed || removalStatus !== undefined) return;
                      void run(
                        (signal) => {
                          setRemoveConfirmed(false);
                          setReplace(null);
                          setRemovalStatus('unknown');
                          setPage(undefined);
                          setAutomaticPage(undefined);
                          if (reviewed.source === 'autosave') {
                            if (!reviewed.session) throw new TypeError();
                            return removeEditingAutosave(
                              binding,
                              reviewed.session,
                              candidate,
                              signal,
                            );
                          }
                          return removeProposalEditingDraft(binding, candidate, signal);
                        },
                        (result) => {
                          setRemovalStatus(result);
                          setMessage(
                            'The storage check finished. The selected copy remains below for export or continued editing. Find saved or automatic drafts again to refresh the directory.',
                          );
                        },
                      );
                    }}
                  >
                    Remove selected browser copy
                  </button>
                </>
              ) : (
                <p role="status">
                  {removalStatus === 'removed'
                    ? 'The reviewed editing copy was removed from browser storage.'
                    : removalStatus === 'not-present'
                      ? 'The selected editing copy was already absent when checked.'
                      : 'Removal is not confirmed. Keep or export the reviewed copy. If this operation does not complete, find saved or automatic drafts and review the current entry before another removal attempt.'}
                </p>
              )}
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={replace === requestKey}
              disabled={disabled}
              onChange={(event) => {
                if (!operation.current) setReplace(event.target.checked ? requestKey : null);
              }}
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
                  setReviewed(undefined);
                  setRemoveConfirmed(false);
                  setRemovalStatus(undefined);
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
      <EditingBackupPanel
        binding={binding}
        disabled={disabled}
        begin={beginManual}
        end={end}
        onStorageChange={() => {
          setPage(undefined);
          setRemoveConfirmed(false);
          setReplace(null);
        }}
      />
      {message && <p role="status">{message}</p>}
    </section>
  );
}
