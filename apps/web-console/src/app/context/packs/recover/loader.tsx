'use client';

import { useEffect, useRef, useState } from 'react';
import { backupOperation } from '../../../sync/receipt/backup-operation';
import {
  PACK_ORIGINAL_BYTES,
  assertPackSaveBinding,
  decodePackSaveOriginal,
  encodePackSaveOriginal,
  type PackSaveBinding,
  type PackSaveOriginal,
} from '../../save-model';
import { listPackOriginals } from '../../save-store';
import { PackSaveSubmission } from '../../save-submission';

export function PackSaveRecovery({ binding }: { binding: PackSaveBinding }) {
  const [page, setPage] = useState<{ originals: PackSaveOriginal[]; next: string | null }>();
  const [selected, setSelected] = useState<PackSaveOriginal>();
  const [message, setMessage] = useState(
    'List saved originals for this identity or import an exported original file.',
  );
  const [busy, setBusy] = useState(false);
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
  async function load(after: string | null, file?: File) {
    if (active.current || !mounted.current) return;
    const controller = new AbortController();
    operation.current = controller;
    active.current = true;
    setBusy(true);
    try {
      const result = await backupOperation(controller.signal, async (signal, check) => {
        if (file) {
          if (file.size < 1 || file.size > PACK_ORIGINAL_BYTES) throw new TypeError();
          const original = decodePackSaveOriginal(await file.text());
          check();
          assertPackSaveBinding(original.binding, binding);
          return { kind: 'original' as const, original };
        }
        return {
          kind: 'page' as const,
          page: await listPackOriginals(binding, after, signal, check),
        };
      });
      if (!mounted.current || operation.current !== controller) return;
      if (result.kind === 'original') setSelected(result.original);
      else {
        setPage(result.page);
        setMessage(
          result.page.originals.length
            ? 'Every original on this page was read in full and checked against its stored digest. Open one to review it.'
            : 'No originals were found on this page. Missing browser data does not prove a save failed; import an exported copy if available.',
        );
      }
    } catch {
      if (mounted.current && operation.current === controller) {
        setPage(undefined);
        setMessage(
          'The complete originals could not be read or matched to this identity. Keep every copy and restore the original permissions. Nothing was sent or overwritten.',
        );
      }
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  if (selected)
    return (
      <>
        <PackSaveSubmission key={encodePackSaveOriginal(selected)} original={selected} recovered />
        <button type="button" className="secondary-button" onClick={() => setSelected(undefined)}>
          Return to original requests
        </button>
      </>
    );
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
        Read first page of originals
      </button>
      {page?.next && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void load(page.next)}
        >
          Read next page
        </button>
      )}
      <label>
        Import original request file (up to 8 KiB)
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
      {page?.originals.map((original) => (
        <div key={original.request_key}>
          <p>
            {original.request_key} · budget {original.parameters.budget_tokens} · lifetime{' '}
            {original.parameters.ttl_seconds} seconds
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => setSelected(original)}
          >
            Review complete original
          </button>
        </div>
      ))}
      <p>
        These copies do not establish whether a pack was saved. Old forms without an original
        identity cannot be reconstructed here.
      </p>
    </div>
  );
}
