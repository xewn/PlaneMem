'use client';

import { useEffect, useRef, useState } from 'react';
import { CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES, type PackSaveBinding } from '@planemem/contracts';
import { backupOperation } from '../../../sync/receipt/backup-operation';
import { PackReceiptHistoryEntry } from '../../save-receipt-entry';
import {
  inspectPackReceiptHistory,
  listPackReceiptHistory,
  type PackReceiptCandidate,
} from '../../save-receipt-store';

export function PackReceiptHistoryBrowser({ binding }: { binding: PackSaveBinding }) {
  const [page, setPage] = useState<{ entries: PackReceiptCandidate[]; next: string | null }>();
  const [selected, setSelected] = useState<PackReceiptCandidate>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Read saved observations for this identity, or import a receipt file for review. Nothing is saved automatically.',
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
  function begin() {
    if (!mounted.current || active.current) return false;
    active.current = true;
    setBusy(true);
    return true;
  }
  function end() {
    active.current = false;
    if (mounted.current) setBusy(false);
  }
  async function load(after: string | null, file?: File) {
    if (!begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    try {
      const result = await backupOperation(controller.signal, async (signal, check) => {
        if (file) {
          if (file.size < 1 || file.size > CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES)
            throw new TypeError();
          const bytes = await file.arrayBuffer();
          check();
          if (bytes.byteLength !== file.size) throw new TypeError();
          return {
            kind: 'file' as const,
            candidate: await inspectPackReceiptHistory(
              new TextDecoder('utf-8', { fatal: true }).decode(bytes),
              binding,
              check,
            ),
          };
        }
        return {
          kind: 'page' as const,
          page: await listPackReceiptHistory(binding, after, signal, check),
        };
      });
      if (!mounted.current || operation.current !== controller) return;
      if (result.kind === 'file') {
        setSelected(result.candidate);
        setMessage(
          'The complete file and digest match this original identity. It has not been saved here or queried against the gateway.',
        );
      } else {
        setPage(result.page);
        setMessage(
          result.page.entries.length
            ? 'Every observation on this page was read in full and checked against its digest. These are historical copies, not fresh gateway results.'
            : 'No observations were found on this page. Missing local history does not prove that a save failed.',
        );
      }
    } catch {
      if (mounted.current && operation.current === controller) {
        setPage(undefined);
        setMessage(
          'History could not be read completely or matched to this identity. Any earlier selected observation below is unchanged. Keep all copies. No gateway query or pack save was sent.',
        );
      }
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        end();
      }
    }
  }
  return (
    <div className="handoff-form">
      <p>
        Gateway · {binding.gateway_url} · Project · {binding.identity.project_id}
      </p>
      <p>
        Account · {binding.identity.actor_id} · Client · {binding.identity.client_id}
      </p>
      <p>Restricted context · {binding.read_restricted ? 'allowed' : 'excluded'}</p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void load(null)}
      >
        Read first page of history
      </button>
      {page?.next && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void load(page.next)}
        >
          Read next page of history
        </button>
      )}
      <label>
        Import historical receipt (up to 32 KiB)
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void load(null, file);
          }}
        />
      </label>
      {busy && operation.current && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => operation.current?.abort()}
        >
          Stop waiting
        </button>
      )}
      <p role="status">{message}</p>
      {page?.entries.map((entry) => (
        <div key={entry.file.document_sha256}>
          <p>
            {entry.file.document.observed_at} · {entry.file.document.original.request_key} ·{' '}
            {entry.file.document.receipt.data.status}
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => setSelected(entry)}
          >
            Review complete observation
          </button>
        </div>
      ))}
      {selected && (
        <PackReceiptHistoryEntry
          key={selected.file.document_sha256}
          document={selected.file.document}
          disabled={busy}
          begin={begin}
          end={end}
        />
      )}
      <p>
        Pages follow the saved digest order, not time order. Refresh the first page to include newer
        browser copies. Clearing browser data may remove these observations; keep exported files.
      </p>
    </div>
  );
}
