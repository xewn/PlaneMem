'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from '@planemem/contracts';
import { submitClaim } from './claim-actions';
import type { HandoffDetailControls } from './detail-model';
import {
  CLAIM_RECOVERY_LIMIT,
  claimRecoveryStorageKey,
  parseClaimRequest,
  parseClaimFeedback,
  sameClaim,
  encodeClaimRecovery,
  decodeClaimRecovery,
  type ClaimRequest,
  type ClaimFeedback,
} from './claim-model';

function recoveredClaim(request: ClaimRequest): ClaimFeedback {
  return {
    status: 'error',
    request,
    uncertain: true,
    message:
      'Original claim request recovered. Check its receipt; its outcome has not been confirmed in this page.',
  };
}

export function ClaimForm({
  id,
  session,
  checkpoint,
  version,
  identity,
  eligible,
  canClaim,
  controls,
  recoveryRequest,
}: {
  id: string;
  session: string;
  checkpoint: string;
  version: number;
  identity?: SessionCommandIdentity;
  eligible: boolean;
  canClaim: boolean;
  controls?: HandoffDetailControls;
  recoveryRequest?: ClaimRequest;
}) {
  const [state, setState] = useState<ClaimFeedback>(() =>
    recoveryRequest ? recoveredClaim(recoveryRequest) : { status: 'idle' },
  );
  const [confirmation, setConfirmation] = useState<string>();
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [recoveryText, setRecoveryText] = useState('');
  const [message, setMessage] = useState('');
  const [intent, setIntent] = useState<'claim' | 'receipt'>('claim');
  const [pending, transition] = useTransition();
  const active = useRef(false);
  const storageKey = claimRecoveryStorageKey(identity, session, id);
  const saved = state.status === 'done';
  const uncertain = state.status === 'error' && state.uncertain;
  const busy = !ready || pending || controls?.busy === true;
  const confirmationScope = JSON.stringify([
    identity,
    session,
    id,
    checkpoint,
    version,
    eligible,
    canClaim,
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
    canClaim &&
    (eligible || uncertain) &&
    !saved &&
    !storageError &&
    (!recoveryRequest || state.status !== 'idle') &&
    controls?.writeReady !== false;

  function bound(value: unknown) {
    const request = parseClaimRequest(value);
    if (
      !identity ||
      request.sessionId !== session ||
      request.handoffId !== id ||
      request.checkpointId !== checkpoint ||
      (recoveryRequest !== undefined && !sameClaim(request, recoveryRequest)) ||
      JSON.stringify(request.identity) !== JSON.stringify(parseSessionCommandIdentity(identity))
    )
      throw new TypeError(
        'This claim request does not match the original identity, handoff, checkpoint or request selected here.',
      );
    return request;
  }
  function currentRequest() {
    if (recoveryRequest && state.status === 'idle')
      throw new TypeError('Load the original claim request before continuing.');
    return state.status === 'idle'
      ? bound({
          identity,
          sessionId: session,
          handoffId: id,
          checkpointId: checkpoint,
          version,
          key: `claim-${id}-v${version}`,
        })
      : bound(state.request);
  }
  function readStored() {
    const raw = sessionStorage.getItem(storageKey);
    return raw === null ? undefined : bound(decodeClaimRecovery(raw));
  }
  function persist(request: ClaimRequest) {
    const prior = readStored();
    if (prior && !sameClaim(prior, request))
      throw new TypeError('Another original claim is already saved.');
    const raw = encodeClaimRecovery(request);
    sessionStorage.setItem(storageKey, raw);
    if (sessionStorage.getItem(storageKey) !== raw)
      throw new Error('Recovery storage is unavailable');
    setStorageError('');
  }
  function restore(request: ClaimRequest) {
    setConfirmed(false);
    setState(recoveredClaim(request));
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
        'The original claim request could not be read. Writes are disabled to protect recovery information.',
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
    let request: ClaimRequest;
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
        ? 'Checking the original claim receipt.'
        : 'The claim result is not yet confirmed. Keep the original request.',
    };
    if (controls && !controls.acquire()) return;
    try {
      persist(request);
    } catch {
      setStorageError(
        lookup
          ? 'Recovery storage is unavailable. This receipt query retains the original request in the open page.'
          : 'The original claim request could not be saved. No write was sent.',
      );
      if (!lookup) {
        setConfirmed(false);
        controls?.release(false);
        return;
      }
    }
    active.current = true;
    setState(before);
    setIntent(lookup ? 'receipt' : 'claim');
    setConfirmed(false);
    transition(async () => {
      try {
        const next = parseClaimFeedback(
          await submitClaim(request, lookup ? 'receipt' : 'claim', confirmed, wasUncertain),
          request,
        );
        if (wasUncertain && next.status === 'error' && !next.uncertain) throw new TypeError();
        setState(next);
      } catch {
        setState({
          ...before,
          message:
            'The response did not confirm this claim. Check the original receipt before continuing.',
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
      setMessage('Recovery storage can be read. No claim request was sent.');
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
          : encodeClaimRecovery(state.request);
      if (!raw || raw.length > CLAIM_RECOVERY_LIMIT) throw new Error();
      setRecoveryText(raw);
      setMessage(
        'Copy this text before closing the tab. It contains account and original request identifiers.',
      );
    } catch {
      setMessage('No bounded original claim request is available to export.');
    }
  }
  function importRequest() {
    if (busy || active.current || !identity) return;
    try {
      const request = bound(decodeClaimRecovery(recoveryText));
      if (state.status !== 'idle' && !sameClaim(state.request, request))
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
        Sign in with a verified client to claim or recover an earlier request.
      </p>
    );
  return (
    <details open={recoveryRequest ? true : undefined}>
      <summary>
        {saved
          ? 'Ownership claim confirmed'
          : eligible
            ? 'Claim handoff'
            : 'Recover an earlier ownership claim'}
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
        <summary>Recover an original claim request</summary>
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
            maxLength={CLAIM_RECOVERY_LIMIT}
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
      {!canClaim && (
        <p>
          Claim permission is unavailable. Recovery information remains here; receipt access is
          checked by the server.
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
          This handoff is not currently shown as open to this client. An earlier claim can still be
          checked.
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
            <small>
              Original handoff version · {state.status === 'idle' ? version : state.request.version}
            </small>
            <label className="confirmation-box">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || !mayWrite}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I accept ownership using my original signed-in account and client.
            </label>
            <button
              className="primary-button"
              value="claim"
              disabled={busy || !mayWrite || !confirmed}
            >
              {pending && intent === 'claim'
                ? 'Claiming…'
                : uncertain
                  ? 'Retry original claim'
                  : 'Claim handoff'}
            </button>
            <button className="secondary-button" value="receipt" formNoValidate disabled={busy}>
              {pending && intent === 'receipt'
                ? 'Checking receipt…'
                : 'Check original claim receipt'}
            </button>
            {uncertain && (
              <p role="status">
                This claim result is unknown. Keep its original version and key. Current ownership
                or a missing receipt cannot resolve it.
              </p>
            )}
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
            )}
          </div>
        )}
      </form>
    </details>
  );
}
