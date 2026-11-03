'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  parseSessionClosureState,
  type SessionClosureState,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import type { SessionEndStatus } from '../../lib/server-api';
import { refreshSessionEnd } from './end-actions';
import { useFinishRecovery, FinishRecoveryPanel } from './activity/finish-recovery';

const outcomes: Record<SessionEndStatus, string> = {
  ended: 'Ended — work for this session is finished',
  abandoned: 'Abandoned — work will not continue in this session',
  failed: 'Failed — the session could not finish',
};

export function EndSessionForm({
  initial,
  canWrite: initialCanWrite,
  identity,
  initialKey,
  refreshHref,
}: {
  initial: SessionClosureState;
  canWrite: boolean;
  identity?: SessionCommandIdentity;
  initialKey: string;
  refreshHref: string;
}) {
  const [detail, setDetail] = useState(initial);
  const [canWrite, setCanWrite] = useState(initialCanWrite && !!identity);
  const [readMessage, setReadMessage] = useState('');
  const live = ['running', 'paused'].includes(detail.status);
  const recovery = useFinishRecovery({
    operation: 'end',
    identity,
    sessionId: initial.session_id,
    resourceId: initial.session_id,
    version: detail.version,
    canWrite,
    eligible: live,
    initialKey,
  });
  const {
    state,
    current,
    saved,
    retry,
    uncertain,
    changed,
    busy,
    locked,
    confirmed,
    setConfirmed,
    pending,
    refreshing,
    intent,
    storageError,
    recoveryBlocked,
  } = recovery;
  const baseVersion = recovery.draft.version;
  const outcome = recovery.draft.outcome as SessionEndStatus;

  if (!identity) return null;
  return (
    <details>
      <summary>
        {saved
          ? 'Session closure recorded'
          : live
            ? 'Close session'
            : 'Check an earlier close request'}
      </summary>
      <p>
        Last read status: {detail.status} · Session version {detail.version}
        {detail.ended_at ? ` · Closed ${detail.ended_at}` : ''}
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() =>
          recovery.refresh(async () => {
            try {
              const result = await refreshSessionEnd(initial.session_id, identity);
              if (result.status === 'error') {
                setReadMessage(result.message + (result.trace ? ` Trace · ${result.trace}` : ''));
                return;
              }
              if (typeof result.canWrite !== 'boolean') throw new TypeError();
              const next = parseSessionClosureState(result.state, initial.session_id);
              setDetail(next);
              setCanWrite(result.canWrite);
              setReadMessage(
                'Current closure state refreshed here. The original request and the rest of the session page are unchanged.',
              );
            } catch {
              setReadMessage(
                'The current state could not be confirmed. The original close request is retained.',
              );
            }
          })
        }
      >
        {refreshing ? 'Reading current state…' : 'Refresh current session state'}
      </button>
      {readMessage && <p role="status">{readMessage}</p>}
      <FinishRecoveryPanel recovery={recovery} />
      {!canWrite && (
        <p>Session write permission is currently unavailable. Recovery information is retained.</p>
      )}
      {!live && (
        <p>The current record is {detail.status}. An earlier close request can still be checked.</p>
      )}
      {(current || (canWrite && live)) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const button = (event.nativeEvent as SubmitEvent).submitter;
            recovery.execute(button?.getAttribute('value') === 'receipt');
          }}
          className="handoff-form"
          aria-busy={busy}
        >
          {!saved && (
            <>
              <p>
                Choose how this session finished. Save a checkpoint first for work you want to carry
                forward. Closing this record does not stop connected clients.
              </p>
              <label>
                Closing status
                <select
                  value={outcome}
                  disabled={locked || !live}
                  onChange={(event) => recovery.setOutcome(event.target.value as SessionEndStatus)}
                >
                  {Object.entries(outcomes).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <small>Original request session version {baseVersion}</small>
              <label className="confirmation-box">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={
                    busy ||
                    !canWrite ||
                    recoveryBlocked ||
                    !!storageError ||
                    (!uncertain && (!live || changed))
                  }
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Record this session as {outcome}.
              </label>
              {uncertain && (
                <p role="status">
                  The close result is unknown. Check the original receipt or confirm before retrying
                  the same request. Current session state does not confirm this request.
                </p>
              )}
              {changed && (
                <div>
                  <p>
                    The session changed from version {baseVersion} to {detail.version}. Review its
                    current progress before preparing another request.
                  </p>
                  {live && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={locked}
                      onClick={recovery.useCurrentVersions}
                    >
                      Use current version {detail.version}
                    </button>
                  )}
                </div>
              )}
              {(live || uncertain) && (
                <button
                  className="primary-button"
                  name="intent"
                  value="finish"
                  disabled={
                    busy ||
                    !canWrite ||
                    recoveryBlocked ||
                    !!storageError ||
                    !confirmed ||
                    (!uncertain && changed)
                  }
                >
                  {pending && intent === 'finish'
                    ? 'Closing…'
                    : retry
                      ? 'Retry original close request'
                      : 'Close session'}
                </button>
              )}
              {retry && (
                <button
                  className="secondary-button"
                  name="intent"
                  value="receipt"
                  formNoValidate
                  disabled={busy || !canWrite || recoveryBlocked}
                >
                  {pending && intent === 'receipt'
                    ? 'Checking receipt…'
                    : 'Check original close result'}
                </button>
              )}
            </>
          )}
          {state.status !== 'idle' && (
            <div aria-live="polite">
              <p>{state.message}</p>
              {state.trace && <small>Trace · {state.trace}</small>}
            </div>
          )}
        </form>
      )}
      <Link className="panel-link" href={refreshHref} target="_blank" rel="noreferrer">
        Review session state in another tab
      </Link>
    </details>
  );
}
