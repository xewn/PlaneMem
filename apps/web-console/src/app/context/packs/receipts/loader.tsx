'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CONTEXT_PACK_SAVE_RECEIPT_FILE_BYTES, type PackSaveBinding } from '@planemem/contracts';
import { backupOperation } from '../../../sync/receipt/backup-operation';
import { PackReceiptHistoryEntry } from '../../save-receipt-entry';
import { historyDateRangeError } from '../../../proposals/history-date-range';
import {
  PACK_RECEIPT_HISTORY_PAGE_SIZE,
  PACK_RECEIPT_HISTORY_SCAN_LIMIT,
  parsePackReceiptHistoryQuery,
  type PackReceiptHistoryQuery,
} from '../../save-receipt-query';
import {
  inspectPackReceiptHistory,
  listPackReceiptHistory,
  type PackReceiptCandidate,
  type PackReceiptHistoryPage,
} from '../../save-receipt-store';

const emptyFilters = { request_key: '', status: '', observed_from: '', observed_through: '' };
type Filters = typeof emptyFilters;
function firstQuery(filters: Filters) {
  return parsePackReceiptHistoryQuery({
    request_key: filters.request_key || null,
    status: filters.status || null,
    observed_from: filters.observed_from || null,
    observed_through: filters.observed_through || null,
    after: null,
  });
}

export function PackReceiptHistoryBrowser({ binding }: { binding: PackSaveBinding }) {
  const [filters, setFilters] = useState(emptyFilters);
  const filtersRef = useRef(emptyFilters);
  const [page, setPage] = useState<PackReceiptHistoryPage>();
  const pageRef = useRef<PackReceiptHistoryPage | undefined>(undefined);
  const helpId = useId();
  const [selected, setSelected] = useState<PackReceiptCandidate>();
  const [busy, setBusy] = useState(false);
  const [reviewGeneration, setReviewGeneration] = useState(0);
  const [message, setMessage] = useState(
    'Read saved observations for this identity, or import a receipt file for review. Nothing is saved automatically.',
  );
  const active = useRef(false);
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  let filterError: string | null = null;
  try {
    firstQuery(filters);
  } catch {
    filterError =
      historyDateRangeError(filters.observed_from, filters.observed_through) ??
      'Use an exact request key of 1–255 characters without whitespace or control characters, or leave it empty.';
  }
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
    setReviewGeneration((value) => value + 1);
    setBusy(true);
    return true;
  }
  function end() {
    active.current = false;
    if (mounted.current) setBusy(false);
  }
  function changeFilters(next: Filters) {
    if (active.current) return;
    setReviewGeneration((value) => value + 1);
    filtersRef.current = next;
    setFilters(next);
    pageRef.current = undefined;
    setPage(undefined);
    setMessage(
      'Filters changed. Read the first matching page. Any selected observation remains available below.',
    );
  }
  function readFirstPage() {
    if (active.current) return;
    try {
      void load(firstQuery(filtersRef.current));
    } catch {
      setMessage('Check the request key and UTC observation dates before reading history.');
    }
  }
  function readNextPage() {
    const next = pageRef.current?.next;
    if (next) void load(next);
  }
  function historyWriteStarted() {
    pageRef.current = undefined;
    setPage(undefined);
    setMessage(
      'A browser history change was requested. The selected review copy is retained. Read the first matching page again after the operation finishes.',
    );
  }
  async function load(query: PackReceiptHistoryQuery | null, file?: File) {
    if (!file && !query) return;
    if (!begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    if (!file) {
      pageRef.current = undefined;
      setPage(undefined);
    }
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
          page: await listPackReceiptHistory(binding, query!, signal, check),
        };
      });
      if (!mounted.current || operation.current !== controller) return;
      if (result.kind === 'file') {
        setSelected(result.candidate);
        setMessage(
          'The complete file and digest match this original identity. It has not been saved here or queried against the gateway.',
        );
      } else {
        pageRef.current = result.page;
        setPage(result.page);
        setMessage(
          result.page.entries.length
            ? 'Every scanned observation was read in full and checked against its digest before showing these matches. These remain historical copies.'
            : result.page.next
              ? 'No matches in this batch. Continue with the same filters to inspect later records. This does not prove that a save failed.'
              : 'No matches in the remaining records for these filters. Missing local history does not prove that a save failed.',
        );
      }
    } catch {
      if (mounted.current && operation.current === controller) {
        pageRef.current = undefined;
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          readFirstPage();
        }}
      >
        <fieldset
          className="handoff-form"
          disabled={busy}
          aria-describedby={`${helpId}${filterError ? ` ${helpId}-error` : ''}`}
          style={{ minWidth: 0 }}
        >
          <legend>Find saved observations</legend>
          <label>
            Exact original request key (optional)
            <input
              type="text"
              value={filters.request_key}
              maxLength={255}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                changeFilters({ ...filtersRef.current, request_key: event.target.value })
              }
            />
          </label>
          <label>
            Historical result
            <select
              value={filters.status}
              onChange={(event) =>
                changeFilters({ ...filtersRef.current, status: event.target.value })
              }
            >
              <option value="">All results</option>
              <option value="recorded">Recorded</option>
              <option value="not-observed">Not observed</option>
            </select>
          </label>
          <label>
            Observation date from (UTC, optional)
            <input
              type="text"
              placeholder="YYYY-MM-DD"
              value={filters.observed_from}
              maxLength={10}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                changeFilters({ ...filtersRef.current, observed_from: event.target.value })
              }
            />
          </label>
          <label>
            Observation date through (UTC, optional)
            <input
              type="text"
              placeholder="YYYY-MM-DD"
              value={filters.observed_through}
              maxLength={10}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                changeFilters({ ...filtersRef.current, observed_through: event.target.value })
              }
            />
          </label>
          <p id={helpId}>
            Use YYYY-MM-DD. Both dates are included and refer to when the result was observed, not
            when the pack was created or expires. Leave either date empty for no limit on that side.
            Each read checks at most {PACK_RECEIPT_HISTORY_SCAN_LIMIT} complete observations and
            shows at most {PACK_RECEIPT_HISTORY_PAGE_SIZE} matches. Imported files are reviewed
            separately.
          </p>
          {filterError && (
            <p id={`${helpId}-error`} role="status">
              {filterError}
            </p>
          )}
          <button type="submit" className="secondary-button" disabled={busy || !!filterError}>
            Read first matching page
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => changeFilters(emptyFilters)}
          >
            Clear filters
          </button>
        </fieldset>
      </form>
      {page?.next && (
        <button type="button" className="secondary-button" disabled={busy} onClick={readNextPage}>
          Continue with the same filters
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
      {page && (
        <p>
          Checked {page.scanned} observations in this batch · {page.entries.length} matches.
        </p>
      )}
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
            onClick={() => {
              if (!active.current && pageRef.current?.entries.includes(entry)) setSelected(entry);
            }}
          >
            Review complete observation
          </button>
        </div>
      ))}
      {selected && (
        <div>
          <p>Selected observation for review. It may be outside the current filters.</p>
          <PackReceiptHistoryEntry
            key={selected.file.document_sha256}
            document={selected.file.document}
            disabled={busy}
            begin={begin}
            end={end}
            allowRemoval
            onHistoryWrite={historyWriteStarted}
            reviewGeneration={reviewGeneration}
          />
        </div>
      )}
      <p>
        Pages follow the saved digest order, not time order. Refresh the first page to include newer
        browser copies. Clearing browser data may remove these observations; keep exported files.
      </p>
    </div>
  );
}
