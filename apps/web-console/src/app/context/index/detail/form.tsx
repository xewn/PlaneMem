'use client';

import { useState, useTransition } from 'react';
import {
  parseLegacyContextMutationReceipt,
  parseLegacyContextStatus,
  parseLegacyContextIdentity,
  type LegacyContextStatus,
  type LegacyContextIdentity,
} from '@planemem/contracts';
import { Badge } from '../../../../components/ui';
import { changeIndex, refreshIndex } from './actions';
import {
  parseIndexRequest,
  sameIndexRequest,
  type IndexFeedback,
  type IndexRequest,
} from './model';

export function IndexManager({
  initial,
  identity,
  canWrite: initialCanWrite,
  initialKey,
}: {
  initial: LegacyContextStatus;
  identity: LegacyContextIdentity;
  canWrite: boolean;
  initialKey: string;
}) {
  const [detail, setDetail] = useState(initial);
  const [base, setBase] = useState(initial);
  const [originalIdentity] = useState(identity);
  const [canWrite, setCanWrite] = useState(initialCanWrite);
  const [keyPrefix] = useState(initialKey);
  const [serial, setSerial] = useState(0);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState<IndexFeedback>({ status: 'idle' });
  const [readMessage, setReadMessage] = useState('');
  const [pending, submit] = useTransition();
  const [refreshing, refresh] = useTransition();
  const key = `${keyPrefix}-${serial}`;
  const current = feedback.status !== 'idle' && feedback.request?.key === key;
  const uncertain = current && feedback.status === 'error' && feedback.uncertain;
  const saved = current && feedback.status === 'done';
  const busy = pending || refreshing;
  const locked = busy || uncertain || saved || !canWrite;
  const changed = detail.revision !== base.revision || detail.state !== base.state;
  const manual = detail.managed_by === 'manual';
  const operation = base.deleted_at === null ? 'delete' : 'restore';
  const canAdvance = detail.revision < Number.MAX_SAFE_INTEGER;

  function prepareCurrent() {
    setBase(detail);
    setReason('');
    setConfirmed(false);
    setSerial((value) => value + 1);
    setFeedback({ status: 'idle' });
  }

  return (
    <div className="side-detail">
      <h2 style={{ overflowWrap: 'anywhere' }}>{detail.id}</h2>
      <div className="drawer-badges">
        <Badge
          tone={
            detail.state === 'active' ? 'green' : detail.state === 'expired' ? 'yellow' : 'neutral'
          }
        >
          {detail.state}
        </Badge>
        <Badge>{detail.classification}</Badge>
        <Badge>{detail.managed_by === 'plane' ? 'Plane managed' : 'Manual index'}</Badge>
      </div>
      <dl>
        <dt>Last read revision</dt>
        <dd>{detail.revision}</dd>
        <dt>Expires</dt>
        <dd>{detail.expires_at ?? 'No expiry recorded'}</dd>
        <dt>Deleted</dt>
        <dd>{detail.deleted_at ?? 'Not deleted'}</dd>
        <dt>Updated</dt>
        <dd>{detail.updated_at}</dd>
        <dt>Checked</dt>
        <dd>{detail.checked_at}</dd>
      </dl>
      <p className="muted">
        This view contains index metadata. An active record does not confirm that its sources are
        current.
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() =>
          refresh(async () => {
            try {
              const result = await refreshIndex(initial.id, originalIdentity);
              if (result.status === 'error') {
                setReadMessage(result.message + (result.trace ? ` Trace · ${result.trace}` : ''));
                return;
              }
              const next = parseLegacyContextStatus(result.detail, initial.id);
              if (
                JSON.stringify(parseLegacyContextIdentity(result.identity)) !==
                  JSON.stringify(parseLegacyContextIdentity(originalIdentity)) ||
                next.tenant_id !== originalIdentity.tenant_id ||
                next.workspace_id !== originalIdentity.workspace_id ||
                next.project_id !== originalIdentity.project_id ||
                typeof result.canWrite !== 'boolean'
              )
                throw new Error();
              setDetail(next);
              setCanWrite(result.canWrite);
              setReadMessage(
                'Current status refreshed. Your original request and its result state are retained.',
              );
            } catch {
              setReadMessage(
                'The refresh response could not be confirmed. Your original request is retained.',
              );
            }
          })
        }
      >
        {refreshing ? 'Reading current status…' : 'Refresh current status'}
      </button>
      {readMessage && <p role="status">{readMessage}</p>}
      {!manual && (
        <p>Plane events manage this index. Manual deletion and restoration are unavailable.</p>
      )}
      {!canWrite && <p>Index write permission is currently unavailable.</p>}
      {manual && (
        <form
          className="handoff-form"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              busy ||
              !canWrite ||
              !confirmed ||
              (!uncertain && (changed || saved || !canAdvance))
            )
              return;
            let request: IndexRequest;
            try {
              request =
                uncertain && feedback.status === 'error' && feedback.request
                  ? parseIndexRequest(feedback.request)
                  : parseIndexRequest({
                      key,
                      operation,
                      input: { id: initial.id, expected_revision: base.revision, reason },
                      identity: originalIdentity,
                    });
            } catch (error) {
              if (uncertain && feedback.status === 'error') {
                setFeedback({
                  ...feedback,
                  message: 'The original request is retained because its result is still unknown.',
                });
                return;
              }
              setFeedback({
                status: 'error',
                uncertain: false,
                message: error instanceof Error ? error.message : 'Invalid index request',
              });
              return;
            }
            submit(async () => {
              try {
                const result = await changeIndex(feedback, request, confirmed);
                if (
                  !result ||
                  (result.status !== 'done' && result.status !== 'error') ||
                  !result.request ||
                  !sameIndexRequest(result.request, request) ||
                  typeof result.message !== 'string' ||
                  (result.status === 'error' &&
                    (typeof result.uncertain !== 'boolean' || (uncertain && !result.uncertain)))
                )
                  throw new Error();
                if (result.status === 'done') {
                  const receipt = parseLegacyContextMutationReceipt(
                    result.receipt,
                    request.input,
                    request.operation,
                    request.key,
                  );
                  if (
                    receipt.record.tenant_id !== request.identity.tenant_id ||
                    receipt.record.workspace_id !== request.identity.workspace_id ||
                    receipt.record.project_id !== request.identity.project_id
                  )
                    throw new Error();
                }
                setFeedback(result);
              } catch {
                setFeedback({
                  status: 'error',
                  request,
                  uncertain: true,
                  message:
                    'The change response did not reach this page. Keep the original request and retry it.',
                });
              }
            });
          }}
        >
          <h3>
            {saved
              ? 'Original request confirmed'
              : operation === 'delete'
                ? 'Delete this local index'
                : 'Restore this local index'}
          </h3>
          {!saved && (
            <>
              <p>
                {operation === 'delete'
                  ? 'Soft deletion removes this local record from index search and content reads. It retains stored content and does not delete external memory copies.'
                  : 'Restoration preserves the original classification and expiry. An expired record remains excluded from index search.'}
              </p>
              <label>
                Reason
                <textarea
                  value={reason}
                  required
                  maxLength={2000}
                  disabled={locked}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setConfirmed(false);
                    setSerial((value) => value + 1);
                    setFeedback({ status: 'idle' });
                  }}
                />
              </label>
              <p>
                Prepared revision {base.revision} · Request key{' '}
                <code style={{ overflowWrap: 'anywhere' }}>{key}</code>
              </p>
              <label className="confirmation-box">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={locked || changed || !canAdvance}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Confirm{' '}
                {operation === 'delete'
                  ? 'local soft deletion'
                  : 'restoration with the existing expiry'}
                .
              </label>
              {uncertain && (
                <p role="status">
                  The result is unknown. Keep this page open and retry the original request. A
                  changed status, denied request or missing record does not settle the earlier
                  outcome.
                </p>
              )}
              {changed && (
                <p>
                  The last read state differs from the prepared request. Review the current state
                  before preparing another request.
                </p>
              )}
              {!canAdvance && (
                <p>This revision cannot be increased safely. A new mutation cannot be prepared.</p>
              )}
              <button
                className="primary-button"
                disabled={
                  busy || !canWrite || !confirmed || (!uncertain && (changed || !canAdvance))
                }
              >
                {pending
                  ? 'Saving change…'
                  : uncertain || (current && feedback.status === 'error')
                    ? 'Retry original request'
                    : operation === 'delete'
                      ? 'Delete local index'
                      : 'Restore local index'}
              </button>
            </>
          )}
          {(current || (feedback.status === 'error' && !feedback.request)) &&
            feedback.status !== 'idle' && (
              <div aria-live="polite">
                <p>{feedback.message}</p>
                {feedback.trace && <small>Trace · {feedback.trace}</small>}
              </div>
            )}
          {(changed || saved) && (
            <button
              type="button"
              className="secondary-button"
              disabled={
                busy ||
                uncertain ||
                !canWrite ||
                !canAdvance ||
                (saved &&
                  feedback.status === 'done' &&
                  detail.revision < feedback.receipt.record.revision)
              }
              onClick={prepareCurrent}
            >
              Prepare a new request from the last read status
            </button>
          )}
          <p className="muted">
            The request is kept only in this open page. Closing or reloading the page discards it.
            Refresh current status here to keep the request.
          </p>
        </form>
      )}
    </div>
  );
}
