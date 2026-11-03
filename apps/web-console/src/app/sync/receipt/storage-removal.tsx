'use client';

import { useEffect, useRef, useState } from 'react';
import { Panel } from '../../../components/ui';
import type { BrowserRemovalResult } from './browser-store';
import type { SavedSyncOriginal } from './original-store';
import type { SavedSyncReceipt } from './receipt-store';

export type SyncStorageRemoval =
  | { kind: 'original'; selection: SavedSyncOriginal; raw: string }
  | { kind: 'receipt'; selection: SavedSyncReceipt; raw: string };

export function StorageRemovalReview({
  removal,
  result,
  busy,
  onRemove,
  onClose,
  onDownload,
}: {
  removal: SyncStorageRemoval;
  result: BrowserRemovalResult | undefined;
  busy: boolean;
  onRemove: () => void;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const review = useRef<HTMLDivElement>(null);
  const metadata = removal.selection.metadata;
  useEffect(() => {
    review.current?.focus();
  }, []);
  return (
    <Panel title="Review a saved browser copy for removal" icon="database">
      <div
        className="side-detail"
        ref={review}
        tabIndex={-1}
        role="group"
        aria-label={`Review ${removal.kind === 'original' ? 'original query' : 'historical receipt'} for event ${metadata.event_id}`}
      >
        <p>
          Remove only this saved{' '}
          {removal.kind === 'original' ? 'original query' : 'historical receipt'} from this browser.
          Other saved copies remain. This does not undo delivery or change your local queue.
        </p>
        <dl className="detail-grid" style={{ overflowWrap: 'anywhere' }}>
          <div>
            <dt>Event</dt>
            <dd>{metadata.event_id}</dd>
          </div>
          <div>
            <dt>Event type</dt>
            <dd>{metadata.event_type}</dd>
          </div>
          {Object.entries(metadata.identity).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/_/g, ' ')}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          {removal.kind === 'receipt' && (
            <>
              <div>
                <dt>Original query trace</dt>
                <dd>{removal.selection.metadata.query_trace}</dd>
              </div>
              <div>
                <dt>Historical outcome</dt>
                <dd>{removal.selection.metadata.outcome}</dd>
              </div>
              <div>
                <dt>Document digest</dt>
                <dd>{removal.selection.digest}</dd>
              </div>
            </>
          )}
        </dl>
        <details>
          <summary>Review or copy the complete saved JSON</summary>
          <label>
            Complete reviewed browser copy
            <textarea rows={12} readOnly spellCheck={false} value={removal.raw} />
          </label>
        </details>
        <p className="muted">
          You can download or copy the reviewed data before closing this panel.
        </p>
        {result === undefined ? (
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I want to remove this saved browser copy.
          </label>
        ) : (
          <p role="status">
            {result === 'removed'
              ? 'The selected browser copy was removed. The reviewed data remains here until you close this panel.'
              : 'The selected browser copy is no longer stored. The reviewed data remains here until you close this panel.'}
          </p>
        )}
        <div className="heading-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onDownload}>
            Download reviewed copy
          </button>
          {result === undefined && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !confirmed}
              onClick={() => {
                setConfirmed(false);
                onRemove();
              }}
            >
              Remove this browser copy
            </button>
          )}
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Close review
          </button>
        </div>
      </div>
    </Panel>
  );
}
