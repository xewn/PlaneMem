'use client';

import { useState } from 'react';
import {
  isUlid,
  parseSessionCommandIdentity,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import { ClaimForm } from '../claim-form';
import {
  CLAIM_RECOVERY_LIMIT,
  claimRecoveryStorageKey,
  decodeClaimRecovery,
  type ClaimRequest,
} from '../claim-model';
import { ResumeForm } from '../resume-form';
import {
  RESUME_RECOVERY_LIMIT,
  resumeRecoveryStorageKey,
  decodeResumeRecovery,
  type ResumeRequest,
} from '../resume-model';

type LoadedRequest =
  | { operation: 'claim'; request: ClaimRequest }
  | { operation: 'resume'; request: ResumeRequest };

/** A selection only reads local recovery data. The original form owns every server operation. */
export function OriginalHandoffRecovery({
  operation,
  identity,
  canWrite,
}: {
  operation: 'claim' | 'resume';
  identity: SessionCommandIdentity;
  canWrite: boolean;
}) {
  const [session, setSession] = useState('');
  const [handoff, setHandoff] = useState('');
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState<LoadedRequest>();
  const [error, setError] = useState('');
  const limit = operation === 'claim' ? CLAIM_RECOVERY_LIMIT : RESUME_RECOVERY_LIMIT;

  function decode(raw: string): LoadedRequest {
    const result: LoadedRequest =
      operation === 'claim'
        ? { operation, request: decodeClaimRecovery(raw) }
        : { operation, request: decodeResumeRecovery(raw) };
    if (
      JSON.stringify(result.request.identity) !==
      JSON.stringify(parseSessionCommandIdentity(identity))
    )
      throw new TypeError(
        'This request belongs to another account, client or project. Sign in with its original identity.',
      );
    return result;
  }

  function loadStored() {
    if (loaded) return;
    try {
      if (!isUlid(session) || !isUlid(handoff))
        throw new TypeError('Enter the original session and handoff IDs.');
      const key =
        operation === 'claim'
          ? claimRecoveryStorageKey(identity, session, handoff)
          : resumeRecoveryStorageKey(identity, session, handoff);
      const raw = sessionStorage.getItem(key);
      if (raw === null)
        throw new TypeError(
          'No original request is saved for these IDs and this identity in this tab. Import an exported copy if available; a missing local request does not establish the operation result.',
        );
      const result = decode(raw);
      const parent =
        result.operation === 'claim' ? result.request.sessionId : result.request.parentSessionId;
      if (parent !== session || result.request.handoffId !== handoff)
        throw new TypeError('The saved request does not match these original IDs.');
      setLoaded(result);
      setError('');
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? cause.message
          : 'Recovery storage could not be read. You can import an exported original request. Saved data has not been changed.',
      );
    }
  }

  function importOriginal() {
    if (loaded) return;
    try {
      setLoaded(decode(text));
      setText('');
      setError('');
    } catch {
      setError(
        'Recovery text must be a supported original request for this operation and the current account, client and project. Nothing was submitted or replaced.',
      );
    }
  }

  if (loaded) {
    const request = loaded.request;
    const parent =
      loaded.operation === 'claim' ? loaded.request.sessionId : loaded.request.parentSessionId;
    return (
      <div className="side-detail">
        <p>
          This original request is fixed for this recovery view. Loading it does not confirm its
          result. Imported text stays in this view until you explicitly save it through the recovery
          controls or check or retry the request. Keep an exported copy before leaving this tab.
        </p>
        <dl style={{ overflowWrap: 'anywhere' }}>
          <dt>Original session</dt>
          <dd>{parent}</dd>
          <dt>Handoff</dt>
          <dd>{request.handoffId}</dd>
          <dt>Checkpoint</dt>
          <dd>{request.checkpointId}</dd>
          <dt>Original request key</dt>
          <dd>{request.key}</dd>
        </dl>
        {loaded.operation === 'claim' ? (
          <ClaimForm
            id={loaded.request.handoffId}
            session={loaded.request.sessionId}
            checkpoint={loaded.request.checkpointId}
            version={loaded.request.version}
            identity={identity}
            eligible={false}
            canClaim={canWrite}
            recoveryRequest={loaded.request}
          />
        ) : (
          <ResumeForm
            id={loaded.request.handoffId}
            session={loaded.request.parentSessionId}
            checkpoint={loaded.request.checkpointId}
            identity={identity}
            eligible={false}
            canWrite={canWrite}
            recoveryRequest={loaded.request}
          />
        )}
      </div>
    );
  }

  return (
    <div className="side-detail">
      <p>
        Load an original {operation} request saved in this tab, or paste its exported recovery text.
        Neither option reads current handoff details or sends a command or receipt query.
      </p>
      <form
        className="handoff-form"
        onSubmit={(event) => {
          event.preventDefault();
          loadStored();
        }}
      >
        <label>
          Original session ID
          <input
            required
            minLength={26}
            maxLength={26}
            pattern="[0-9A-HJKMNP-TV-Z]{26}"
            spellCheck={false}
            autoCapitalize="characters"
            value={session}
            onChange={(event) => setSession(event.target.value)}
          />
        </label>
        <label>
          Handoff ID
          <input
            required
            minLength={26}
            maxLength={26}
            pattern="[0-9A-HJKMNP-TV-Z]{26}"
            spellCheck={false}
            autoCapitalize="characters"
            value={handoff}
            onChange={(event) => setHandoff(event.target.value)}
          />
        </label>
        <button className="secondary-button" type="submit">
          Load original request from this tab
        </button>
      </form>
      <label>
        Exported {operation} recovery text
        <textarea
          rows={6}
          maxLength={limit}
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <button className="secondary-button" type="button" disabled={!text} onClick={importOriginal}>
        Load exported original request
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
