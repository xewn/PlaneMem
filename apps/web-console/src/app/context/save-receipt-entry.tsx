'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  parseContextPackSaveReceiptDocument,
  encodePackSaveOriginal,
  type ContextPackSaveReceiptDocument,
} from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import {
  preparePackReceiptHistory,
  preservePackReceiptHistory,
  removePackReceiptHistory,
} from './save-receipt-store';
import { packReadHref } from './packs/read/navigation';

function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export function PackReceiptHistoryEntry({
  document,
  disabled = false,
  begin,
  end,
  allowRemoval = false,
  onHistoryWrite,
  reviewGeneration = 0,
}: {
  document: ContextPackSaveReceiptDocument;
  disabled?: boolean;
  begin?: () => boolean;
  end?: () => void;
  allowRemoval?: boolean;
  onHistoryWrite?: () => void;
  reviewGeneration?: number;
}) {
  const [captured] = useState(() => parseContextPackSaveReceiptDocument(document));
  const [busy, setBusy] = useState(false);
  const [removalReviewed, setRemovalReviewed] = useState<number | null>(null);
  const removalReviewedRef = useRef<number | null>(null);
  const [message, setMessage] = useState(
    'This is a historical observation. Save or export it explicitly to keep a copy.',
  );
  const active = useRef(false);
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (disabled || !allowRemoval) {
      removalReviewedRef.current = null;
      setRemovalReviewed(null);
    }
  }, [disabled, allowRemoval]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      release.current?.();
      release.current = undefined;
    };
  }, []);
  async function run(kind: 'save' | 'export' | 'original' | 'remove') {
    if (kind === 'remove' && (!allowRemoval || removalReviewedRef.current !== reviewGeneration))
      return;
    if (!mounted.current || active.current || disabled || (begin && !begin())) return;
    active.current = true;
    removalReviewedRef.current = null;
    setRemovalReviewed(null);
    release.current = end;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      if (kind === 'save' || kind === 'remove') {
        try {
          onHistoryWrite?.();
        } catch {
          // Page notifications must not change the storage operation's result.
        }
      }
      if (kind === 'original') {
        download(encodePackSaveOriginal(captured.original), 'context-pack-original.json');
        setMessage(
          'An original request download was requested. Keep the file; no query or pack save was sent.',
        );
        return;
      }
      const result = await backupOperation(controller.signal, async (signal, check) => {
        const candidate = await preparePackReceiptHistory(captured, check);
        if (kind === 'save')
          await preservePackReceiptHistory(candidate.raw, captured.original.binding, signal, check);
        const removal =
          kind === 'remove'
            ? await removePackReceiptHistory(
                candidate.raw,
                captured.original.binding,
                signal,
                check,
              )
            : undefined;
        check();
        return { candidate, removal };
      });
      if (!mounted.current || operation.current !== controller) return;
      if (kind === 'export') download(result.candidate.raw, 'context-pack-save-receipt.json');
      setMessage(
        kind === 'remove'
          ? result.removal === 'removed'
            ? 'The matching browser copy was removed and its absence read back. This complete review copy remains available for export or explicit saving. Read history again to see the current directory.'
            : 'No matching browser copy was present in this read. This complete review copy remains available for export or explicit saving. Read history again to see the current directory.'
          : kind === 'save'
            ? 'This complete observation was saved and read back in this browser. Its original time and result are unchanged.'
            : 'A download was requested. Keep the file; this does not confirm that your browser stored the download.',
      );
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          kind === 'remove'
            ? 'Removal could not be confirmed; the browser copy may or may not remain. Keep or export this complete review copy and read history again. No gateway query or pack save was sent.'
            : 'Local saving or export could not be confirmed. This complete observation remains here; keep or export it before leaving. No gateway query or pack save was sent.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        release.current?.();
        release.current = undefined;
        if (mounted.current) setBusy(false);
      }
    }
  }
  const original = captured.original;
  const data = captured.receipt.data;
  return (
    <section aria-label="Historical context pack save observation">
      <h2>
        {data.status === 'recorded'
          ? 'Historical save recorded'
          : 'Historical lookup: no record observed'}
      </h2>
      <p>Observed locally · {captured.observed_at}</p>
      <p>Original request · {original.request_key}</p>
      <p>
        Gateway · {original.binding.gateway_url} · Project · {original.binding.identity.project_id}
      </p>
      <p>
        Account · {original.binding.identity.actor_id} · Client ·{' '}
        {original.binding.identity.client_id}
      </p>
      {data.status === 'recorded' ? (
        <>
          <p>
            Pack · {data.receipt.pack_id} · Version · {data.receipt.version}
          </p>
          <p>
            Saved · {data.receipt.created_at} · Expires · {data.receipt.expires_at}
          </p>
          <p>
            Budget · {data.receipt.budget_tokens} · Used · {data.receipt.used_tokens}
          </p>
          <Link prefetch={false} href={packReadHref({ pack_id: data.receipt.pack_id })}>
            Open this pack using the current session
          </Link>
        </>
      ) : (
        <p>This snapshot does not prove that the save failed or permit an automatic retry.</p>
      )}
      <p>
        Content, sources and current server state have not been checked. A file or browser copy does
        not authenticate the server. Loading this history sends no save.
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || disabled}
        onClick={() => void run('save')}
      >
        Save this observation in browser
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || disabled}
        onClick={() => void run('export')}
      >
        Export historical receipt
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || disabled}
        onClick={() => void run('original')}
      >
        Export its original request
      </button>
      {allowRemoval && (
        <fieldset disabled={busy || disabled} className="handoff-form" style={{ minWidth: 0 }}>
          <legend>Remove this saved browser copy</legend>
          <p>
            Only the matching historical observation in this browser will be removed. The original
            request, server pack and other observations are unchanged. Keep an exported receipt if
            you need a copy after leaving this page.
          </p>
          <label className="confirmation-box">
            <input
              type="checkbox"
              checked={removalReviewed === reviewGeneration}
              onChange={(event) => {
                if (active.current || disabled) return;
                const reviewed = event.target.checked ? reviewGeneration : null;
                removalReviewedRef.current = reviewed;
                setRemovalReviewed(reviewed);
              }}
            />
            I have reviewed this complete observation and want to remove its saved browser copy.
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || disabled || removalReviewed !== reviewGeneration}
            onClick={() => void run('remove')}
          >
            Remove this browser copy
          </button>
        </fieldset>
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
      <details>
        <summary>Complete original and historical response</summary>
        <pre>{JSON.stringify(captured, null, 2)}</pre>
      </details>
    </section>
  );
}
