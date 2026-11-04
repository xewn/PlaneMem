'use client';

import { useEffect, useRef, useState } from 'react';
import type { PackSaveBinding } from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import { PACK_RECEIPT_VOLUMES_MAX_ENTRIES } from './save-receipt-volumes-model';
import { auditPackReceiptHistory, type PackReceiptHistoryAudit } from './save-receipt-store';

export function PackReceiptAuditPanel({
  binding,
  disabled,
  storageGeneration,
  getStorageGeneration,
  begin,
  end,
}: {
  binding: PackSaveBinding;
  disabled: boolean;
  storageGeneration: number;
  getStorageGeneration: () => number;
  begin: () => boolean;
  end: () => void;
}) {
  const [report, setReport] = useState<{ audit: PackReceiptHistoryAudit; generation: number }>();
  const [latestSucceeded, setLatestSucceeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Check this identity’s complete saved history when you need an overview.',
  );
  const mounted = useRef(false);
  const active = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  const fresh = latestSucceeded && report?.generation === storageGeneration;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      release.current?.();
      release.current = undefined;
    };
  }, []);

  async function run() {
    if (!mounted.current || active.current || disabled || !begin()) return;
    const generation = getStorageGeneration();
    active.current = true;
    release.current = end;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setLatestSucceeded(false);
    setMessage('Checking the complete saved history. Any earlier report remains below.');
    try {
      const audit = await backupOperation(controller.signal, (signal, check) =>
        auditPackReceiptHistory(binding, signal, check),
      );
      if (!mounted.current || operation.current !== controller) return;
      if (generation !== getStorageGeneration()) {
        setMessage(
          'History may have changed during the check. Check again to get a new report; any earlier report is retained.',
        );
        return;
      }
      setReport({ audit, generation });
      setLatestSucceeded(true);
      setMessage(
        audit.conflicting_request_keys.length
          ? 'The complete snapshot passed its local integrity checks. Some request keys have different original requests; review those keys before choosing an original request.'
          : 'The complete snapshot passed its local integrity checks. Historical results do not establish current server state.',
      );
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'A complete check could not be confirmed. History may exceed the limit, contain inconsistent copies, or be unavailable. No partial report was accepted; any earlier report is retained.',
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

  const audit = report?.audit;
  return (
    <section aria-label="Saved history integrity overview" className="handoff-form">
      <h2>Check saved history</h2>
      <p>
        Check all observations for the gateway, project, account, client and permission scope shown
        above, regardless of directory filters. The check supports up to{' '}
        {PACK_RECEIPT_VOLUMES_MAX_ENTRIES} observations and makes no changes.
      </p>
      <div>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || disabled}
          onClick={() => void run()}
        >
          Check complete saved history
        </button>
        {busy && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => operation.current?.abort()}
          >
            Stop waiting
          </button>
        )}
      </div>
      <p role="status">
        {report && latestSucceeded && !fresh && !busy
          ? 'History may have changed since this report. Check again before relying on these counts; the earlier snapshot is retained below.'
          : message}
      </p>
      {audit && (
        <div>
          <h3>{fresh ? 'Last completed snapshot' : 'Earlier snapshot'}</h3>
          {!fresh && <p>This earlier report does not confirm the current browser history.</p>}
          <p>
            Checked locally · <time dateTime={audit.checked_at}>{audit.checked_at}</time>
          </p>
          <dl>
            <dt>Saved observations</dt>
            <dd>{audit.observations}</dd>
            <dt>Original request keys</dt>
            <dd>{audit.request_keys}</dd>
            <dt>Historical “save recorded” observations</dt>
            <dd>{audit.recorded_observations}</dd>
            <dt>Historical “no record observed” observations</dt>
            <dd>{audit.not_observed_observations}</dd>
            <dt>Earliest observation</dt>
            <dd>{audit.earliest_observed_at ?? 'None'}</dd>
            <dt>Latest observation</dt>
            <dd>{audit.latest_observed_at ?? 'None'}</dd>
            <dt>Receipt content size (UTF-8 bytes)</dt>
            <dd>{audit.canonical_receipt_bytes}</dd>
            <dt>Request keys with different original requests</dt>
            <dd>{audit.conflicting_request_keys.length}</dd>
          </dl>
          <p>
            Content size excludes browser storage overhead and does not measure available space.
            Each count describes this snapshot; missing local history does not prove that a save
            failed.
          </p>
          {audit.conflicting_request_keys.length > 0 && (
            <details>
              <summary>Review request keys with different originals</summary>
              <p>
                These observations are individually consistent, but the same key appears with
                different complete original requests. Use the request key filter above to review
                their contents. This check does not choose an original or authorize sending it.
              </p>
              <table>
                <caption>All request keys with different originals in this snapshot</caption>
                <thead>
                  <tr>
                    <th scope="col">Request key</th>
                    <th scope="col">Different originals</th>
                    <th scope="col">Observations</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.conflicting_request_keys.map((entry) => (
                    <tr key={entry.request_key}>
                      <th scope="row" style={{ overflowWrap: 'anywhere' }}>
                        {entry.request_key}
                      </th>
                      <td>{entry.original_variants}</td>
                      <td>{entry.observations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <details>
            <summary>Snapshot reference</summary>
            <p>
              <code style={{ overflowWrap: 'anywhere' }}>{audit.snapshot_sha256}</code>
            </p>
            <p>
              The reference identifies the checked identity and observation set. It is not a backup
              or proof of server authenticity.
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
