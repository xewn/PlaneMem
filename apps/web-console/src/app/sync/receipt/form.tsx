'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  parseSyncEventReceiptEnvelope,
  parseSyncEventReceiptQuery,
  syncJsonSnapshot,
  SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
  type SyncEventReceiptEnvelope,
} from '@planemem/contracts';
import { Badge, Panel } from '../../../components/ui';
import { readWorkbenchJsonResponse } from '../../../lib/workbench-response';
import {
  listBrowserSyncOriginals,
  loadBrowserSyncOriginal,
  preserveBrowserSyncOriginal,
  removeBrowserSyncOriginal,
  type SavedSyncOriginal,
  type SavedSyncOriginalPage,
} from './original-store';
import {
  listBrowserSyncReceipts,
  loadBrowserSyncReceipt,
  preserveBrowserSyncReceipt,
  removeBrowserSyncReceipt,
  type SavedSyncReceipt,
  type SavedSyncReceiptPage,
} from './receipt-store';
import type { BrowserRemovalResult } from './browser-store';
import { StorageRemovalReview, type SyncStorageRemoval } from './storage-removal';
import {
  SYNC_EVENT_RECEIPT_FILE_BYTES,
  encodeSyncReceiptQuery,
  encodeSyncReceiptArchive,
  loadSyncReceiptInput,
  parseSyncReceiptFailure,
  receiptMessages,
  type LoadedSyncReceipt,
  type SyncReceiptReason,
} from './model';

function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function SyncReceiptForm() {
  const [draft, setDraft] = useState('');
  const [loaded, setLoaded] = useState<LoadedSyncReceipt>();
  const [receipt, setReceipt] = useState<SyncEventReceiptEnvelope>();
  const [failure, setFailure] = useState<{ reason: SyncReceiptReason; trace?: string }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const [archiveJson, setArchiveJson] = useState<string>();
  const [savedPage, setSavedPage] = useState<SavedSyncOriginalPage>();
  const [receiptPage, setReceiptPage] = useState<SavedSyncReceiptPage>();
  const [historyOrigin, setHistoryOrigin] = useState<'file' | 'browser'>('file');
  const [removal, setRemoval] = useState<SyncStorageRemoval>();
  const [removalResult, setRemovalResult] = useState<BrowserRemovalResult>();
  const removalChosen = useRef(false);
  const originalChosen = useRef(false);
  const active = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  }, []);

  async function load(source: string | File) {
    if (active.current || originalChosen.current || removalChosen.current || !mounted.current)
      return;
    active.current = true;
    setBusy(true);
    setMessage('');
    try {
      let raw: string;
      if (typeof source === 'string') raw = source;
      else {
        if (source.size > SYNC_EVENT_RECEIPT_FILE_BYTES) throw new TypeError();
        const bytes = await source.arrayBuffer();
        if (bytes.byteLength !== source.size || bytes.byteLength > SYNC_EVENT_RECEIPT_FILE_BYTES)
          throw new TypeError();
        raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
      const original = await loadSyncReceiptInput(raw);
      if (!mounted.current) return;
      originalChosen.current = true;
      setLoaded(original);
      setSavedPage(undefined);
      setReceiptPage(undefined);
      setHistoryOrigin('file');
      setDraft('');
      setMessage('Original event loaded. Review its identity and contents before checking.');
    } catch {
      if (mounted.current)
        setMessage(
          'Load complete original identity/event JSON or a valid saved receipt file. The file must fit its size limit and match its digest.',
        );
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function browserStorage<T>(
    action: (signal: AbortSignal) => Promise<T>,
    receive: (value: T) => void,
    errorMessage: string,
  ) {
    if (active.current || !mounted.current) return;
    active.current = true;
    setBusy(true);
    setMessage('');
    const controller = new AbortController();
    pending.current = controller;
    try {
      const value = await action(controller.signal);
      if (mounted.current && !controller.signal.aborted) receive(value);
    } catch {
      if (mounted.current) setMessage(errorMessage);
    } finally {
      controller.abort();
      pending.current = null;
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function browseSaved(after: string | null) {
    if (originalChosen.current || removalChosen.current) return;
    void browserStorage(
      (signal) => listBrowserSyncOriginals(after, signal),
      (page) => {
        setSavedPage(page);
        setReceiptPage(undefined);
        setMessage('Browser directory loaded. Choose an entry to read its complete original.');
      },
      'The browser directory could not be read. Any earlier page remains below. You can still import an original query or receipt file.',
    );
  }
  function loadSaved(selection: SavedSyncOriginal) {
    if (originalChosen.current || removalChosen.current) return;
    void browserStorage(
      (signal) => loadBrowserSyncOriginal(selection, signal),
      (query) => {
        if (!query) {
          setMessage(
            'This saved original is no longer present. Refresh the directory or import your separate copy.',
          );
          return;
        }
        originalChosen.current = true;
        setLoaded({ query });
        setSavedPage(undefined);
        setReceiptPage(undefined);
        setDraft('');
        setMessage(
          'Complete original loaded from this browser. Review it before explicitly checking delivery.',
        );
      },
      'This saved original could not be verified against the selected entry. Keep your separate copy and import it to continue.',
    );
  }
  function saveInBrowser() {
    if (!loaded) return;
    void browserStorage(
      (signal) => preserveBrowserSyncOriginal(loaded.query, signal),
      (state) =>
        setMessage(
          state === 'saved'
            ? 'Original query saved in this browser and read back. Use Browse saved originals after reopening. Keep a separate downloaded copy.'
            : 'The same complete original is already saved in this browser. Keep a separate downloaded copy.',
        ),
      'Browser saving could not be confirmed. Storage may be unavailable, damaged, or contain a different original for this identity and event. A write may have completed; keep this original and download a separate copy.',
    );
  }
  function browseReceipts(after: string | null) {
    if (originalChosen.current || removalChosen.current) return;
    void browserStorage(
      (signal) => listBrowserSyncReceipts(after, signal),
      (page) => {
        setReceiptPage(page);
        setSavedPage(undefined);
        setMessage(
          'Saved receipt directory loaded. Choose an entry to verify and review the complete historical file.',
        );
      },
      'The saved receipt directory could not be read. Any earlier directory remains visible. You can still import a separate receipt file.',
    );
  }
  function loadSavedReceipt(selection: SavedSyncReceipt) {
    if (originalChosen.current || removalChosen.current) return;
    void browserStorage(
      (signal) => loadBrowserSyncReceipt(selection, signal),
      (saved) => {
        if (!saved) {
          setMessage(
            'This saved receipt is no longer present. Refresh the directory or import your separate copy.',
          );
          return;
        }
        const { identity, event } = saved.document.receipt.data;
        const query = parseSyncEventReceiptQuery({ identity, event });
        originalChosen.current = true;
        setLoaded({ query, imported: saved });
        setHistoryOrigin('browser');
        setSavedPage(undefined);
        setReceiptPage(undefined);
        setDraft('');
        setMessage(
          'Saved historical receipt loaded and its digest checked. No new server lookup has been made.',
        );
      },
      'The saved receipt could not be verified against its digest and selected directory entry. Keep a separate copy; the directory does not confirm delivery.',
    );
  }
  function reviewRemoval(kind: 'original', selection: SavedSyncOriginal): void;
  function reviewRemoval(kind: 'receipt', selection: SavedSyncReceipt): void;
  function reviewRemoval(
    kind: 'original' | 'receipt',
    selection: SavedSyncOriginal | SavedSyncReceipt,
  ) {
    if (originalChosen.current || removalChosen.current) return;
    void browserStorage<SyncStorageRemoval | null>(
      async (signal) => {
        if (kind === 'original' && 'key' in selection) {
          const query = await loadBrowserSyncOriginal(selection, signal);
          return query ? { kind, selection, raw: encodeSyncReceiptQuery(query) } : null;
        }
        if (kind === 'receipt' && 'digest' in selection) {
          const file = await loadBrowserSyncReceipt(selection, signal);
          return file
            ? { kind, selection, raw: syncJsonSnapshot(file, SYNC_EVENT_RECEIPT_FILE_BYTES) }
            : null;
        }
        throw new TypeError();
      },
      (reviewed) => {
        if (!reviewed) {
          setMessage(
            'This browser copy is no longer present. Refresh the directory to see current entries.',
          );
          return;
        }
        removalChosen.current = true;
        setRemoval(reviewed);
        setRemovalResult(undefined);
        setMessage('Complete browser copy loaded for review. Nothing has been removed.');
      },
      'The selected browser copy could not be verified for removal. Nothing was removed by this review; refresh the directory or keep a separate copy.',
    );
  }
  function removeReviewedCopy() {
    if (!removal || removalResult !== undefined || originalChosen.current) return;
    const selected = removal;
    void browserStorage(
      (signal) =>
        selected.kind === 'original'
          ? removeBrowserSyncOriginal(selected.selection, selected.raw, signal)
          : removeBrowserSyncReceipt(selected.selection, selected.raw, signal),
      (result) => {
        setRemovalResult(result);
        if (selected.kind === 'original') {
          const key = selected.selection.key;
          setSavedPage((page) =>
            page
              ? {
                  ...page,
                  entries: page.entries.filter((entry) => entry.key !== key),
                }
              : page,
          );
        } else {
          const digest = selected.selection.digest;
          setReceiptPage((page) =>
            page
              ? {
                  ...page,
                  entries: page.entries.filter((entry) => entry.digest !== digest),
                }
              : page,
          );
        }
        setMessage(
          result === 'removed'
            ? 'The selected browser copy was removed. You can still download the reviewed copy before closing the review.'
            : 'The selected browser copy was already absent. You can still download the reviewed copy before closing the review.',
        );
      },
      'Removal could not be confirmed. The record may have changed, or removal may already have completed. The reviewed copy remains available below; close the review and refresh the directory before deciding what to do next.',
    );
  }
  function closeRemoval() {
    if (active.current || !mounted.current) return;
    removalChosen.current = false;
    setRemoval(undefined);
    setRemovalResult(undefined);
    setMessage('Review closed. Refresh the directory to see current browser entries.');
  }
  function downloadRemoval() {
    if (active.current || !removal || !mounted.current) return;
    try {
      download(
        removal.raw,
        removal.kind === 'original' ? 'sync-original-query.json' : 'sync-event-receipt.json',
      );
      setMessage(
        'Reviewed copy prepared for download. Browser download does not confirm that a file was saved.',
      );
    } catch {
      setMessage('Download could not be prepared. You can copy the complete reviewed JSON below.');
    }
  }
  function saveReceiptInBrowser(original: SyncEventReceiptEnvelope, expectedDigest?: string) {
    void browserStorage(
      (signal) => preserveBrowserSyncReceipt(original, signal, expectedDigest),
      (state) =>
        setMessage(
          state === 'saved'
            ? 'Complete receipt saved in this browser and read back. Use Browse saved receipts after reopening; it will be shown as history. Keep a separate downloaded copy.'
            : 'This complete receipt is already saved in this browser. It remains a historical copy after reopening.',
        ),
      'Receipt saving could not be confirmed. A write may have completed. The complete receipt and original remain on this page; keep a separate download or copy.',
    );
  }
  function downloadHistory() {
    if (active.current || !loaded?.imported || !mounted.current) return;
    try {
      download(JSON.stringify(loaded.imported), 'sync-event-receipt.json');
      setMessage(
        'Historical receipt file prepared for download with its original digest. Browser download does not confirm that a file was saved.',
      );
    } catch {
      setMessage(
        'Historical receipt download could not be prepared. Copy the complete saved file JSON below.',
      );
    }
  }
  async function lookup() {
    if (active.current || !loaded || !mounted.current) return;
    const original = loaded.query;
    active.current = true;
    setBusy(true);
    setMessage('');
    setFailure(undefined);
    const controller = new AbortController();
    pending.current = controller;
    const deadline = performance.now() + 35_000;
    const timer = setTimeout(() => controller.abort(), 35_000);
    let trace: string | undefined;
    try {
      trace = 'trace_web_sync_receipt_' + crypto.randomUUID();
      const response = await fetch('/sync/receipt/query', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-workctx-sync-receipt': '1',
          'x-trace-id': trace,
        },
        body: encodeSyncReceiptQuery(original),
      });
      let value: unknown;
      try {
        value = await readWorkbenchJsonResponse(
          response,
          controller.signal,
          SYNC_EVENT_RECEIPT_RESPONSE_BYTES,
          16384,
        );
        if (response.headers.get('x-trace-id') !== trace) throw new TypeError();
      } catch {
        if (controller.signal.aborted || performance.now() >= deadline) throw new Error('timeout');
        if (mounted.current) setFailure({ reason: 'invalid', trace });
        return;
      }
      if (controller.signal.aborted || performance.now() >= deadline) throw new Error('timeout');
      if (!mounted.current) return;
      if (!response.ok) {
        try {
          setFailure({ reason: parseSyncReceiptFailure(value, trace).error.reason, trace });
        } catch {
          setFailure({ reason: 'invalid', trace });
        }
        return;
      }
      try {
        const complete = parseSyncEventReceiptEnvelope(value, original, trace);
        if (controller.signal.aborted || performance.now() >= deadline) throw new Error('timeout');
        setReceipt(complete);
        setArchiveJson(undefined);
      } catch {
        setFailure({
          reason:
            controller.signal.aborted || performance.now() >= deadline ? 'timeout' : 'invalid',
          trace,
        });
      }
    } catch {
      if (mounted.current)
        setFailure({
          reason:
            controller.signal.aborted || performance.now() >= deadline ? 'timeout' : 'unavailable',
          ...(trace === undefined ? {} : { trace }),
        });
    } finally {
      clearTimeout(timer);
      controller.abort();
      pending.current = null;
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function saveOriginal() {
    if (active.current || !loaded || !mounted.current) return;
    try {
      download(encodeSyncReceiptQuery(loaded.query), 'sync-original-query.json');
      setMessage('Original query prepared for download. Keep a copy before leaving this page.');
    } catch {
      setShowOriginal(true);
      setMessage('Download could not be prepared. Copy the complete original query below.');
    }
  }
  async function saveReceipt() {
    if (active.current || !receipt || !mounted.current) return;
    const original = receipt;
    active.current = true;
    setBusy(true);
    try {
      const raw = await encodeSyncReceiptArchive(original);
      if (!mounted.current) return;
      setArchiveJson(raw);
      download(raw, 'sync-event-receipt.json');
      setMessage(
        'Receipt file prepared for download. Browser download does not confirm that a file was saved.',
      );
    } catch {
      if (mounted.current) {
        setShowResponse(true);
        setMessage(
          'Receipt download could not be prepared. The complete response remains below for copying.',
        );
      }
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div aria-busy={busy}>
      <Panel title={loaded ? 'Review the original event' : 'Load an original event'} icon="refresh">
        <div className="side-detail">
          <p>
            Use the saved query containing identity and event, or a receipt file exported by
            workctx. Loading a file stays in this page; checking sends the original query to the
            gateway.
          </p>
          <p className="muted">
            Use the original account, client and project with sync access. You can explicitly save
            the original query in this browser for later recovery. Browser data may be cleared; keep
            a separate downloaded copy. This page does not read or update your local queue.
          </p>
          {!loaded ? (
            <form
              className="handoff-form checkpoint-form"
              onSubmit={(event) => {
                event.preventDefault();
                void load(draft);
              }}
            >
              <label>
                Import original query or receipt JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy || removal !== undefined}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void load(file);
                  }}
                />
              </label>
              <label>
                Or paste saved JSON
                <textarea
                  rows={8}
                  value={draft}
                  maxLength={SYNC_EVENT_RECEIPT_FILE_BYTES}
                  spellCheck={false}
                  disabled={busy || removal !== undefined}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={busy || removal !== undefined || !draft}>
                Review original event
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || removal !== undefined}
                onClick={() => browseSaved(null)}
              >
                Browse saved originals
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || removal !== undefined}
                onClick={() => browseReceipts(null)}
              >
                Browse saved receipts
              </button>
            </form>
          ) : (
            <>
              <dl className="detail-grid" style={{ overflowWrap: 'anywhere' }}>
                <div>
                  <dt>Event</dt>
                  <dd>{loaded.query.event.event_id}</dd>
                </div>
                <div>
                  <dt>Event type</dt>
                  <dd>{loaded.query.event.event_type}</dd>
                </div>
                {Object.entries(loaded.query.identity).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replace(/_/g, ' ')}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="heading-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || removal !== undefined}
                  onClick={() => void lookup()}
                >
                  {busy ? 'Working…' : 'Check original delivery'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  onClick={saveOriginal}
                >
                  Download original query
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  onClick={saveInBrowser}
                >
                  Save original in this browser
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  aria-expanded={showOriginal}
                  aria-controls="sync-original-json"
                  onClick={() => setShowOriginal(!showOriginal)}
                >
                  {showOriginal ? 'Hide' : 'Review'} complete original
                </button>
                <Link href="/sync/receipt" target="_blank" rel="noreferrer" prefetch={false}>
                  Open another lookup ↗
                </Link>
              </div>
              {showOriginal && (
                <label id="sync-original-json">
                  Complete original query
                  <textarea
                    rows={12}
                    readOnly
                    spellCheck={false}
                    value={encodeSyncReceiptQuery(loaded.query)}
                  />
                </label>
              )}
            </>
          )}
          {message && <p role="status">{message}</p>}
        </div>
      </Panel>
      {removal && (
        <StorageRemovalReview
          key={
            removal.kind === 'original'
              ? `original:${removal.selection.key}`
              : `receipt:${removal.selection.digest}`
          }
          removal={removal}
          result={removalResult}
          busy={busy}
          onRemove={removeReviewedCopy}
          onClose={closeRemoval}
          onDownload={downloadRemoval}
        />
      )}
      {!loaded && savedPage && (
        <Panel title="Saved originals in this browser" icon="database">
          <div className="side-detail">
            <p className="muted">
              Up to 20 entries from this browser profile, across saved accounts and projects. This
              directory shows saved metadata; each complete original is checked when you load it.
              Saving an original does not save a receipt or confirm delivery. No server lookup has
              been made by opening this directory.
            </p>
            {savedPage.entries.length === 0 && <p>No saved originals were found on this page.</p>}
            {savedPage.entries.map((entry) => (
              <div key={entry.key} className="side-detail" style={{ overflowWrap: 'anywhere' }}>
                <dl className="detail-grid">
                  <div>
                    <dt>Event</dt>
                    <dd>{entry.metadata.event_id}</dd>
                  </div>
                  <div>
                    <dt>Event type</dt>
                    <dd>{entry.metadata.event_type}</dd>
                  </div>
                  {Object.entries(entry.metadata.identity).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key.replace(/_/g, ' ')}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Original bytes</dt>
                    <dd>{entry.metadata.original_bytes}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  aria-label={`Load complete original ${entry.metadata.event_id}`}
                  onClick={() => loadSaved(entry)}
                >
                  Load complete original
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  aria-label={`Review removal of saved original ${entry.metadata.event_id}`}
                  onClick={() => reviewRemoval('original', entry)}
                >
                  Remove browser copy…
                </button>
              </div>
            ))}
            <div className="heading-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy || removal !== undefined}
                onClick={() => browseSaved(null)}
              >
                Refresh from first page
              </button>
              {savedPage.next !== null && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  onClick={() => browseSaved(savedPage.next)}
                >
                  Next page
                </button>
              )}
            </div>
            <p className="muted">
              Pages reflect current browser storage. Entries can change between reads.
            </p>
          </div>
        </Panel>
      )}
      {!loaded && receiptPage && (
        <Panel title="Saved historical receipts in this browser" icon="database">
          <div className="side-detail">
            <p className="muted">
              Up to 20 saved entries across accounts and projects, ordered by document digest rather
              than time. Directory details are local metadata; the complete file and digest are
              checked when loaded. These entries do not confirm current server state.
            </p>
            {receiptPage.entries.length === 0 && <p>No saved receipts were found on this page.</p>}
            {receiptPage.entries.map((entry) => (
              <div key={entry.digest} className="side-detail" style={{ overflowWrap: 'anywhere' }}>
                <dl className="detail-grid">
                  <div>
                    <dt>Event</dt>
                    <dd>{entry.metadata.event_id}</dd>
                  </div>
                  <div>
                    <dt>Event type</dt>
                    <dd>{entry.metadata.event_type}</dd>
                  </div>
                  {Object.entries(entry.metadata.identity).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key.replace(/_/g, ' ')}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Directory reports</dt>
                    <dd>{entry.metadata.outcome}</dd>
                  </div>
                  <div>
                    <dt>Original query trace</dt>
                    <dd>{entry.metadata.query_trace}</dd>
                  </div>
                  <div>
                    <dt>File bytes</dt>
                    <dd>{entry.metadata.file_bytes}</dd>
                  </div>
                  <div>
                    <dt>Document digest</dt>
                    <dd>{entry.digest}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  aria-label={`Load saved receipt ${entry.metadata.query_trace}`}
                  onClick={() => loadSavedReceipt(entry)}
                >
                  Load complete historical receipt
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  aria-label={`Review removal of saved receipt ${entry.metadata.query_trace}`}
                  onClick={() => reviewRemoval('receipt', entry)}
                >
                  Remove browser copy…
                </button>
              </div>
            ))}
            <div className="heading-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy || removal !== undefined}
                onClick={() => browseReceipts(null)}
              >
                Refresh from first page
              </button>
              {receiptPage.next !== null && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  onClick={() => browseReceipts(receiptPage.next)}
                >
                  Next page
                </button>
              )}
            </div>
            <p className="muted">
              Pages reflect current browser storage and can change between reads.
            </p>
          </div>
        </Panel>
      )}
      {loaded?.imported && (
        <>
          <ReceiptSummary
            receipt={loaded.imported.document.receipt}
            historical
            historyOrigin={historyOrigin}
          />
          <p className="muted" style={{ overflowWrap: 'anywhere' }}>
            Historical document digest · {loaded.imported.document_sha256}. The digest checks file
            consistency, not server authenticity.
          </p>
          <Panel title="Keep this historical receipt" icon="database">
            <div className="side-detail">
              <div className="heading-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  onClick={() => {
                    const saved = loaded.imported;
                    if (saved) saveReceiptInBrowser(saved.document.receipt, saved.document_sha256);
                  }}
                >
                  Save historical receipt in this browser
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  onClick={downloadHistory}
                >
                  Download historical receipt
                </button>
              </div>
              <details>
                <summary>Copy complete historical file JSON</summary>
                <textarea
                  rows={8}
                  readOnly
                  spellCheck={false}
                  value={JSON.stringify(loaded.imported)}
                  aria-label="Complete historical receipt file JSON"
                />
              </details>
            </div>
          </Panel>
        </>
      )}
      {failure && (
        <Panel title="Latest lookup did not complete" icon="refresh">
          <div className="side-detail" role="alert">
            <p>{receiptMessages[failure.reason]}</p>
            {failure.trace && <p>Lookup trace · {failure.trace}</p>}
            <p>Your original query and any earlier complete response remain available.</p>
            {(failure.reason === 'signin' || failure.reason === 'denied') && (
              <Link href="/login" target="_blank" rel="noreferrer" prefetch={false}>
                Renew sign-in in a new tab ↗
              </Link>
            )}
          </div>
        </Panel>
      )}
      {receipt && (
        <>
          <ReceiptSummary receipt={receipt} historical={false} />
          <Panel title="Keep the complete response" icon="database">
            <div className="side-detail">
              <div className="heading-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  onClick={() => void saveReceipt()}
                >
                  Save receipt file
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  onClick={() => saveReceiptInBrowser(receipt)}
                >
                  Save this lookup in this browser
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || removal !== undefined}
                  aria-expanded={showResponse}
                  aria-controls="sync-response-json"
                  onClick={() => setShowResponse(!showResponse)}
                >
                  {showResponse ? 'Hide' : 'Show'} complete response
                </button>
              </div>
              {showResponse && (
                <label id="sync-response-json">
                  Complete server response
                  <textarea rows={12} readOnly spellCheck={false} value={JSON.stringify(receipt)} />
                </label>
              )}
              {archiveJson && (
                <details>
                  <summary>Copy prepared receipt file JSON</summary>
                  <textarea
                    rows={8}
                    readOnly
                    spellCheck={false}
                    value={archiveJson}
                    aria-label="Prepared receipt file JSON"
                  />
                </details>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function ReceiptSummary({
  receipt,
  historical,
  historyOrigin = 'file',
}: {
  receipt: SyncEventReceiptEnvelope;
  historical: boolean;
  historyOrigin?: 'file' | 'browser';
}) {
  const data = receipt.data;
  const recorded = data.status === 'recorded' ? data.receipt : undefined;
  return (
    <Panel
      title={
        historical
          ? historyOrigin === 'browser'
            ? 'Saved historical receipt'
            : 'Imported historical receipt'
          : 'Most recent completed lookup'
      }
      icon="refresh"
    >
      <div className="side-detail" role="status" style={{ overflowWrap: 'anywhere' }}>
        <Badge tone={historical ? 'neutral' : recorded?.accepted ? 'green' : 'yellow'}>
          {historical
            ? historyOrigin === 'browser'
              ? 'Saved copy reports: '
              : 'File reports: '
            : ''}
          {recorded
            ? recorded.accepted
              ? 'Delivery recorded as accepted'
              : 'Delivery recorded with a conflict'
            : 'No matching receipt observed'}
        </Badge>
        {historical && (
          <p>
            This is a historical copy. Loading or saving it does not perform a new server lookup.
          </p>
        )}
        {!recorded && (
          <p>
            No matching receipt in this observation does not prove failure or permit sending a
            replacement event.
          </p>
        )}
        {recorded && (
          <>
            <p>
              This describes the recorded original delivery. Source application, current conflict
              resolution and local queue settlement have not been checked.
            </p>
            <dl className="detail-grid">
              <div>
                <dt>Server event</dt>
                <dd>{recorded.server_event_id}</dd>
              </div>
              <div>
                <dt>Server cursor</dt>
                <dd>{recorded.server_cursor}</dd>
              </div>
              <div>
                <dt>Recorded</dt>
                <dd>{recorded.recorded_at}</dd>
              </div>
              <div>
                <dt>Original delivery trace</dt>
                <dd>{recorded.original_trace_id}</dd>
              </div>
              {recorded.conflict_id && (
                <div>
                  <dt>Conflict</dt>
                  <dd>{recorded.conflict_id}</dd>
                </div>
              )}
            </dl>
            {!historical && recorded.conflict_id && (
              <Link
                href={{ pathname: '/conflicts/detail', query: { conflict: recorded.conflict_id } }}
                target="_blank"
                rel="noreferrer"
                prefetch={false}
              >
                Read current conflict details ↗
              </Link>
            )}
          </>
        )}
        <p>Query trace · {receipt.trace_id}</p>
      </div>
    </Panel>
  );
}
