'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from '@planemem/contracts';
import { submitResume } from './resume-actions';
import type { HandoffDetailControls } from './detail-model';
import {
  RESUME_RECOVERY_LIMIT,
  resumeRecoveryStorageKey,
  parseResumeRequest,
  parseResumeFeedback,
  sameResume,
  encodeResumeRecovery,
  decodeResumeRecovery,
  type ResumeRequest,
  type ResumeFeedback,
} from './resume-model';

function recoveredResume(request: ResumeRequest): ResumeFeedback {
  return {
    status: 'error',
    request,
    uncertain: true,
    message:
      'Original resume request recovered. Check its receipt; its outcome has not been confirmed in this page.',
  };
}

export function ResumeForm({
  id,
  session,
  checkpoint,
  identity,
  eligible,
  canWrite,
  controls,
  recoveryRequest,
}: {
  id: string;
  session: string;
  checkpoint: string;
  identity?: SessionCommandIdentity;
  eligible: boolean;
  canWrite: boolean;
  controls?: HandoffDetailControls;
  recoveryRequest?: ResumeRequest;
}) {
  const [state, setState] = useState<ResumeFeedback>(() =>
    recoveryRequest ? recoveredResume(recoveryRequest) : { status: 'idle' },
  );
  const [confirmation, setConfirmation] = useState<string>();
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [recoveryText, setRecoveryText] = useState('');
  const [message, setMessage] = useState('');
  const [intent, setIntent] = useState<'resume' | 'receipt'>('resume');
  const [pending, transition] = useTransition();
  const active = useRef(false);
  const storageKey = resumeRecoveryStorageKey(identity, session, id);
  const saved = state.status === 'done';
  const uncertain = state.status === 'error' && state.uncertain;
  const busy = !ready || pending || controls?.busy === true;
  const confirmationScope = JSON.stringify([
    identity,
    session,
    id,
    checkpoint,
    eligible,
    canWrite,
    controls?.reviewRevision,
    controls?.writeReady,
    recoveryRequest,
  ]);
  const confirmed = confirmation === confirmationScope;
  function setConfirmed(value: boolean) {
    setConfirmation(value ? confirmationScope : undefined);
  }
  useEffect(() => {
    // Returning to a previous eligibility state must not resurrect its old confirmation.
    setConfirmation(undefined);
  }, [confirmationScope]);
  const mayWrite =
    !!identity &&
    canWrite &&
    (eligible || uncertain) &&
    !saved &&
    !storageError &&
    (!recoveryRequest || state.status !== 'idle') &&
    controls?.writeReady !== false;

  function bound(value: unknown) {
    const request = parseResumeRequest(value);
    if (
      !identity ||
      request.parentSessionId !== session ||
      request.handoffId !== id ||
      request.checkpointId !== checkpoint ||
      (recoveryRequest !== undefined && !sameResume(request, recoveryRequest)) ||
      JSON.stringify(request.identity) !== JSON.stringify(parseSessionCommandIdentity(identity))
    )
      throw new TypeError(
        'This resume request does not match the original identity, handoff, checkpoint or request selected here.',
      );
    return request;
  }
  function currentRequest() {
    if (recoveryRequest && state.status === 'idle')
      throw new TypeError('Load the original resume request before continuing.');
    return state.status === 'idle'
      ? bound({
          identity,
          parentSessionId: session,
          handoffId: id,
          checkpointId: checkpoint,
          key: `workbench-resume-${id}`,
          requireClaimed: true,
        })
      : bound(state.request);
  }
  function readStored() {
    const raw = sessionStorage.getItem(storageKey);
    return raw === null ? undefined : bound(decodeResumeRecovery(raw));
  }
  function persist(request: ResumeRequest) {
    const prior = readStored();
    if (prior && !sameResume(prior, request))
      throw new TypeError('Another original resume is already saved.');
    const raw = encodeResumeRecovery(request);
    sessionStorage.setItem(storageKey, raw);
    if (sessionStorage.getItem(storageKey) !== raw)
      throw new Error('Recovery storage is unavailable');
    setStorageError('');
  }
  function restore(request: ResumeRequest) {
    setConfirmed(false);
    setState(recoveredResume(request));
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
        'The original resume request could not be read. Writes are disabled to protect recovery information.',
      );
    } finally {
      setReady(true);
    }
    // The parent is keyed by the verified identity, parent, handoff and checkpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function execute(lookup: boolean) {
    if (busy || active.current || !identity || saved || (!lookup && (!mayWrite || !confirmed)))
      return;
    let request: ResumeRequest;
    try {
      request = currentRequest();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'The original request could not be read.',
      );
      return;
    }
    const wasUncertain = uncertain;
    const before = {
      status: 'error' as const,
      request,
      uncertain: true,
      message: lookup
        ? 'Checking the original resume receipt.'
        : 'The resume result is not yet confirmed. Keep the original request.',
    };
    if (controls && !controls.acquire()) return;
    try {
      persist(request);
    } catch {
      setStorageError(
        lookup
          ? 'Recovery storage is unavailable. This receipt query retains the original request in the open page.'
          : 'The original resume request could not be saved. No write was sent.',
      );
      if (!lookup) {
        setConfirmed(false);
        controls?.release(false);
        return;
      }
    }
    active.current = true;
    setState(before);
    setIntent(lookup ? 'receipt' : 'resume');
    setConfirmed(false);
    transition(async () => {
      try {
        const next = parseResumeFeedback(
          await submitResume(request, lookup ? 'receipt' : 'resume', confirmed, wasUncertain),
          request,
        );
        if (wasUncertain && next.status === 'error' && !next.uncertain) throw new TypeError();
        setState(next);
      } catch {
        setState({
          ...before,
          message:
            'The response did not confirm this resume. Check the original receipt before continuing.',
        });
      } finally {
        active.current = false;
        controls?.release(!lookup);
      }
    });
  }
  function retryStorage() {
    if (busy || active.current || !identity) return;
    try {
      if (state.status === 'idle') {
        const request = readStored();
        if (request) restore(request);
      } else persist(bound(state.request));
      setStorageError('');
      setMessage('Recovery storage can be read. No resume request was sent.');
    } catch {
      setStorageError(
        'Recovery storage remains unavailable. Existing recovery information has not been replaced.',
      );
    }
  }
  function exportRequest() {
    if (busy || active.current) return;
    try {
      const raw =
        state.status === 'idle'
          ? sessionStorage.getItem(storageKey)
          : encodeResumeRecovery(state.request);
      if (!raw || raw.length > RESUME_RECOVERY_LIMIT) throw new Error();
      setRecoveryText(raw);
      setMessage(
        'Copy this text before closing the tab. It contains account and original request identifiers.',
      );
    } catch {
      setMessage('No bounded original resume request is available to export.');
    }
  }
  function importRequest() {
    if (busy || active.current || !identity) return;
    try {
      const request = bound(decodeResumeRecovery(recoveryText));
      if (state.status !== 'idle' && !sameResume(state.request, request))
        throw new TypeError('A different request is already open.');
      persist(request);
      restore(request);
      setMessage(
        'Original request restored. Check its receipt or confirm before retrying. No command was submitted.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Recovery text could not be restored.');
    }
  }

  if (!identity)
    return (
      <p className="muted">
        Sign in with a verified client to resume or recover an earlier request.
      </p>
    );
  return (
    <details open={recoveryRequest ? true : undefined}>
      <summary>
        {saved ? 'Resume confirmed' : eligible ? 'Resume session' : 'Recover an earlier resume'}
      </summary>
      {storageError && (
        <div role="alert">
          <p>{storageError}</p>
          <button type="button" className="secondary-button" disabled={busy} onClick={retryStorage}>
            Retry recovery storage
          </button>
        </div>
      )}
      <details>
        <summary>Recover an original resume request</summary>
        <p>
          Requests remain in this tab across reloads. Export before closing the tab. Recovery text
          contains account and request identifiers, without credentials or checkpoint notes.
        </p>
        <button type="button" className="secondary-button" disabled={busy} onClick={exportRequest}>
          Export original request
        </button>
        <label>
          Recovery text
          <textarea
            rows={6}
            maxLength={RESUME_RECOVERY_LIMIT}
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
          Session write permission is unavailable. The original request can still be exported or
          checked subject to current server access.
        </p>
      )}
      {recoveryRequest && (
        <p>
          Current handoff details have not been read. Only the loaded original request can be
          checked or retried; the server checks current access for every operation.
        </p>
      )}
      {!eligible && !recoveryRequest && (
        <p>
          This handoff is not currently shown as ready for a new resume. Keep any earlier request
          and check its receipt.
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
        {!saved && (
          <>
            <small>Checkpoint · {checkpoint}</small>
            <label className="confirmation-box">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || !mayWrite}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              Continue this original checkpoint in a child session.
            </label>
            <button
              className="primary-button"
              value="resume"
              disabled={busy || !mayWrite || !confirmed}
            >
              {pending && intent === 'resume'
                ? 'Restoring…'
                : uncertain
                  ? 'Retry original resume'
                  : 'Resume session'}
            </button>
            <button className="secondary-button" value="receipt" formNoValidate disabled={busy}>
              {pending && intent === 'receipt'
                ? 'Checking receipt…'
                : 'Check previous resume result'}
            </button>
            {uncertain && (
              <p role="status">
                The resume result is unknown. Keep this original request and key. Changes to
                ownership, permissions or context do not resolve it.
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
                    Open child session state ↗ · {state.receipt.session_id}
                  </Link>
                </p>
                <p>
                  <Link
                    className="panel-link"
                    target="_blank"
                    rel="noreferrer"
                    href={{
                      pathname: '/sessions/checkpoint',
                      query: {
                        session: state.receipt.parent_session_id,
                        checkpoint: state.receipt.checkpoint_id,
                      },
                    }}
                  >
                    Read original checkpoint ↗
                  </Link>
                </p>
                {state.contextPackId && (
                  <p>
                    <Link
                      className="panel-link"
                      href={{ pathname: '/context', query: { pack: state.contextPackId } }}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open context pack checked for this response
                    </Link>
                  </p>
                )}
                {!!state.nextActions?.length && (
                  <>
                    <h4>Next actions</h4>
                    <ul>
                      {state.nextActions.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </form>
    </details>
  );
}
