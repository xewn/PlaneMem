'use client';

import { useEffect, useRef, useState } from 'react';
import { SYNC_ORIGINALS_BACKUP_MAX_ENTRIES } from '@planemem/contracts';
import { Panel } from '../../../../components/ui';
import {
  prepareBrowserOriginalsBackup,
  loadOriginalsBackup,
  restoreOriginalsBackup,
  type ReviewedOriginalBackup,
} from '../original-backup';
import type { OriginalBackupRestoreResult } from '../original-store';

export function OriginalBackupForm() {
  const [reviewed, setReviewed] = useState<ReviewedOriginalBackup>();
  const [origin, setOrigin] = useState<'browser' | 'file'>('file');
  const [restored, setRestored] = useState<OriginalBackupRestoreResult>();
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
  async function run<T>(
    action: (signal: AbortSignal) => Promise<T>,
    receive: (result: T) => void,
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
  function choose(result: ReviewedOriginalBackup, source: 'browser' | 'file') {
    selected.current = true;
    setReviewed(result);
    setOrigin(source);
    setRestored(undefined);
    setConfirmed(false);
    setOffset(0);
    setMessage(
      source === 'browser'
        ? 'Complete originals backup prepared. Download it to keep a separate copy.'
        : 'Backup file checked. Review the accounts, projects and original events before restoring.',
    );
  }
  function prepare() {
    if (selected.current) return;
    void run(
      prepareBrowserOriginalsBackup,
      (result) => choose(result, 'browser'),
      'The complete backup could not be prepared. Storage may be unavailable, inconsistent, or exceed the backup limits. No partial backup was produced; saved originals were not changed.',
    );
  }
  function load(file: File) {
    if (selected.current) return;
    void run(
      (signal) => loadOriginalsBackup(file, signal),
      (result) => choose(result, 'file'),
      'The file could not be fully checked within the backup limits. Keep the file; browser storage has not been changed by this import.',
    );
  }
  function restore() {
    if (!reviewed || !confirmed || restored || active.current) return;
    setConfirmed(false);
    const raw = reviewed.raw;
    void run(
      (signal) => restoreOriginalsBackup(raw, signal),
      (result) => {
        setRestored(result);
        setMessage(
          `Restore completed: ${result.restored} added and ${result.already_present} already present. No delivery lookup was made.`,
        );
      },
      'Restore could not be confirmed. A saved original may differ, storage may be unavailable, or the write may already have completed. The complete backup remains below; browse saved originals in another tab before deciding whether to retry.',
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
      link.download = 'sync-originals-backup.json';
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
      <Panel title="Saved original query backups" icon="database">
        <div className="side-detail">
          <p>
            This backup includes saved original queries across accounts and projects in this browser
            profile. Historical receipt copies, unsaved drafts and local queues are not included.
          </p>
          <p className="muted">
            Up to {SYNC_ORIGINALS_BACKUP_MAX_ENTRIES} originals and 32 MiB per backup, with
            additional content complexity limits. Backup files contain the complete original event
            data. Keep them in a location you trust.
          </p>
          {!reviewed && (
            <div className="heading-actions">
              <button type="button" className="primary-button" disabled={busy} onClick={prepare}>
                Prepare complete originals backup
              </button>
              <label>
                Open an originals backup file
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
            aria-label="Complete originals backup review"
          >
            <p>
              {origin === 'browser'
                ? 'Prepared from one browser storage snapshot.'
                : 'Loaded from a backup file.'}{' '}
              {entries.length} original queries.
            </p>
            <p className="muted" style={{ overflowWrap: 'anywhere' }}>
              Document digest · {reviewed.file.document_sha256}. This checks file consistency; it
              does not prove delivery or server authenticity.
            </p>
            {entries.length === 0 && <p>This backup is empty. There is nothing to restore.</p>}
            {entries.slice(offset, offset + 20).map((entry, index) => (
              <dl key={offset + index} className="detail-grid" style={{ overflowWrap: 'anywhere' }}>
                <div>
                  <dt>Event</dt>
                  <dd>{entry.event.event_id}</dd>
                </div>
                <div>
                  <dt>Event type</dt>
                  <dd>{entry.event.event_type}</dd>
                </div>
                {Object.entries(entry.identity).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replace(/_/g, ' ')}</dt>
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
                Complete originals backup
                <textarea rows={14} readOnly spellCheck={false} value={reviewed.raw} />
              </label>
            </details>
            <p>
              Restoring adds only missing original queries. Existing copies must match completely;
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
                Restore all {entries.length} original queries from this backup into this browser.
              </label>
            )}
            {restored && (
              <p role="status">
                {restored.restored} originals added; {restored.already_present} were already
                present. The backup remains available for download. No events were uploaded or
                acknowledged.
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
                  Restore missing originals
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
