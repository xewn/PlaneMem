'use client';

import { useEffect, useRef, useState } from 'react';
import { OriginalProposalSubmission } from '../original-submission';
import {
  assertProposalSubmissionBinding,
  decodeProposalOriginal,
  proposalOriginalStorageKey,
  PROPOSAL_ORIGINAL_BYTES,
  type ProposalOriginal,
  type ProposalSubmissionBinding,
} from '../original-model';

export function ProposalRecoveryLoader({ binding }: { binding: ProposalSubmissionBinding }) {
  const [key, setKey] = useState('');
  const [raw, setRaw] = useState('');
  const [original, setOriginal] = useState<ProposalOriginal>();
  const [message, setMessage] = useState(
    'Load an original from this tab or import a complete exported file. Nothing is sent on load.',
  );
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function load(value: unknown) {
    const parsed = decodeProposalOriginal(value);
    assertProposalSubmissionBinding(parsed.binding, binding);
    setOriginal(parsed);
  }
  async function importFile(file: File | undefined) {
    if (!file || active.current) return;
    active.current = true;
    setBusy(true);
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
        onClick={() => {
          if (active.current) return;
          try {
            load(sessionStorage.getItem(proposalOriginalStorageKey(binding, key)));
          } catch {
            setMessage(
              'No complete matching original was found in this tab. Keep existing data and import its exported file.',
            );
          }
        }}
      >
        Load original from this tab
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
          if (active.current) return;
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
      <p role="status">{busy ? 'Reading original file…' : message}</p>
    </div>
  );
}
