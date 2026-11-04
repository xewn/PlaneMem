'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { isUlid } from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import { submitPackSave } from './actions';
import {
  decodePackSaveOriginal,
  encodePackSaveOriginal,
  type PackSaveOriginal,
} from './save-model';
import { preservePackOriginal } from './save-store';
import { packReadHref } from './packs/read/navigation';

export function PackSaveSubmission({
  original,
  recovered = false,
  onNew,
}: {
  original: PackSaveOriginal;
  recovered?: boolean;
  onNew?: () => void;
}) {
  const [request] = useState(() => decodePackSaveOriginal(encodePackSaveOriginal(original)));
  const raw = encodePackSaveOriginal(request);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(recovered);
  const [unusable, setUnusable] = useState(false);
  const [saved, setSaved] = useState<{ pack_id: string; version: number; trace: string }>();
  const [message, setMessage] = useState(
    recovered
      ? 'The complete original is loaded. It may already have been submitted; loading does not send it.'
      : 'Review this fixed request. Sending first saves and checks a browser recovery copy.',
  );
  const active = useRef(false);
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
    };
  }, []);
  async function run(kind: 'preserve' | 'send' | 'new') {
    if (
      active.current ||
      !mounted.current ||
      (kind === 'send' && (!confirmed || saved || unusable))
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    active.current = true;
    setBusy(true);
    setConfirmed(false);
    let sent = false;
    try {
      const result = await backupOperation(controller.signal, async (signal, check) => {
        await preservePackOriginal(request, signal, check);
        check();
        if (kind !== 'send') return null;
        sent = true;
        if (mounted.current) setAttempted(true);
        const data = new FormData();
        data.set('original', raw);
        data.set('confirmed', 'yes');
        const result = await submitPackSave(data);
        check();
        if (result.original !== raw) throw new TypeError();
        return result;
      });
      if (!mounted.current || operation.current !== controller) return;
      if (!result) {
        setMessage(
          'The complete original is saved and checked in this browser. No save request was sent by this action.',
        );
        if (kind === 'new') onNew?.();
      } else if (result.status === 'saved') {
        if (!isUlid(result.pack_id) || !Number.isSafeInteger(result.version) || result.version < 1)
          throw new TypeError();
        setSaved({ pack_id: result.pack_id, version: result.version, trace: result.trace });
        setMessage(
          'The server verified the complete saved pack. The original browser copy is retained.',
        );
      } else {
        setUnusable(result.unusable);
        setMessage(result.message + (result.trace ? ' Trace: ' + result.trace : ''));
      }
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          sent
            ? 'The save result is unknown. Keep this original unchanged; stopping the wait does not cancel a server save.'
            : 'Browser storage could not be confirmed, so this attempt did not send a pack save. Keep or export the original; an earlier save may still exist.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  function download() {
    if (active.current) return;
    try {
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'context-pack-original.json';
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage('A download was requested. Keep the file; this does not confirm a pack save.');
    } catch {
      setMessage('The original file could not be downloaded. Keep this page open.');
    }
  }
  return (
    <div className="handoff-form context-pack-form">
      <p>Original request · {request.request_key}</p>
      <p>Gateway · {request.binding.gateway_url}</p>
      <p>Project · {request.binding.identity.project_id}</p>
      <p>
        Account · {request.binding.identity.actor_id} · Client ·{' '}
        {request.binding.identity.client_id}
      </p>
      <p>
        Tenant · {request.binding.identity.tenant_id} · Workspace ·{' '}
        {request.binding.identity.workspace_id}
      </p>
      <p>
        Budget · {request.parameters.budget_tokens} · Maximum lifetime ·{' '}
        {request.parameters.ttl_seconds} seconds
      </p>
      <p>Restricted context · {request.binding.read_restricted ? 'allowed' : 'excluded'}</p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void run('preserve')}
      >
        Save original in this browser
      </button>
      <button type="button" className="secondary-button" disabled={busy} onClick={download}>
        Export original request
      </button>
      {!saved && !unusable && (
        <>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{' '}
            I reviewed this original request and want to send it. A retry may save it if the earlier
            attempt did not.
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !confirmed}
            onClick={() => void run('send')}
          >
            {busy ? 'Working…' : attempted ? 'Retry original save' : 'Save ContextPack'}
          </button>
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
      {saved && (
        <p>
          <Link prefetch={false} href={packReadHref({ pack_id: saved.pack_id })}>
            Open saved pack {saved.pack_id} · version {saved.version}
          </Link>
        </p>
      )}
      {onNew && (!attempted || saved || unusable) && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void run('new')}
        >
          Keep original and prepare a separate request
        </button>
      )}
      <p>
        <Link href="/context/packs/recover" prefetch={false}>
          Recover saved original requests
        </Link>
      </p>
      <p>
        Browser copies contain the request, not a persistent save receipt. Clearing browser data can
        remove them. Keep an exported copy.
      </p>
    </div>
  );
}
