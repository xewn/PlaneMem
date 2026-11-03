'use client';

import { useEffect, useRef, useState } from 'react';
import { Panel } from '../../../components/ui';

interface ReviewedBackup<T> {
  file: { document: { entries: T[] }; document_sha256: string };
  raw: string;
}
interface RestoreResult {
  status: 'restored' | 'already-present' | 'empty';
  total: number;
  restored: number;
  already_present: number;
}
interface BackupReviewProps<T> {
  title: string;
  scope: string;
  kindLabel: string;
  filename: string;
  entryLimit: number;
  prepare: (signal: AbortSignal) => Promise<ReviewedBackup<T>>;
  load: (file: File, signal: AbortSignal) => Promise<ReviewedBackup<T>>;
  restore: (raw: string, signal: AbortSignal) => Promise<RestoreResult>;
  describe: (entry: T) => { label: string; value: string }[];
}
export function BackupReviewForm<T>(props: BackupReviewProps<T>) {
  const [reviewed, setReviewed] = useState<ReviewedBackup<T>>();
  const [origin, setOrigin] = useState<'browser' | 'file'>('file');
  const [restored, setRestored] = useState<RestoreResult>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [offset, setOffset] = useState(0);
  const active = useRef(false);
  const selected = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<AbortController | null>(null);
  const review = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (reviewed) review.current?.focus();
  }, [reviewed]);
  async function run<U>(
    action: (signal: AbortSignal) => Promise<U>,
    receive: (result: U) => void,
    failure: string,
  ) {
    if (active.current || !mounted.current) return;
    active.current = true;
    setBusy(true);
    setMessage('');
    const controller = new AbortController();
    pending.current = controller;
    try {
      const result = await action(controller.signal);
      if (mounted.current && !controller.signal.aborted) receive(result);
    } catch {
      if (mounted.current) setMessage(failure);
    } finally {
      controller.abort();
      pending.current = null;
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function choose(result: ReviewedBackup<T>, source: 'browser' | 'file') {
    selected.current = true;
    setReviewed(result);
    setOrigin(source);
    setRestored(undefined);
    setConfirmed(false);
    setOffset(0);
    setMessage(
      source === 'browser'
        ? 'Complete backup prepared. Download it to keep a separate copy.'
        : 'Backup file checked. Review the accounts, projects and original events before restoring.',
    );
  }
  function prepare() {
    if (selected.current) return;
    void run(
      props.prepare,
      (result) => choose(result, 'browser'),
      'The complete backup could not be prepared. Storage may be unavailable, inconsistent, or exceed the backup limits. No partial backup was produced; saved browser records were not changed.',
    );
  }
  function load(file: File) {
    if (selected.current) return;
    void run(
      (signal) => props.load(file, signal),
      (result) => choose(result, 'file'),
      'The file could not be fully checked within the backup limits. Keep the file; browser storage has not been changed by this import.',
    );
  }
  function restore() {
    if (!reviewed || !confirmed || restored || active.current) return;
    setConfirmed(false);
    const raw = reviewed.raw;
    void run(
      (signal) => props.restore(raw, signal),
      (result) => {
        setRestored(result);
        setMessage(
          `Restore completed: ${result.restored} added and ${result.already_present} already present. No delivery lookup was made.`,
        );
      },
      'Restore could not be confirmed. A saved record may differ, storage may be unavailable, or the write may already have completed. The complete backup remains below; browse saved records in another tab before deciding whether to retry.',
    );
  }
  function download() {
    if (!reviewed || active.current || !mounted.current) return;
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(new Blob([reviewed.raw], { type: 'application/json' }));
      link = document.createElement('a');
      link.href = url;
      link.download = props.filename;
      document.body.appendChild(link);
      link.click();
      setMessage(
        'Backup prepared for download. Check your downloaded files; this page cannot confirm that the file was saved.',
      );
    } catch {
      setMessage('Download could not be prepared. Copy the complete backup JSON below.');
    } finally {
      link?.remove();
      if (url) {
        const released = url;
        setTimeout(() => URL.revokeObjectURL(released), 1000);
      }
    }
  }
  function closeReview() {
    if (active.current || !mounted.current) return;
    selected.current = false;
    setReviewed(undefined);
    setRestored(undefined);
    setConfirmed(false);
    setMessage('Review closed. Saved browser records were not changed by closing this review.');
  }
  const entries = reviewed?.file.document.entries ?? [];
  return (
    <div aria-busy={busy}>
      <Panel title={props.title} icon="database">
        <div className="side-detail">
          <p>{props.scope}</p>
          <p className="muted">
            Up to {props.entryLimit} records and 32 MiB per backup, with additional content
            complexity limits. Backup files contain the complete original event data. Keep them in a
            location you trust.
          </p>
          {!reviewed && (
            <div className="heading-actions">
              <button type="button" className="primary-button" disabled={busy} onClick={prepare}>
                Prepare complete backup
              </button>
              <label>
                Open a matching backup file
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) load(file);
                  }}
                />
              </label>
            </div>
          )}
          {message && <p role="status">{message}</p>}
        </div>
      </Panel>
      {reviewed && (
        <Panel title="Review the complete backup" icon="database">
          <div
            className="side-detail"
            ref={review}
            tabIndex={-1}
            role="group"
            aria-label="Complete browser backup review"
          >
            <p>
              {origin === 'browser'
                ? 'Prepared from one browser storage snapshot.'
                : 'Loaded from a backup file.'}{' '}
              {entries.length} {props.kindLabel}.
            </p>
            <p className="muted" style={{ overflowWrap: 'anywhere' }}>
              Document digest · {reviewed.file.document_sha256}. This checks file consistency; it
              does not prove delivery or server authenticity.
            </p>
            {entries.length === 0 && <p>This backup is empty. There is nothing to restore.</p>}
            {entries.slice(offset, offset + 20).map((entry, index) => (
              <dl key={offset + index} className="detail-grid" style={{ overflowWrap: 'anywhere' }}>
                {props.describe(entry).map(({ label, value }) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ))}
            {entries.length > 20 && (
              <div className="heading-actions">
                <span>
                  Entries {offset + 1}–{Math.min(offset + 20, entries.length)} of {entries.length}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 20))}
                >
                  Previous entries
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || offset + 20 >= entries.length}
                  onClick={() => setOffset(offset + 20)}
                >
                  Next entries
                </button>
              </div>
            )}
            <details>
              <summary>Review or copy complete backup JSON</summary>
              <label>
                Complete backup
                <textarea rows={14} readOnly spellCheck={false} value={reviewed.raw} />
              </label>
            </details>
            <p>
              Restoring adds only missing saved records. Existing copies must match completely;
              conflicting copies stop the whole restore. Other saved records remain unchanged.
            </p>
            {!restored && entries.length > 0 && (
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />{' '}
                Restore all {entries.length} {props.kindLabel} from this backup into this browser.
              </label>
            )}
            {restored && (
              <p role="status">
                {restored.restored} records added; {restored.already_present} were already present.
                The backup remains available for download. No events were uploaded or acknowledged.
              </p>
            )}
            <div className="heading-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={download}>
                Download complete backup
              </button>
              {!restored && entries.length > 0 && (
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || !confirmed}
                  onClick={restore}
                >
                  Restore missing records
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={closeReview}
              >
                Close review
              </button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
