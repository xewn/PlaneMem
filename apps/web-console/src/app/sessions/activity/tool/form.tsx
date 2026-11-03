'use client';

import { useState } from 'react';
import {
  parseSessionToolCallDetail,
  type SessionToolCallDetail,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import type { ToolFinishStatus } from '../../../../lib/server-api';
import { Badge } from '../../../../components/ui';
import { refreshTool } from './actions';
import { useFinishRecovery, FinishRecoveryPanel } from '../finish-recovery';

export function ToolResultForm({
  initial,
  initialCanWrite,
  initialKey,
  identity,
}: {
  initial: SessionToolCallDetail;
  initialCanWrite: boolean;
  initialKey: string;
  identity?: SessionCommandIdentity;
}) {
  const [detail, setDetail] = useState(initial);
  const [canWrite, setCanWrite] = useState(initialCanWrite && !!identity);
  const [readMessage, setReadMessage] = useState('');
  const { session, tool_call: tool, run } = detail;
  const started = tool.status === 'started';
  const recovery = useFinishRecovery({
    operation: 'tool.finish',
    identity,
    sessionId: session.session_id,
    resourceId: tool.tool_call_id,
    version: session.version,
    resourceVersion: tool.version,
    canWrite,
    eligible: started,
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
  const outcome = recovery.draft.outcome as ToolFinishStatus;
  const base = { version: recovery.draft.version, toolVersion: recovery.draft.resourceVersion };
  return (
    <div className="session-activity-record">
      <div className="heading-actions">
        <strong>{tool.tool_name}</strong>
        <Badge
          tone={tool.status === 'failed' ? 'red' : tool.status === 'succeeded' ? 'green' : 'cyan'}
        >
          {tool.status}
        </Badge>
      </div>
      <p>
        Tool version {tool.version} · Session version {session.version} · Session {session.status}
      </p>
      <p>
        Parent run {run.sequence} · {run.status} · Run version {run.version}
      </p>
      <p className="muted">These are the last read values. Refresh to read the current record.</p>
      <details>
        <summary>Record details and sources</summary>
        <p>Tool call · {tool.tool_call_id}</p>
        <p>Session · {session.session_id}</p>
        <p>Trace · {tool.trace_id}</p>
        {tool.source_refs.length ? (
          <ul>
            {tool.source_refs.map((source, index) => (
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
              const result = await refreshTool(session.session_id, tool.tool_call_id, identity);
              if (result.status === 'error') {
                setReadMessage(result.message + (result.trace ? ` Trace · ${result.trace}` : ''));
                return;
              }
              if (typeof result.canWrite !== 'boolean') throw new TypeError();
              setDetail(
                parseSessionToolCallDetail(result.detail, session.session_id, tool.tool_call_id),
              );
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
      {!started && (
        <p>
          This call is recorded as {tool.status}. A terminal result cannot be changed to another
          result.
        </p>
      )}
      {(current || (canWrite && started)) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const button = (event.nativeEvent as SubmitEvent).submitter;
            recovery.execute(button?.getAttribute('value') === 'receipt');
          }}
          className="handoff-form"
          aria-busy={busy}
        >
          <h3>{saved ? 'Tool call result confirmed' : 'Record tool call result'}</h3>
          {!saved && (
            <>
              <p>
                Record whether this tool call succeeded or failed. This keeps the run and session
                states and does not execute the tool or verify its output.
              </p>
              <label>
                Tool call result
                <select
                  value={outcome}
                  disabled={locked || !started}
                  onChange={(event) => recovery.setOutcome(event.target.value as ToolFinishStatus)}
                >
                  <option value="succeeded">Succeeded</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
              <small>
                Request session version {base.version} · Request tool version {base.toolVersion}
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
                    (!uncertain && (!started || changed))
                  }
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Record this tool call as {outcome}. This final result cannot be changed to another
                result.
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
                  {started && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={locked}
                      onClick={recovery.useCurrentVersions}
                    >
                      Use current session and tool versions
                    </button>
                  )}
                </div>
              )}
              {(started || uncertain) && (
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
                      : 'Record tool call result'}
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
