'use client';

import { useEffect, useRef, useState } from 'react';
import {
  parseConflictReadQuery,
  type ConflictCommandIdentity,
  type ConflictReceiptQuery,
} from '@planemem/contracts';
import { OriginalConflictRequest } from '../original-request';
import { decodeScopedConflictOriginal } from '../original-model';
import { loadBrowserConflictOriginal, loadLegacyConflictOriginal } from '../original-store';
import { CONFLICT_RECEIPT_REQUEST_BYTES, encodeConflictRequest } from '../receipt/model';

export function ConflictRecoveryLoader({ identity }: { identity: ConflictCommandIdentity }) {
  const [id, setId] = useState('');
  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState<ConflictReceiptQuery>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const loaded = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function accept(raw: unknown, conflictId?: string) {
    if (!mounted.current) return;
    const request = decodeScopedConflictOriginal(raw, identity, conflictId);
    loaded.current = true;
    setOriginal(request);
    setDraft('');
    setMessage('');
  }
  async function loadStored(source: 'browser' | 'legacy') {
    if (active.current || loaded.current) return;
    active.current = true;
    setBusy(true);
    setMessage('');
    try {
      const conflictId = parseConflictReadQuery({ conflict_id: id }).conflict_id;
      const request =
        source === 'browser'
          ? await loadBrowserConflictOriginal(identity, conflictId)
          : loadLegacyConflictOriginal(identity, conflictId);
      if (!mounted.current) return;
      if (request === undefined) {
        setMessage(
          source === 'browser'
            ? 'No original was found in this exact browser slot. Check the old copy in this tab or import an exported file. Missing local data does not establish the decision outcome.'
            : 'No old original was found in this exact tab slot. Load the browser copy or import an exported file. Missing local data does not establish the decision outcome.',
        );
        return;
      }
      accept(encodeConflictRequest(request), conflictId);
    } catch {
      if (!mounted.current) return;
      setMessage(
        'This saved original could not be read or did not match the original identity and conflict. Nothing was replaced. Try the other saved copy or import an exported file.',
      );
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function importText() {
    if (active.current || loaded.current) return;
    try {
      accept(draft);
    } catch {
      setMessage(
        'Use complete original request JSON within 1 MB, belonging to this account, client and project. No decision was sent.',
      );
    }
  }
  async function importFile(file: File | undefined) {
    if (!file || active.current || loaded.current) return;
    if (file.size > CONFLICT_RECEIPT_REQUEST_BYTES) {
      setMessage('Use an original request file no larger than 1 MB.');
      return;
    }
    active.current = true;
    setBusy(true);
    try {
      accept(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
    } catch {
      if (!mounted.current) return;
      setMessage(
        'Use valid UTF-8 original request JSON within 1 MB for this account, client and project. Nothing was sent or replaced.',
      );
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (original) return <OriginalConflictRequest original={original} />;
  return (
    <div className="side-detail" aria-busy={busy}>
      <p>
        Load one exact saved request from this browser, read an old copy kept in this tab, or import
        an exported file. Loading keeps the original identity, version, parameters and key. It does
        not query a receipt, send a decision or replace another saved copy.
      </p>
      <form
        className="handoff-form"
        onSubmit={(event) => {
          event.preventDefault();
          void loadStored('browser');
        }}
      >
        <label>
          Original conflict ID
          <input
            required
            maxLength={255}
            spellCheck={false}
            value={id}
            disabled={busy}
            onChange={(event) => setId(event.target.value)}
          />
        </label>
        <button className="secondary-button" disabled={busy || !id}>
          Load original from this browser
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={busy || !id}
          onClick={() => void loadStored('legacy')}
        >
          Read old copy from this tab
        </button>
      </form>
      <label>
        Import original request JSON (up to 1 MB)
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void importFile(file);
          }}
        />
      </label>
      <label>
        Or paste complete original JSON
        <textarea
          rows={8}
          spellCheck={false}
          maxLength={CONFLICT_RECEIPT_REQUEST_BYTES}
          disabled={busy}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button
        className="secondary-button"
        type="button"
        disabled={busy || !draft}
        onClick={importText}
      >
        Review imported original
      </button>
      <p className="muted">
        Browser copies can survive closing tabs in the same profile, but clearing browser data can
        remove them. Old tab-only copies need an explicit browser save before that tab is closed.
        Exported files may include merged content and account identifiers. Keep every original field
        unchanged.
      </p>
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
