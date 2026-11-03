'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  parsePlaneInboxIdentity,
  parsePlaneInboxRecord,
  type PlaneInboxIdentity,
  type PlaneInboxRecord,
} from '@planemem/contracts';
import { PlaneEventStatus, planeEventExplanation } from '../../../../components/plane-event-state';
import { Badge } from '../../../../components/ui';
import { submitPlaneRetry, refreshPlaneRetryEvent } from './actions';
import {
  parseRetryRequest,
  parseRetryFeedback,
  sameRetryRequest,
  type RetryRequest,
  type RetryFeedback,
} from './model';

export function PlaneRetryManager({
  initial,
  identity,
  canRetry: initialCanRetry,
  initialKey,
}: {
  initial: PlaneInboxRecord;
  identity: PlaneInboxIdentity;
  canRetry: boolean;
  initialKey: string;
}) {
  const [detail, setDetail] = useState(initial);
  const [originalIdentity] = useState(identity);
  const [canRetry, setCanRetry] = useState(initialCanRetry);
  const [baseRevision, setBaseRevision] = useState(initial.revision);
  const [key, setKey] = useState(initialKey);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState<RetryFeedback>({ status: 'idle' });
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [readMessage, setReadMessage] = useState('');
  const [refreshedAfterAttempt, setRefreshedAfterAttempt] = useState(false);
  const [recoveryText, setRecoveryText] = useState('');
  const [intent, setIntent] = useState<'retry' | 'receipt' | 'refresh'>('retry');
  const [pending, transition] = useTransition();
  const active = useRef(false);
  const storageKey =
    'planemem-plane-retry-v1:' + JSON.stringify([originalIdentity, initial.event_id]);
  const savedRequest = feedback.status === 'idle' ? undefined : feedback.request;
  const uncertain = feedback.status === 'error' && feedback.uncertain;
  const done = feedback.status === 'done';
  const changed = detail.revision !== baseRevision;
  const eligible = detail.status !== 'applied' && detail.revision !== '9223372036854775807';

  function boundRequest(value: unknown) {
    const request = parseRetryRequest(value);
    if (
      request.input.event_id !== initial.event_id ||
      JSON.stringify(request.identity) !== JSON.stringify(parsePlaneInboxIdentity(originalIdentity))
    )
      throw new Error('The recovery request belongs to another event, project or account.');
    return request;
  }
  function persist(next: Exclude<RetryFeedback, { status: 'idle' }>) {
    const encoded = JSON.stringify({ schema_version: 1, feedback: next });
    sessionStorage.setItem(storageKey, encoded);
    if (sessionStorage.getItem(storageKey) !== encoded)
      throw new Error('Recovery storage is unavailable.');
    setStorageError('');
  }
  function restore(next: Exclude<RetryFeedback, { status: 'idle' }>) {
    setFeedback(next);
    setKey(next.request.key);
    setReason(next.request.input.reason);
    setBaseRevision(next.request.input.expected_revision);
    setConfirmed(false);
    setRefreshedAfterAttempt(false);
  }
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw !== null) {
        if (raw.length > 32000) throw new Error();
        const saved = JSON.parse(raw);
        if (saved?.schema_version !== 1) throw new Error();
        const request = boundRequest(saved.feedback?.request);
        let next: Exclude<RetryFeedback, { status: 'idle' }>;
        try {
          next = parseRetryFeedback(saved.feedback, request);
        } catch {
          next = {
            status: 'error',
            request,
            uncertain: true,
            message: 'The saved outcome is unavailable. Check the original request receipt.',
          };
        }
        restore(next);
      }
    } catch {
      setRecoveryBlocked(true);
      setStorageError(
        'The saved retry request could not be read. Scheduling is disabled to protect its recovery information.',
      );
    } finally {
      setReady(true);
    }
    // The component is keyed by the authenticated identity and event. Do not reload storage on edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function execute(lookup: boolean) {
    if (
      !ready ||
      active.current ||
      done ||
      (!lookup &&
        (!canRetry || !confirmed || done || storageError || (!uncertain && (changed || !eligible))))
    )
      return;
    let request: RetryRequest;
    try {
      if (lookup && !savedRequest) return;
      request =
        savedRequest ??
        boundRequest({
          key,
          input: { event_id: initial.event_id, expected_revision: baseRevision, reason },
          identity: originalIdentity,
        });
    } catch (error) {
      setReadMessage(error instanceof Error ? error.message : 'Provide a valid retry reason.');
      return;
    }
    const wasUncertain = uncertain;
    const before: Exclude<RetryFeedback, { status: 'idle' }> = {
      status: 'error',
      request,
      uncertain: wasUncertain || !lookup,
      message: lookup
        ? 'Checking the original receipt.'
        : 'Scheduling response is not yet confirmed. Keep the original request.',
    };
    // Save and read back the original request before any scheduling call leaves the page.
    try {
      persist(before);
    } catch {
      setStorageError(
        lookup
          ? 'Recovery storage is unavailable. This read-only receipt query will retain the request in the open page.'
          : 'This tab could not save the original request. No scheduling request was sent.',
      );
      if (!lookup) return;
    }
    active.current = true;
    setFeedback(before);
    setIntent(lookup ? 'receipt' : 'retry');
    setRefreshedAfterAttempt(false);
    transition(async () => {
      let next: Exclude<RetryFeedback, { status: 'idle' }>;
      try {
        next = parseRetryFeedback(
          await submitPlaneRetry(request, lookup ? 'receipt' : 'retry', confirmed, wasUncertain),
          request,
        );
        if (wasUncertain && next.status === 'error' && !next.uncertain) throw new Error();
      } catch {
        next = {
          ...before,
          message:
            'The response could not be confirmed. Keep the original request and check its receipt.',
        };
      }
      setFeedback(next);
      try {
        persist(next);
      } catch {
        setStorageError(
          'This result could not be saved in the tab. Keep this page open and export the original request.',
        );
      }
      active.current = false;
    });
  }

  function refresh() {
    if (active.current) return;
    active.current = true;
    setIntent('refresh');
    transition(async () => {
      try {
        const result = await refreshPlaneRetryEvent(initial.event_id, originalIdentity);
        if (result.status === 'error') {
          setReadMessage(result.message + (result.trace ? ` Trace · ${result.trace}` : ''));
          return;
        }
        const next = parsePlaneInboxRecord(result.detail, originalIdentity, initial.event_id);
        if (
          JSON.stringify(parsePlaneInboxIdentity(result.identity)) !==
            JSON.stringify(originalIdentity) ||
          typeof result.canRetry !== 'boolean'
        )
          throw new Error();
        setDetail(next);
        setCanRetry(result.canRetry);
        setRefreshedAfterAttempt(true);
        setReadMessage(
          'Current event status refreshed. The original request and its result remain here.',
        );
      } catch {
        setReadMessage(
          'Current event status could not be confirmed. The original request remains here.',
        );
      } finally {
        active.current = false;
      }
    });
  }
  function prepareNew() {
    if (
      active.current ||
      uncertain ||
      !canRetry ||
      !eligible ||
      storageError ||
      !refreshedAfterAttempt ||
      (feedback.status === 'done' &&
        BigInt(detail.revision) < BigInt(feedback.receipt.record.revision))
    )
      return;
    try {
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error();
    } catch {
      setStorageError(
        'The previous recovery record could not be cleared. No new request was prepared.',
      );
      return;
    }
    setKey(crypto.randomUUID());
    setBaseRevision(detail.revision);
    setReason('');
    setConfirmed(false);
    setFeedback({ status: 'idle' });
    setRecoveryText('');
    setRefreshedAfterAttempt(false);
  }

  return (
    <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
      <div className="drawer-badges">
        <PlaneEventStatus status={detail.status} />
        <Badge>{detail.classification}</Badge>
      </div>
      <h2>{detail.event_id}</h2>
      <p>{planeEventExplanation(detail)}</p>
      {detail.last_error_code && (
        <p>
          Stored error: <code>{detail.last_error_code}</code>
        </p>
      )}
      <div className="detail-grid">
        {[
          ['Aggregate ID', detail.aggregate_id],
          ['Record type', detail.aggregate_type === 'project' ? 'Project' : 'Work item'],
          ['Event version', detail.aggregate_version],
          ['Queue revision', detail.revision],
          ['Processing attempts', detail.attempts],
          ['Received (UTC)', detail.received_at],
          ['Receipt updated (UTC)', detail.updated_at],
          ['Next scheduled attempt (UTC)', detail.next_attempt_at ?? 'None'],
          ['Processing confirmed (UTC)', detail.applied_at ?? 'Not confirmed'],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="muted">
        Last checked {detail.checked_at}. Attempts include waits for earlier versions. Scheduled
        time does not guarantee completion.
      </p>
      <button type="button" className="secondary-button" disabled={pending} onClick={refresh}>
        {pending && intent === 'refresh' ? 'Reading current status…' : 'Refresh current status'}
      </button>
      {readMessage && <p role="status">{readMessage}</p>}
      <p>
        <Link
          className="panel-link"
          href={{ pathname: '/admin/plane-events/diagnosis', query: { event: detail.event_id } }}
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
        >
          Open version diagnosis in a new tab
        </Link>
      </p>
      {storageError && <p role="alert">{storageError}</p>}
      {!ready && <p role="status">Loading this tab’s recovery record…</p>}
      {!canRetry && (
        <p>
          Scheduling requires an authenticated human administrator. Original receipt queries remain
          available.
        </p>
      )}
      {detail.status === 'applied' && (
        <p>This event has been processed and cannot be scheduled again.</p>
      )}
      {(savedRequest || eligible) && (
        <form
          className="handoff-form"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            execute(false);
          }}
        >
          <h3>{done ? 'Original retry confirmed' : 'Schedule another processing attempt'}</h3>
          <p>
            The saved event will go through normal processing checks again. Retrying does not fill
            missing versions or repair conflicting data.
          </p>
          <label>
            Reason
            <textarea
              value={reason}
              required
              maxLength={2000}
              disabled={!ready || pending || !!savedRequest || !canRetry || !!storageError}
              onChange={(event) => {
                setReason(event.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <p>Prepared queue revision {baseRevision}</p>
          {!done && (
            <>
              <label className="confirmation-box">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={
                    !ready ||
                    pending ||
                    !canRetry ||
                    !!storageError ||
                    (!uncertain && (changed || !eligible))
                  }
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I have reviewed the cause and want to schedule this original event again.
              </label>
              <button
                className="primary-button"
                disabled={
                  !ready ||
                  pending ||
                  !canRetry ||
                  !confirmed ||
                  !!storageError ||
                  (!uncertain && (changed || !eligible))
                }
              >
                {pending && intent === 'retry'
                  ? 'Scheduling…'
                  : savedRequest
                    ? 'Submit the original request again'
                    : 'Schedule retry'}
              </button>
            </>
          )}
          {savedRequest && (
            <button
              type="button"
              className="secondary-button"
              disabled={!ready || pending || done}
              onClick={() => execute(true)}
            >
              {pending && intent === 'receipt'
                ? 'Checking original receipt…'
                : 'Check original receipt'}
            </button>
          )}
          {uncertain && (
            <p role="status">
              The result is uncertain. Keep the same request and check its receipt. A missing
              receipt or a changed event status does not prove failure.
            </p>
          )}
          {changed && <p>The current queue revision differs from this prepared request.</p>}
          {feedback.status !== 'idle' && (
            <div aria-live="polite">
              <p>{feedback.message}</p>
              {feedback.trace && <small>Trace · {feedback.trace}</small>}
              {feedback.status === 'done' && (
                <p>
                  Historical scheduled revision {feedback.receipt.record.revision} ·{' '}
                  {feedback.receipt.record.updated_at}
                </p>
              )}
            </div>
          )}
          {(savedRequest || changed) && (
            <button
              type="button"
              className="secondary-button"
              disabled={
                !ready ||
                pending ||
                uncertain ||
                !canRetry ||
                !eligible ||
                !!storageError ||
                !refreshedAfterAttempt ||
                (feedback.status === 'done' &&
                  BigInt(detail.revision) < BigInt(feedback.receipt.record.revision))
              }
              onClick={prepareNew}
            >
              Prepare a new request from the refreshed status
            </button>
          )}
        </form>
      )}
      <details>
        <summary>Recover an original request</summary>
        <p>
          This tab saves submitted requests across reloads. Export the recovery data before closing
          the tab. It contains the reason and account identifiers, but no access token.
        </p>
        <button
          type="button"
          className="secondary-button"
          disabled={!savedRequest || pending}
          onClick={() =>
            setRecoveryText(JSON.stringify({ schema_version: 1, request: savedRequest }, null, 2))
          }
        >
          Show original request for copying
        </button>
        {recoveryBlocked && (
          <button
            type="button"
            className="secondary-button"
            disabled={pending}
            onClick={() => {
              try {
                const raw = sessionStorage.getItem(storageKey);
                if (raw === null || raw.length > 32000) throw new Error();
                setRecoveryText(raw);
                setReadMessage(
                  'Saved data shown for recovery. It has not been replaced or submitted.',
                );
              } catch {
                setReadMessage(
                  'The saved data cannot currently be read. It has not been replaced.',
                );
              }
            }}
          >
            Show saved data for recovery
          </button>
        )}
        <label>
          Recovery data
          <textarea
            rows={8}
            maxLength={32000}
            value={recoveryText}
            disabled={pending}
            onChange={(event) => setRecoveryText(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={!ready || pending || done || recoveryBlocked || !recoveryText.trim()}
          onClick={() => {
            if (active.current || done || recoveryBlocked) return;
            try {
              if (recoveryText.length > 32000) throw new Error('Recovery data is too large.');
              const value = JSON.parse(recoveryText);
              if (
                value?.schema_version !== 1 ||
                Object.keys(value).some((field) => !['schema_version', 'request'].includes(field))
              )
                throw new Error('Invalid recovery data.');
              const request = boundRequest(value.request);
              if (savedRequest && !sameRetryRequest(savedRequest, request))
                throw new Error('Keep the original request until it is resolved.');
              const next = {
                status: 'error' as const,
                request,
                uncertain: true,
                message:
                  'Original request restored. Check its receipt before deciding whether to submit again.',
              };
              persist(next);
              restore(next);
              setReadMessage('Recovery data loaded. No scheduling request was sent.');
            } catch (error) {
              setReadMessage(
                error instanceof Error ? error.message : 'Recovery data could not be loaded.',
              );
            }
          }}
        >
          Load recovery data without submitting
        </button>
      </details>
      <nav className="heading-actions" aria-label="Related records in new tabs">
        <Link
          className="panel-link"
          href={{ pathname: '/admin/plane-events', query: { aggregate_id: detail.aggregate_id } }}
          target="_blank"
          rel="noreferrer"
          prefetch={false}
        >
          Events for this record ↗
        </Link>
        <Link
          className="panel-link"
          href={
            detail.aggregate_type === 'project'
              ? '/overview/observed'
              : { pathname: '/work-items/observed', query: { item: detail.aggregate_id } }
          }
          target="_blank"
          rel="noreferrer"
          prefetch={false}
        >
          Read saved observation ↗
        </Link>
      </nav>
    </div>
  );
}
