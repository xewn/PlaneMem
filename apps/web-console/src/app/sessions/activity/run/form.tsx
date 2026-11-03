'use client';

import { useState } from 'react';
import {
  parseSessionRunDetail,
  type SessionRunDetail,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import type { RunFinishStatus } from '../../../../lib/server-api';
import { Badge } from '../../../../components/ui';
import { refreshRun } from './actions';
import { useFinishRecovery, FinishRecoveryPanel } from '../finish-recovery';

export function RunResultForm({
  initial,
  initialCanWrite,
  initialKey,
  identity,
}: {
  initial: SessionRunDetail;
  initialCanWrite: boolean;
  initialKey: string;
  identity?: SessionCommandIdentity;
}) {
  const [detail, setDetail] = useState(initial);
  const [canWrite, setCanWrite] = useState(initialCanWrite && !!identity);
  const [readMessage, setReadMessage] = useState('');
  const { session, run } = detail;
  const running = run.status === 'running';
  const recovery = useFinishRecovery({
    operation: 'run.finish',
    identity,
    sessionId: session.session_id,
    resourceId: run.run_id,
    version: session.version,
    resourceVersion: run.version,
    canWrite,
    eligible: running,
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
    refresh,
    intent,
    storageError,
    recoveryBlocked,
  } = recovery;
  const outcome = recovery.draft.outcome as RunFinishStatus;
  const base = { version: recovery.draft.version, runVersion: recovery.draft.resourceVersion };
  return (
    <div className="session-activity-record">
      <div className="heading-actions">
        <strong>
          Run {run.sequence} · {run.model || 'Model not recorded'}
        </strong>
        <Badge
          tone={run.status === 'failed' ? 'red' : run.status === 'completed' ? 'green' : 'cyan'}
        >
          {run.status}
        </Badge>
      </div>
      <p>
        Run version {run.version} · Session version {session.version} · Session {session.status}
      </p>
      <p className="muted">These are the last read values. Refresh to read the current record.</p>
      <details>
        <summary>Record details and sources</summary>
        <p>Run · {run.run_id}</p>
        <p>Session · {session.session_id}</p>
        <p>Trace · {run.trace_id}</p>
        {run.source_refs.length ? (
          <ul>
            {run.source_refs.map((source, index) => (
              <li key={index}>
                {source.type} · {source.id}
                {source.revision === undefined ? '' : ` · revision ${source.revision}`}
              </li>
            ))}
          </ul>
        ) : (
          <p>No source references recorded.</p>
        )}
      </details>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() =>
          refresh(async () => {
            try {
              const result = await refreshRun(session.session_id, run.run_id, identity);
              if (result.status === 'error') {
                setReadMessage(result.message + (result.trace ? ` Trace · ${result.trace}` : ''));
                return;
              }
              if (typeof result.canWrite !== 'boolean') throw new TypeError();
              setDetail(parseSessionRunDetail(result.detail, session.session_id, run.run_id));
              setCanWrite(result.canWrite && !!identity);
              setReadMessage(
                'Current record refreshed. Your prepared request and its receipt state are unchanged.',
              );
            } catch {
              setReadMessage(
                'The refresh response did not reach this page. Your original request is retained.',
              );
            }
          })
        }
      >
        {refreshing ? 'Reading current record…' : 'Refresh current record'}
      </button>
      {readMessage && <p role="status">{readMessage}</p>}
      <FinishRecoveryPanel recovery={recovery} />
      {!canWrite && <p>Session write permission is currently unavailable.</p>}
      {!running && (
        <p>
          This run is recorded as {run.status}. A terminal result cannot be changed to another
          result.
        </p>
      )}
      {(current || (canWrite && running)) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const button = (event.nativeEvent as SubmitEvent).submitter;
            recovery.execute(button?.getAttribute('value') === 'receipt');
          }}
          className="handoff-form"
          aria-busy={busy}
        >
          <h3>{saved ? 'Run result confirmed' : 'Record run result'}</h3>
          {!saved && (
            <>
              <p>
                Record whether this run completed or failed. This keeps the session’s current status
                and does not change tool records or stop connected clients.
              </p>
              <label>
                Run result
                <select
                  value={outcome}
                  disabled={locked || !running}
                  onChange={(event) => recovery.setOutcome(event.target.value as RunFinishStatus)}
                >
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
              <small>
                Request session version {base.version} · Request run version {base.runVersion}
              </small>
              <label className="confirmation-box">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={
                    busy ||
                    !canWrite ||
                    !identity ||
                    recoveryBlocked ||
                    !!storageError ||
                    (!uncertain && (!running || changed))
                  }
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Record this run as {outcome}. New tool records will no longer be accepted for it.
              </label>
              {uncertain && (
                <p role="status">
                  The result is unknown. Keep this page open and check the original receipt or retry
                  the same request. Refreshing the current record does not resolve this request.
                </p>
              )}
              {changed && (
                <div>
                  <p>
                    The current versions differ from this request. Review the record before using
                    its current versions for a new request.
                  </p>
                  {running && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={locked}
                      onClick={recovery.useCurrentVersions}
                    >
                      Use current session and run versions
                    </button>
                  )}
                </div>
              )}
              {(running || uncertain) && (
                <button
                  className="primary-button"
                  name="intent"
                  value="finish"
                  disabled={
                    busy ||
                    !canWrite ||
                    !identity ||
                    recoveryBlocked ||
                    !!storageError ||
                    !confirmed ||
                    (!uncertain && changed)
                  }
                >
                  {pending && intent === 'finish'
                    ? 'Recording result…'
                    : retry
                      ? 'Retry original result request'
                      : 'Record run result'}
                </button>
              )}
              {retry && (
                <button
                  className="secondary-button"
                  name="intent"
                  value="receipt"
                  formNoValidate
                  disabled={busy || !canWrite || !identity || recoveryBlocked}
                >
                  {pending && intent === 'receipt' ? 'Checking receipt…' : 'Check original result'}
                </button>
              )}
              <p className="muted">
                The original submitted request is retained in this tab across reloads. Export it
                before closing the tab. Restoring requires a fresh receipt check or confirmation
                before retrying.
              </p>
            </>
          )}
          {state.status !== 'idle' && (
            <div aria-live="polite">
              {state.message && <p>{state.message}</p>}
              {state.trace && <small>Trace · {state.trace}</small>}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
