'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from '@planemem/contracts';
import { submitStart } from './actions';
import {
  START_RECOVERY_LIMIT,
  startRecoveryStorageKey,
  parseStartRequest,
  parseStartFeedback,
  sameStart,
  encodeStartRecovery,
  decodeStartRecovery,
  type StartRequest,
  type StartFeedback,
} from './start-model';

export function StartSessionForm({
  initialKey,
  identity,
  canWrite,
}: {
  initialKey: string;
  identity?: SessionCommandIdentity;
  canWrite: boolean;
}) {
  const [state, setState] = useState<StartFeedback>({ status: 'idle' });
  const [requestKey, setRequestKey] = useState(initialKey);
  const [confirmed, setConfirmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [recoveryText, setRecoveryText] = useState('');
  const [message, setMessage] = useState('');
  const [intent, setIntent] = useState<'start' | 'receipt'>('start');
  const [pending, transition] = useTransition();
  const active = useRef(false);
  // The parent keys this form by identity/project, independently of the selected session.
  const storageKey = startRecoveryStorageKey(identity);
  const saved = state.status === 'done';
  const uncertain = state.status === 'error' && state.uncertain;
  const busy = !ready || pending;
  const mayWrite = !!identity && canWrite && !saved && !storageError;

  function bound(value: unknown): StartRequest {
    const request = parseStartRequest(value);
    if (
      !identity ||
      JSON.stringify(request.identity) !== JSON.stringify(parseSessionCommandIdentity(identity))
    )
      throw new TypeError('This start request belongs to another account, client or project.');
    return request;
  }
  function readStored() {
    const raw = sessionStorage.getItem(storageKey);
    return raw === null ? undefined : bound(decodeStartRecovery(raw));
  }
  function persist(request: StartRequest) {
    const prior = readStored();
    if (prior && !sameStart(prior, request))
      throw new TypeError('Another original start request is already saved.');
    const raw = encodeStartRecovery(request);
    sessionStorage.setItem(storageKey, raw);
    if (sessionStorage.getItem(storageKey) !== raw)
      throw new Error('Recovery storage is unavailable');
    setStorageError('');
  }
  function restore(request: StartRequest) {
    setConfirmed(false);
    setState({
      status: 'error',
      request,
      uncertain: true,
      message:
        'Original start request recovered. Check its receipt; its outcome has not been confirmed in this page.',
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
        'The original start request could not be read. Writes are disabled to protect recovery information.',
      );
    } finally {
      setReady(true);
    }
    // The verified identity is stable for this component; selection never changes the slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function execute(lookup: boolean) {
    if (
      !ready ||
      active.current ||
      !identity ||
      saved ||
      (lookup ? state.status === 'idle' : !mayWrite || !confirmed)
    )
      return;
    let request: StartRequest;
    try {
      request =
        state.status === 'idle'
          ? bound({ identity, session: {}, key: requestKey })
          : bound(state.request);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invalid original start request.');
      return;
    }
    const wasUncertain = uncertain;
    const before = {
      status: 'error' as const,
      request,
      uncertain: true,
      message: lookup
        ? 'Checking the original start receipt.'
        : 'The start result is not yet confirmed. Keep the original request.',
    };
    try {
      persist(request);
    } catch {
      setStorageError(
        lookup
          ? 'Recovery storage is unavailable. This query retains the original request in the open page.'
          : 'The original start request could not be saved. No write was sent.',
      );
      if (!lookup) {
        setState({
          status: 'error',
          request,
          uncertain: wasUncertain,
          message:
            'No write was sent. Retry recovery storage before submitting the original request.',
        });
        setConfirmed(false);
        return;
      }
    }
    active.current = true;
    setState(before);
    setIntent(lookup ? 'receipt' : 'start');
    setConfirmed(false);
    transition(async () => {
      try {
        const next = parseStartFeedback(
          await submitStart(request, lookup ? 'receipt' : 'start', confirmed, wasUncertain),
          request,
        );
        if (wasUncertain && next.status === 'error' && !next.uncertain) throw new TypeError();
        setState(next);
      } catch {
        setState({
          ...before,
          message:
            'The response did not confirm this start. Check the original receipt before continuing.',
        });
      } finally {
        active.current = false;
      }
    });
  }
  function retryStorage() {
    if (!ready || active.current || !identity) return;
    try {
      if (state.status === 'idle') {
        const request = readStored();
        if (request) restore(request);
      } else persist(bound(state.request));
      setStorageError('');
      setMessage('Recovery storage can be read. No start request was sent.');
    } catch {
      setStorageError(
        'Recovery storage remains unavailable. Existing recovery information has not been replaced.',
      );
    }
  }
  function exportRequest() {
    if (!ready || active.current) return;
    try {
      const raw =
        state.status === 'idle'
          ? sessionStorage.getItem(storageKey)
          : encodeStartRecovery(state.request);
      if (!raw || raw.length > START_RECOVERY_LIMIT) throw new Error();
      setRecoveryText(raw);
      setMessage(
        'Copy this text before closing the tab. It contains original account, client, project and optional parent identifiers.',
      );
    } catch {
      setMessage('No bounded original start request is available to export.');
    }
  }
  function importRequest() {
    if (!ready || active.current || !identity) return;
    try {
      const request = bound(decodeStartRecovery(recoveryText));
      if (state.status !== 'idle' && !sameStart(state.request, request))
        throw new TypeError('A different original request is already open.');
      persist(request);
      restore(request);
      setMessage('Original request restored. No start or receipt query was sent.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Recovery text could not be restored.');
    }
  }
  function prepareAnother() {
    if (!ready || active.current || state.status !== 'done' || !canWrite) return;
    try {
      const raw = encodeStartRecovery(bound(state.request));
      const nextKey = crypto.randomUUID();
      const prior = readStored();
      if (prior && !sameStart(prior, state.request)) throw new TypeError();
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error();
      setRecoveryText(raw);
      setRequestKey(nextKey);
      setConfirmed(false);
      setState({ status: 'idle' });
      setStorageError('');
      setMessage(
        'A new session draft is ready. The previous original request remains in the recovery text; copy it to retain it. No command was sent.',
      );
    } catch {
      setStorageError(
        'The confirmed request could not be safely retained. No new request was prepared.',
      );
    }
  }

  if (!identity)
    return (
      <p className="muted">
        Sign in with a verified client to start a session or recover an earlier start.
      </p>
    );
  return (
    <div className="side-detail">
      {storageError && (
        <div role="alert">
          <p>{storageError}</p>
          <button type="button" className="secondary-button" disabled={busy} onClick={retryStorage}>
            Retry recovery storage
          </button>
        </div>
      )}
      <details>
        <summary>Recover an original start request</summary>
        <p>
          Original requests remain in this tab across reloads. Export before closing the tab.
          Recovery text contains identifiers and original parameters, without credentials.
        </p>
        <button type="button" className="secondary-button" disabled={busy} onClick={exportRequest}>
          Export original request
        </button>
        <label>
          Recovery text
          <textarea
            rows={6}
            maxLength={START_RECOVERY_LIMIT}
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
      {message && <p role="status">{message}</p>}
      {!canWrite && (
        <p>
          Session write access is unavailable. Original recovery information remains here; the
          server checks receipt access.
        </p>
      )}
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
        {state.status === 'idle' ? (
          <p>Start a new session in this project using your current account and client.</p>
        ) : (
          <div className="detail-grid">
            <div>
              <small>Original account</small>
              <strong>{state.request.identity.actor_id}</strong>
            </div>
            <div>
              <small>Original client</small>
              <strong>{state.request.identity.client_id}</strong>
            </div>
            <div>
              <small>Original parent session</small>
              <strong>{state.request.session.parent_session_id ?? 'No parent session'}</strong>
            </div>
            <div>
              <small>Original request key</small>
              <strong>{state.request.key}</strong>
            </div>
          </div>
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
              I confirm this session start using my original account and client.
            </label>
            <button
              className="primary-button"
              value="start"
              disabled={busy || !mayWrite || !confirmed}
            >
              {pending && intent === 'start'
                ? 'Starting…'
                : state.status === 'idle'
                  ? 'Start session'
                  : 'Retry original start'}
            </button>
            <button
              className="secondary-button"
              value="receipt"
              formNoValidate
              disabled={busy || state.status === 'idle'}
            >
              {pending && intent === 'receipt'
                ? 'Checking receipt…'
                : 'Check original start receipt'}
            </button>
            {uncertain && (
              <p role="status">
                This start result is unknown. Keep its parameters and key. A similar session or
                missing receipt cannot resolve it.
              </p>
            )}
          </>
        )}
        {state.status !== 'idle' && (
          <div aria-live="polite">
            <p>{state.message}</p>
            {state.trace && <small>Trace · {state.trace}</small>}
            {state.status === 'done' && (
              <>
                <p>
                  <Link
                    className="panel-link"
                    href={{
                      pathname: '/sessions/detail',
                      query: { session: state.receipt.session_id },
                    }}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read current session in a new tab
                  </Link>
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !canWrite}
                  onClick={prepareAnother}
                >
                  Prepare another session
                </button>
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
