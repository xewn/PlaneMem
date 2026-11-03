'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from '@planemem/contracts';
import {
  ACTIVITY_CREATE_RECOVERY_LIMIT,
  activityCreateRecoveryStorageKey,
  parseActivityCreateRequest,
  parseActivityCreateFeedback,
  parseActivityCreateState,
  sameActivityCreate,
  encodeActivityCreateRecovery,
  decodeActivityCreateRecovery,
  type ActivityCreateOperation,
  type ActivityCreateRequest,
  type ActivityCreateFeedback,
  type ActivityCreateState,
  type ToolInitialStatus,
} from '../../../../lib/activity-create';
import { submitActivityCreate, refreshActivityCreate } from './actions';

export function ActivityCreateForm({
  operation,
  sessionId,
  runId,
  initial,
  identity,
  initialCanWrite,
  initialKey,
}: {
  operation: ActivityCreateOperation;
  sessionId: string;
  runId?: string;
  initial: ActivityCreateState;
  identity?: SessionCommandIdentity;
  initialCanWrite: boolean;
  initialKey: string;
}) {
  const [current, setCurrent] = useState(initial);
  const [canWrite, setCanWrite] = useState(initialCanWrite && !!identity);
  const [version, setVersion] = useState(initial.session.version);
  const [requestKey, setRequestKey] = useState(initialKey);
  const [model, setModel] = useState('');
  const [toolName, setToolName] = useState('');
  const [toolStatus, setToolStatus] = useState<ToolInitialStatus>('started');
  const [state, setState] = useState<ActivityCreateFeedback>({ status: 'idle' });
  const [confirmed, setConfirmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [recoveryText, setRecoveryText] = useState('');
  const [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [intent, setIntent] = useState<'create' | 'receipt' | 'refresh'>('create');
  const [pending, transition] = useTransition();
  const active = useRef(false);
  // This slot is independent of list filters, paging, versions and draft fields.
  const storageKey = activityCreateRecoveryStorageKey(identity, sessionId, operation, runId);
  const busy = !ready || pending;
  const saved = state.status === 'done';
  const uncertain = state.status === 'error' && state.uncertain;
  const eligible =
    current.session.status === 'running' &&
    (operation === 'run.start' || current.run?.status === 'running');
  const original = state.status === 'idle' ? undefined : state.request;
  const originalVersion = original?.version ?? version;
  const changed = originalVersion !== current.session.version;
  const mayWrite =
    !!identity && canWrite && !saved && !storageError && (uncertain || (eligible && !changed));
  const mayPrepare = !!identity && canWrite && eligible && reviewed && !uncertain && !storageError;

  function bound(value: unknown): ActivityCreateRequest {
    const request = parseActivityCreateRequest(value);
    if (
      !identity ||
      JSON.stringify(request.identity) !== JSON.stringify(parseSessionCommandIdentity(identity)) ||
      request.sessionId !== sessionId ||
      request.operation !== operation ||
      (request.operation === 'tool.call' && request.runId !== runId)
    )
      throw new TypeError(
        'This request belongs to another account, project, session, operation or run.',
      );
    return request;
  }
  function readStored() {
    const raw = sessionStorage.getItem(storageKey);
    return raw === null ? undefined : bound(decodeActivityCreateRecovery(raw));
  }
  function persist(request: ActivityCreateRequest) {
    const prior = readStored();
    if (prior && !sameActivityCreate(prior, request))
      throw new TypeError('A different original activity request is already saved.');
    const raw = encodeActivityCreateRecovery(request);
    sessionStorage.setItem(storageKey, raw);
    if (sessionStorage.getItem(storageKey) !== raw)
      throw new Error('Recovery storage is unavailable.');
    setStorageError('');
  }
  function restore(request: ActivityCreateRequest) {
    setConfirmed(false);
    setReviewed(false);
    setState({
      status: 'error',
      request,
      uncertain: true,
      message:
        'Original activity request recovered. Check its receipt; this page has not confirmed the outcome.',
    });
  }
  useEffect(() => {
    if (!identity) {
      setReady(true);
      return;
    }
    try {
      const request = readStored();
      if (request) restore(request);
    } catch {
      setStorageError(
        'Recovery information could not be read. Writes are disabled to protect the original request.',
      );
    } finally {
      setReady(true);
    }
    // The parent keys this component by the original identity and target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function execute(lookup: boolean) {
    if (
      !ready ||
      active.current ||
      !identity ||
      saved ||
      (lookup ? !original : !mayWrite || !confirmed)
    )
      return;
    let request: ActivityCreateRequest;
    try {
      request = original
        ? bound(original)
        : bound({
            identity,
            sessionId,
            key: requestKey,
            version,
            operation,
            ...(operation === 'run.start'
              ? model === ''
                ? {}
                : { model }
              : { runId, toolName, status: toolStatus }),
          });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invalid original activity request.');
      return;
    }
    const wasUncertain = uncertain;
    const before = {
      status: 'error' as const,
      request,
      uncertain: true,
      message: lookup
        ? 'Checking the original activity receipt.'
        : 'The activity result has not been confirmed. Keep the original request.',
    };
    try {
      persist(request);
    } catch {
      setStorageError(
        lookup
          ? 'Recovery storage is unavailable. This query retains the original request in the open page.'
          : 'The original request could not be saved. No write was sent.',
      );
      if (!lookup) {
        setState({
          ...before,
          uncertain: wasUncertain,
          message: 'No write was sent. Restore recovery storage before submitting.',
        });
        setConfirmed(false);
        setReviewed(false);
        return;
      }
    }
    active.current = true;
    setState(before);
    setConfirmed(false);
    setReviewed(false);
    setIntent(lookup ? 'receipt' : 'create');
    transition(async () => {
      try {
        const next = parseActivityCreateFeedback(
          await submitActivityCreate(
            request,
            lookup ? 'receipt' : 'create',
            confirmed,
            wasUncertain,
          ),
          request,
        );
        if (wasUncertain && next.status === 'error' && !next.uncertain) throw new TypeError();
        setState(next);
      } catch {
        setState({
          ...before,
          message:
            'The response did not confirm this activity request. Check its original receipt before continuing.',
        });
      } finally {
        active.current = false;
      }
    });
  }
  function refresh() {
    if (!ready || active.current || !identity) return;
    active.current = true;
    setIntent('refresh');
    setReviewed(false);
    setConfirmed(false);
    transition(async () => {
      try {
        const result = await refreshActivityCreate(sessionId, runId, identity);
        if (result.status === 'error') {
          setMessage(result.message);
          return;
        }
        if (typeof result.canWrite !== 'boolean') throw new TypeError();
        const next = parseActivityCreateState(result.current, sessionId, runId);
        if (state.status === 'done' && next.session.version < state.receipt.session_version)
          throw new TypeError();
        setCurrent(next);
        setCanWrite(result.canWrite);
        setReviewed(true);
        setMessage(
          'Current state read. Review the values below. Your original request and receipt state are unchanged.',
        );
      } catch {
        setMessage('The current state could not be read. Your original request is retained.');
      } finally {
        active.current = false;
      }
    });
  }
  function retryStorage() {
    if (!ready || active.current || !identity) return;
    try {
      if (original) persist(bound(original));
      else {
        const prior = readStored();
        if (prior) restore(prior);
      }
      setStorageError('');
      setMessage('Recovery storage can be read. No activity request was sent.');
    } catch {
      setStorageError(
        'Recovery storage remains unavailable. Existing recovery information has not been replaced.',
      );
    }
  }
  function exportRequest() {
    if (!ready || active.current) return;
    try {
      const raw = original
        ? encodeActivityCreateRecovery(original)
        : sessionStorage.getItem(storageKey);
      if (!raw || raw.length > ACTIVITY_CREATE_RECOVERY_LIMIT) throw new Error();
      setRecoveryText(raw);
      setMessage(
        'Copy this text before closing the tab. It contains original identity, identifiers, names and parameters.',
      );
    } catch {
      setMessage('No bounded original request is available to export.');
    }
  }
  function importRequest() {
    if (!ready || active.current || !identity) return;
    try {
      const request = bound(decodeActivityCreateRecovery(recoveryText));
      if (!original && (model !== '' || toolName !== '' || toolStatus !== 'started'))
        throw new TypeError('Clear the unsent draft fields before restoring an original request.');
      if (original && !sameActivityCreate(original, request))
        throw new TypeError('A different original request is already open.');
      persist(request);
      restore(request);
      setMessage('Original request restored. No activity command or receipt query was sent.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Recovery text could not be restored.');
    }
  }
  function prepareDraft() {
    if (!ready || active.current || !mayPrepare) return;
    try {
      const prior = readStored();
      if (prior && (!original || !sameActivityCreate(prior, original))) {
        // Another page lifecycle may have saved a request. Never retire it from a blank draft.
        if (!original) {
          restore(prior);
          return;
        }
        throw new TypeError();
      }
      const nextKey = crypto.randomUUID();
      const raw = original ? encodeActivityCreateRecovery(bound(original)) : undefined;
      // Preserve the retiring request in the export area before touching durable recovery.
      if (raw) setRecoveryText(raw);
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error();
      setVersion(current.session.version);
      setRequestKey(nextKey);
      setState({ status: 'idle' });
      setConfirmed(false);
      setReviewed(false);
      setStorageError('');
      if (original?.operation === 'run.start') setModel(original.model ?? '');
      if (original?.operation === 'tool.call') {
        setToolName(original.toolName);
        setToolStatus(original.status);
      }
      setMessage(
        'A new draft uses the reviewed session version. Any previous original request is in the recovery text; copy it to retain it. No command was sent.',
      );
    } catch {
      setStorageError(
        'A new draft could not be prepared safely. The original request remains in this page.',
      );
    }
  }

  return (
    <div className="side-detail">
      <p>
        Session {sessionId} · Version {current.session.version} · {current.session.status}
      </p>
      {current.run && (
        <p>
          Run {current.run.sequence} · {current.run.run_id} · {current.run.status}
        </p>
      )}
      <p className="muted">
        These are the last read values. Recording activity does not launch a model or execute a
        tool.
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy || !identity}
        onClick={refresh}
      >
        {pending && intent === 'refresh' ? 'Reading current state…' : 'Read current state'}
      </button>
      {!identity && (
        <p>Sign in with a verified client to create activity or recover an original request.</p>
      )}
      {!canWrite && (
        <p>
          Session write access is unavailable. Recovery information is retained; the server checks
          receipt access.
        </p>
      )}
      {!eligible && (
        <p>
          New activity requires a running session
          {operation === 'tool.call' ? ' and a running parent run' : ''}. Original requests remain
          available for recovery.
        </p>
      )}
      {storageError && (
        <div role="alert">
          <p>{storageError}</p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !identity}
            onClick={retryStorage}
          >
            Retry recovery storage
          </button>
        </div>
      )}
      {identity && (
        <details>
          <summary>Recover an original activity request</summary>
          <p>
            Original requests remain in this tab across reloads. Export before closing the tab.
            Recovery text includes names and identifiers without credentials or tool inputs and
            outputs.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={exportRequest}
          >
            Export original request
          </button>
          <label>
            Recovery text
            <textarea
              rows={6}
              maxLength={ACTIVITY_CREATE_RECOVERY_LIMIT}
              value={recoveryText}
              disabled={busy}
              onChange={(event) => setRecoveryText(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !recoveryText}
            onClick={importRequest}
          >
            Restore original request
          </button>
        </details>
      )}
      {message && <p role="status">{message}</p>}
      <form
        className="handoff-form"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          execute(
            (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'receipt',
          );
        }}
      >
        {original ? (
          <div className="detail-grid">
            <div>
              <small>Original account / client</small>
              <strong>
                {original.identity.actor_id} / {original.identity.client_id}
              </strong>
            </div>
            <div>
              <small>Original request key</small>
              <strong>{original.key}</strong>
            </div>
            {original.operation === 'run.start' ? (
              <div>
                <small>Original model</small>
                <strong>{original.model ?? 'Not specified'}</strong>
              </div>
            ) : (
              <>
                <div>
                  <small>Original tool</small>
                  <strong>{original.toolName}</strong>
                </div>
                <div>
                  <small>Original status</small>
                  <strong>{original.status}</strong>
                </div>
              </>
            )}
          </div>
        ) : operation === 'run.start' ? (
          <label>
            Model name (optional)
            <input
              maxLength={1024}
              value={model}
              disabled={busy || !canWrite || !!storageError}
              onChange={(event) => {
                setModel(event.target.value);
                setConfirmed(false);
              }}
            />
          </label>
        ) : (
          <>
            <label>
              Tool name
              <input
                required
                maxLength={1024}
                value={toolName}
                disabled={busy || !canWrite || !!storageError}
                onChange={(event) => {
                  setToolName(event.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label>
              Recorded status
              <select
                value={toolStatus}
                disabled={busy || !canWrite || !!storageError}
                onChange={(event) => {
                  setToolStatus(event.target.value as ToolInitialStatus);
                  setConfirmed(false);
                }}
              >
                <option value="started">Started</option>
                <option value="succeeded">Succeeded</option>
                <option value="failed">Failed</option>
              </select>
            </label>
          </>
        )}
        <small>Request session version {originalVersion}</small>
        {changed && (
          <p>
            The last read session version differs from this request. Read and review the current
            state before preparing a new draft. An unknown request must be resolved first.
          </p>
        )}
        {uncertain && (
          <p role="status">
            The original result is unknown. Keep its parameters and key. Only a matching receipt can
            confirm it; a current record or a missing receipt cannot resolve it.
          </p>
        )}
        {!saved && (
          <>
            <label className="confirmation-box">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || !mayWrite}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {operation === 'run.start'
                ? 'I confirm recording this run using the original parameters.'
                : 'I confirm recording this tool call and its selected status.'}
            </label>
            <button
              className="primary-button"
              value="create"
              disabled={busy || !mayWrite || !confirmed}
            >
              {pending && intent === 'create'
                ? 'Recording…'
                : original
                  ? 'Retry original request'
                  : operation === 'run.start'
                    ? 'Start run'
                    : 'Record tool call'}
            </button>
            <button
              className="secondary-button"
              value="receipt"
              formNoValidate
              disabled={busy || !identity || !original}
            >
              {pending && intent === 'receipt' ? 'Checking receipt…' : 'Check original receipt'}
            </button>
          </>
        )}
        {state.status !== 'idle' && (
          <div aria-live="polite">
            <p>{state.message}</p>
            {state.trace && <small>Trace · {state.trace}</small>}
            {state.status === 'done' && (
              <p>
                <Link
                  className="panel-link"
                  target="_blank"
                  rel="noreferrer"
                  href={
                    state.receipt.operation === 'run.start'
                      ? {
                          pathname: '/sessions/activity/run',
                          query: { session: sessionId, run: state.receipt.run_id },
                        }
                      : {
                          pathname: '/sessions/activity/tool',
                          query: { session: sessionId, tool: state.receipt.tool_call_id },
                        }
                  }
                >
                  Open created record in a new tab ↗
                </Link>
              </p>
            )}
          </div>
        )}
        {!uncertain && (saved || original || changed) && (
          <>
            <p>
              Read the current state, review it, then explicitly prepare a draft with that session
              version.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !mayPrepare}
              onClick={prepareDraft}
            >
              Prepare a new draft using the reviewed state
            </button>
          </>
        )}
      </form>
    </div>
  );
}
