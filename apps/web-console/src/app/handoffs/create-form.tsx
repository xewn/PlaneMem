'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from '@planemem/contracts';
import { submitCreation } from './actions';
import {
  CREATE_RECOVERY_LIMIT,
  parseCreateRequest,
  parseCreateFeedback,
  sameCreation,
  encodeCreateRecovery,
  decodeCreateRecovery,
  type CreateRequest,
  type CreateFeedback,
} from './create-model';

export interface CheckpointOption {
  id: string;
  session: string;
  label: string;
}

export function CreateForm({
  options,
  initialKey,
  initialCheckpoint,
  identity,
  canWrite,
  optionsUnavailable = false,
  selectionCanWrite = canWrite,
  emptyMessage,
  recoveryOnly = false,
}: {
  options: CheckpointOption[];
  initialKey: string;
  initialCheckpoint?: string;
  identity?: SessionCommandIdentity;
  canWrite: boolean;
  optionsUnavailable?: boolean;
  selectionCanWrite?: boolean;
  emptyMessage?: string;
  recoveryOnly?: boolean;
}) {
  const [state, setState] = useState<CreateFeedback>({ status: 'idle' });
  const [checkpointId, selectCheckpoint] = useState(initialCheckpoint ?? options[0]?.id ?? '');
  const [target, setTarget] = useState('');
  const [requestKey, setRequestKey] = useState(initialKey);
  const [confirmed, setConfirmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [recoveryText, setRecoveryText] = useState('');
  const [message, setMessage] = useState('');
  const [intent, setIntent] = useState<'create' | 'receipt'>('create');
  const [pending, transition] = useTransition();
  const active = useRef(false);
  // One unresolved creation per identity/project, independent of the selected checkpoint.
  const storageKey = 'planemem-handoff-create-v1:' + JSON.stringify(identity);
  const saved = state.status === 'done';
  const uncertain = state.status === 'error' && state.uncertain;
  const busy = !ready || pending;
  const selected = options.find((option) => option.id === checkpointId);
  const reviewCheckpoint =
    state.status === 'idle'
      ? selected
      : { id: state.request.checkpointId, session: state.request.sessionId };
  const mayWrite =
    !!identity &&
    canWrite &&
    !saved &&
    !storageError &&
    (state.status !== 'idle' || (!recoveryOnly && selectionCanWrite && !!selected));

  function bound(value: unknown): CreateRequest {
    const request = parseCreateRequest(value);
    if (
      !identity ||
      JSON.stringify(request.identity) !== JSON.stringify(parseSessionCommandIdentity(identity))
    )
      throw new TypeError('This creation request belongs to another account, client or project.');
    return request;
  }
  function readStored() {
    const raw = sessionStorage.getItem(storageKey);
    return raw === null ? undefined : bound(decodeCreateRecovery(raw));
  }
  function persist(request: CreateRequest) {
    const prior = readStored();
    if (prior && !sameCreation(prior, request))
      throw new TypeError('Another original creation request is already saved.');
    const raw = encodeCreateRecovery(request);
    sessionStorage.setItem(storageKey, raw);
    if (sessionStorage.getItem(storageKey) !== raw)
      throw new Error('Recovery storage is unavailable');
    setStorageError('');
  }
  function restore(request: CreateRequest) {
    setConfirmed(false);
    setState({
      status: 'error',
      request,
      uncertain: true,
      message:
        'Original creation request recovered. Check its receipt; its outcome has not been confirmed in this page.',
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
        'The original creation request could not be read. Writes are disabled to protect recovery information.',
      );
    } finally {
      setReady(true);
    }
    // The parent is keyed by the verified identity; changing selection does not replace recovery.
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
    let request: CreateRequest;
    try {
      request =
        state.status === 'idle'
          ? bound({
              identity,
              sessionId: selected?.session,
              checkpointId: selected?.id,
              key: requestKey,
              ...(target.trim() ? { target: target.trim() } : {}),
            })
          : bound(state.request);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invalid original request.');
      return;
    }
    const wasUncertain = uncertain;
    const before = {
      status: 'error' as const,
      request,
      uncertain: true,
      message: lookup
        ? 'Checking the original creation receipt.'
        : 'The creation result is not yet confirmed. Keep the original request.',
    };
    try {
      persist(request);
    } catch {
      setStorageError(
        lookup
          ? 'Recovery storage is unavailable. This query retains the original request in the open page.'
          : 'The original creation request could not be saved. No write was sent.',
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
    setIntent(lookup ? 'receipt' : 'create');
    setConfirmed(false);
    transition(async () => {
      try {
        const next = parseCreateFeedback(
          await submitCreation(request, lookup ? 'receipt' : 'create', confirmed, wasUncertain),
          request,
        );
        if (wasUncertain && next.status === 'error' && !next.uncertain) throw new TypeError();
        setState(next);
      } catch {
        setState({
          ...before,
          message:
            'The response did not confirm this creation. Check the original receipt before continuing.',
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
      setMessage('Recovery storage can be read. No creation request was sent.');
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
          : encodeCreateRecovery(state.request);
      if (!raw || raw.length > CREATE_RECOVERY_LIMIT) throw new Error();
      setRecoveryText(raw);
      setMessage(
        'Copy this text before closing the tab. It contains original account, checkpoint and recipient identifiers.',
      );
    } catch {
      setMessage('No bounded original creation request is available to export.');
    }
  }
  function importRequest() {
    if (!ready || active.current || !identity) return;
    try {
      const request = bound(decodeCreateRecovery(recoveryText));
      if (state.status !== 'idle' && !sameCreation(state.request, request))
        throw new TypeError('A different original request is already open.');
      persist(request);
      restore(request);
      setMessage('Original request restored. No creation or receipt query was sent.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Recovery text could not be restored.');
    }
  }
  function prepareAnother() {
    if (recoveryOnly || !ready || active.current || state.status !== 'done' || !canWrite) return;
    try {
      // Preserve the confirmed original request in the export area before rotating its slot.
      const raw = encodeCreateRecovery(bound(state.request));
      const nextKey = crypto.randomUUID();
      const prior = readStored();
      if (prior && !sameCreation(prior, state.request)) throw new TypeError();
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error();
      setRecoveryText(raw);
      setRequestKey(nextKey);
      setConfirmed(false);
      setTarget('');
      selectCheckpoint(options[0]?.id ?? '');
      setState({ status: 'idle' });
      setStorageError('');
      setMessage(
        'A new draft is ready. The previous original request remains in the recovery text; copy it to retain it. No command was sent.',
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
        Sign in with a verified client to create a handoff or recover an earlier creation.
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
      <details open={recoveryOnly ? true : undefined}>
        <summary>Recover an original creation request</summary>
        <p>
          Original requests remain in this tab across reloads. Export before closing the tab.
          Recovery text contains identifiers and the target client, without credentials or
          checkpoint notes.
        </p>
        <button type="button" className="secondary-button" disabled={busy} onClick={exportRequest}>
          Export original request
        </button>
        <label>
          Recovery text
          <textarea
            rows={6}
            maxLength={CREATE_RECOVERY_LIMIT}
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
        {state.status === 'idle' && recoveryOnly ? (
          <p>
            Restore an original request above to check its receipt. No new creation is prepared on
            this page.
          </p>
        ) : state.status === 'idle' ? (
          <>
            {optionsUnavailable && (
              <p>
                Checkpoint choices could not be loaded. Restore an original request above, or use a
                saved session and checkpoint ID to open the separate preparation page.
              </p>
            )}
            {!options.length &&
              !initialCheckpoint &&
              !optionsUnavailable &&
              (emptyMessage ? (
                <p>{emptyMessage}</p>
              ) : (
                <p>
                  Save a checkpoint in{' '}
                  <Link className="panel-link" href="/sessions">
                    Sessions
                  </Link>{' '}
                  before creating a handoff. Earlier requests can still be restored above.
                </p>
              ))}
            {initialCheckpoint && !options.some((option) => option.id === initialCheckpoint) && (
              <p>
                The requested checkpoint could not be selected. Read its details again before
                preparing a new handoff, or restore an original request above.
              </p>
            )}
            <label>
              Checkpoint
              <select
                required
                value={checkpointId}
                disabled={busy || !canWrite || !selectionCanWrite || !!storageError}
                onChange={(event) => {
                  selectCheckpoint(event.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="">Select a checkpoint</option>
                {options.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target client (optional)
              <input
                value={target}
                maxLength={1024}
                disabled={busy || !canWrite || !selectionCanWrite || !!storageError}
                placeholder="Any authorized client"
                onChange={(event) => {
                  setTarget(event.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
          </>
        ) : (
          <div className="detail-grid">
            <div>
              <small>Original session</small>
              <strong>{state.request.sessionId}</strong>
            </div>
            <div>
              <small>Original checkpoint</small>
              <strong>{state.request.checkpointId}</strong>
            </div>
            <div>
              <small>Original target</small>
              <strong>{state.request.target ?? 'Any authorized client'}</strong>
            </div>
          </div>
        )}
        {reviewCheckpoint && (
          <p>
            <Link
              className="panel-link"
              target="_blank"
              rel="noreferrer"
              href={{
                pathname: '/sessions/checkpoint',
                query: { session: reviewCheckpoint.session, checkpoint: reviewCheckpoint.id },
              }}
            >
              {state.status === 'idle'
                ? 'Review selected checkpoint'
                : 'Review original checkpoint'}{' '}
              ↗
            </Link>
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
              I confirm this checkpoint and recipient using my original account and client.
            </label>
            <button
              className="primary-button"
              value="create"
              disabled={busy || !mayWrite || !confirmed}
            >
              {pending && intent === 'create'
                ? 'Creating…'
                : state.status === 'idle' && !recoveryOnly
                  ? 'Create handoff'
                  : 'Retry original creation'}
            </button>
            <button
              className="secondary-button"
              value="receipt"
              formNoValidate
              disabled={busy || state.status === 'idle'}
            >
              {pending && intent === 'receipt'
                ? 'Checking receipt…'
                : 'Check original creation receipt'}
            </button>
            {uncertain && (
              <p role="status">
                This creation result is unknown. Keep its checkpoint, target and key. A similar
                handoff or missing receipt cannot resolve it.
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
                      pathname: '/handoffs/detail',
                      query: { handoff: state.receipt.handoff_id },
                    }}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read current handoff in a new tab
                  </Link>
                </p>
                {!recoveryOnly && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !canWrite}
                    onClick={prepareAnother}
                  >
                    Prepare another handoff
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
