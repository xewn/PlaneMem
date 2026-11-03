'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { OriginalProposalSubmission } from '../original-submission';
import {
  assertProposalSubmissionBinding,
  decodeProposalOriginal,
  PROPOSAL_ORIGINAL_BYTES,
  type ProposalOriginal,
  type ProposalSubmissionBinding,
} from '../original-model';
import {
  loadBrowserProposalOriginal,
  loadLegacyProposalOriginal,
  type SavedProposalOriginal,
} from '../original-store';
import { SavedProposalOriginals } from './saved-originals';
import { ProposalBackupPanel } from './backup-panel';

export function ProposalRecoveryLoader({ binding }: { binding: ProposalSubmissionBinding }) {
  const [key, setKey] = useState('');
  const [raw, setRaw] = useState('');
  const [original, setOriginal] = useState<ProposalOriginal>();
  const [message, setMessage] = useState(
    'Find a saved browser request, read an old tab copy, or import a complete file. Loading does not save, replace or send a request.',
  );
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const mounted = useRef(false);
  const loaded = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const beginBackup = useCallback(() => {
    if (!mounted.current || active.current || loaded.current) return false;
    active.current = true;
    setBusy(true);
    return true;
  }, []);
  const endBackup = useCallback(() => {
    active.current = false;
    if (mounted.current) setBusy(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
    };
  }, []);
  function load(value: unknown) {
    const parsed = decodeProposalOriginal(value);
    assertProposalSubmissionBinding(parsed.binding, binding);
    if (!mounted.current) return;
    loaded.current = true;
    setOriginal(parsed);
  }
  async function loadStored(source: 'browser' | 'legacy', selection?: SavedProposalOriginal) {
    if (active.current || loaded.current || !mounted.current) return;
    const controller = new AbortController();
    operation.current = controller;
    active.current = true;
    setBusy(true);
    setMessage('Reading the complete original request…');
    try {
      const requestKey = selection?.metadata.request_key ?? key;
      const result =
        source === 'browser'
          ? await loadBrowserProposalOriginal(binding, requestKey, controller.signal, selection)
          : loadLegacyProposalOriginal(binding, requestKey);
      if (!mounted.current || operation.current !== controller || controller.signal.aborted) return;
      if (!result) {
        setMessage(
          'No complete original was found in this exact slot. Try another saved copy or the exported file. Missing local data does not confirm the submission outcome.',
        );
        return;
      }
      load(JSON.stringify(result));
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'The complete saved request could not be verified, or its summary changed. Nothing was replaced or sent. Reload the list, read another copy, or import its exported file.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function importFile(file: File | undefined) {
    if (!file || active.current || loaded.current) return;
    active.current = true;
    setBusy(true);
    setMessage('Reading original file…');
    try {
      if (file.size < 1 || file.size > PROPOSAL_ORIGINAL_BYTES) throw new TypeError();
      const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (!mounted.current) return;
      load(value);
    } catch {
      if (mounted.current)
        setMessage(
          'The file is incomplete, too large, or belongs to another gateway, project, account or client. The original file was not changed.',
        );
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (original) return <OriginalProposalSubmission original={original} />;
  return (
    <div className="handoff-form">
      <p>
        Account · {binding.identity.actor_id} · Client · {binding.identity.client_id}
      </p>
      <p>
        Project · {binding.identity.project_id} · Gateway · {binding.gateway_url}
      </p>
      <SavedProposalOriginals
        key={JSON.stringify(binding)}
        binding={binding}
        disabled={busy}
        onSelect={(entry) => void loadStored('browser', entry)}
      />
      <ProposalBackupPanel
        key={'backup:' + JSON.stringify(binding)}
        binding={binding}
        disabled={busy}
        begin={beginBackup}
        end={endBackup}
      />
      <label>
        Original request key
        <input
          value={key}
          maxLength={255}
          disabled={busy}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || !key}
        onClick={() => void loadStored('browser')}
      >
        Load original from this browser
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || !key}
        onClick={() => void loadStored('legacy')}
      >
        Read old copy from this tab
      </button>
      <label>
        Import original request file
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void importFile(file);
          }}
        />
      </label>
      <label>
        Or paste complete original JSON
        <textarea
          rows={8}
          value={raw}
          maxLength={PROPOSAL_ORIGINAL_BYTES}
          disabled={busy}
          onChange={(event) => setRaw(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || !raw}
        onClick={() => {
          if (active.current || loaded.current) return;
          try {
            load(raw);
          } catch {
            setMessage(
              'Use complete original JSON no larger than 1 MiB for this gateway, project, account and client. No request was sent.',
            );
          }
        }}
      >
        Review imported original
      </button>
      <p className="muted">
        Browser copies can survive closing tabs in this profile. Old tab-only copies must be
        explicitly saved in the browser or exported before closing that tab. Clearing browser data
        can remove saved requests; keep a separate file for recovery on another device.
      </p>
      <p role="status">{message}</p>
    </div>
  );
}
