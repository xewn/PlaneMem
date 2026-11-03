'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from '@planemem/contracts';
import { submitActivityFinish } from './finish-actions';
import {
  parseFinishRequest,
  parseFinishFeedback,
  sameFinishRequest,
  decodeFinishRecovery,
  encodeFinishRecovery,
  FINISH_RECOVERY_LIMIT,
  finishRecoveryStorageKey,
  type FinishOperation,
  type FinishOutcome,
  type FinishRequest,
  type FinishFeedback,
} from './finish-model';

export function useFinishRecovery(options: {
  operation: FinishOperation;
  identity?: SessionCommandIdentity;
  sessionId: string;
  resourceId: string;
  version: number;
  resourceVersion?: number;
  canWrite: boolean;
  eligible: boolean;
  initialKey: string;
}) {
  const [identity] = useState(options.identity);
  const [draft, setDraft] = useState({
    key: options.initialKey,
    version: options.version,
    resourceVersion: options.resourceVersion,
    outcome: (options.operation === 'run.finish'
      ? 'completed'
      : options.operation === 'tool.finish'
        ? 'succeeded'
        : 'ended') as FinishOutcome,
  });
  const [state, setState] = useState<FinishFeedback>({ status: 'idle' });
  const [confirmed, setConfirmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [recoveryText, setRecoveryText] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [pending, transition] = useTransition();
  const [intent, setIntent] = useState<'finish' | 'receipt' | 'refresh'>('finish');
  const active = useRef(false);
  const storageKey = finishRecoveryStorageKey(
    identity,
    options.operation,
    options.sessionId,
    options.resourceId,
  );
  const current = state.status !== 'idle';
  const uncertain = state.status === 'error' && state.uncertain;
  const saved = state.status === 'done';
  const changed =
    draft.version !== options.version || draft.resourceVersion !== options.resourceVersion;
  const busy = pending || !ready;
  const locked =
    busy ||
    uncertain ||
    saved ||
    !options.canWrite ||
    !identity ||
    recoveryBlocked ||
    !!storageError;

  function boundRequest(value: unknown): FinishRequest {
    const request = parseFinishRequest(value);
    if (
      !identity ||
      request.operation !== options.operation ||
      request.sessionId !== options.sessionId ||
      (request.operation === 'end' ? request.sessionId : request.resourceId) !==
        options.resourceId ||
      JSON.stringify(request.identity) !== JSON.stringify(parseSessionCommandIdentity(identity))
    )
      throw new TypeError('This request belongs to a different record, project or account.');
    return request;
  }
  function readStored(): FinishRequest | undefined {
    const raw = sessionStorage.getItem(storageKey);
    return raw === null ? undefined : boundRequest(decodeFinishRecovery(raw));
  }
  function persist(request: FinishRequest) {
    const prior = readStored();
    if (prior && !sameFinishRequest(prior, request))
      throw new Error('A different original request is already saved.');
    const raw = encodeFinishRecovery(request);
    sessionStorage.setItem(storageKey, raw);
    if (sessionStorage.getItem(storageKey) !== raw)
      throw new Error('Recovery storage is unavailable.');
    setStorageError('');
  }
  function restore(request: FinishRequest) {
    setDraft({
      key: request.key,
      version: request.version,
      resourceVersion: request.resourceVersion,
      outcome: request.outcome,
    });
    setState({
      status: 'error',
      request,
      uncertain: true,
      message:
        'The original request was recovered. Check its receipt; its outcome has not been confirmed in this page.',
    });
    setConfirmed(false);
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
      setRecoveryBlocked(true);
      setStorageError(
        'The saved request could not be read. New writes are disabled so its recovery information is not replaced.',
      );
    } finally {
      setReady(true);
    }
    // Parent pages key this component by the verified identity and resource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function execute(lookup: boolean) {
    if (
      !ready ||
      active.current ||
      !identity ||
      recoveryBlocked ||
      saved ||
      !options.canWrite ||
      (lookup && !current) ||
      (!lookup && (!confirmed || storageError || (!uncertain && (changed || !options.eligible))))
    )
      return;
    let request: FinishRequest;
    try {
      request = boundRequest(
        state.status === 'idle'
          ? {
              key: draft.key,
              version: draft.version,
              outcome: draft.outcome,
              identity,
              operation: options.operation,
              sessionId: options.sessionId,
              ...(options.operation === 'end'
                ? {}
                : { resourceId: options.resourceId, resourceVersion: draft.resourceVersion }),
            }
          : state.request,
      );
    } catch {
      setRecoveryMessage('The original request is invalid. No command was sent.');
      return;
    }
    const wasUncertain = uncertain;
    const before: Exclude<FinishFeedback, { status: 'idle' | 'done' }> = {
      status: 'error',
      request,
      uncertain: wasUncertain || !lookup,
      message: lookup
        ? 'Checking the original receipt.'
        : 'The result is not yet confirmed. Keep the original request.',
    };
    try {
      persist(request);
    } catch {
      setStorageError(
        lookup
          ? 'Recovery storage is unavailable. This receipt query keeps the request in the open page.'
          : 'The original request could not be saved. No write was sent.',
      );
      if (!lookup) return;
    }
    active.current = true;
    setState(before);
    setIntent(lookup ? 'receipt' : 'finish');
    transition(async () => {
      try {
        const next = parseFinishFeedback(
          await submitActivityFinish(
            request,
            lookup ? 'receipt' : 'finish',
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
            'The response could not be confirmed. Keep the original request and check its receipt.',
        });
      } finally {
        active.current = false;
      }
      // Keep the saved original request even on success. A reload rechecks its receipt.
    });
  }

  function prepare(next: Pick<typeof draft, 'version' | 'resourceVersion' | 'outcome'>) {
    if (active.current || locked || !options.eligible) return;
    try {
      const stored = readStored();
      if (stored && (state.status === 'idle' || !sameFinishRequest(stored, state.request)))
        throw new Error();
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error();
    } catch {
      setStorageError(
        'The previous recovery request could not be cleared. No new request was prepared.',
      );
      return;
    }
    setDraft({ ...next, key: crypto.randomUUID() });
    setState({ status: 'idle' });
    setConfirmed(false);
    setRecoveryText('');
    setRecoveryMessage('');
  }
  function refresh(read: () => Promise<void>) {
    if (!ready || active.current) return;
    active.current = true;
    setIntent('refresh');
    transition(async () => {
      try {
        await read();
      } finally {
        active.current = false;
      }
    });
  }
  function exportRequest() {
    if (!ready || active.current) return;
    try {
      const raw =
        state.status !== 'idle'
          ? encodeFinishRecovery(state.request)
          : sessionStorage.getItem(storageKey);
      if (!raw || raw.length > FINISH_RECOVERY_LIMIT) throw new Error();
      setRecoveryText(raw);
      setRecoveryMessage(
        'Copy this recovery text before closing the tab. Restore it using the original account, project and record.',
      );
    } catch {
      setRecoveryMessage(
        'No bounded recovery text is available. Existing saved data has not been changed.',
      );
    }
  }
  function retryStorage() {
    if (!ready || active.current || !identity) return;
    try {
      if (state.status === 'idle') {
        const request = readStored();
        if (request) restore(request);
      } else {
        persist(state.request);
      }
      setRecoveryBlocked(false);
      setStorageError('');
      setRecoveryMessage('Recovery storage is available again. No command was sent.');
    } catch {
      setStorageError(
        'Recovery storage could not be read or preserved. Existing recovery information has not been replaced.',
      );
    }
  }
  function importRequest() {
    if (!ready || active.current || !identity) return;
    try {
      const request = boundRequest(decodeFinishRecovery(recoveryText));
      if (state.status !== 'idle' && !sameFinishRequest(state.request, request)) throw new Error();
      // persist also re-reads the saved slot. Corrupt or different records cannot be overwritten.
      persist(request);
      restore(request);
      setRecoveryBlocked(false);
      setRecoveryMessage(
        'Original request restored. Check its receipt, or confirm before retrying. Nothing was submitted.',
      );
    } catch {
      setRecoveryMessage(
        'Recovery text could not be restored for this record and account. Existing saved data has not been changed.',
      );
    }
  }
  return {
    state,
    identity,
    draft,
    confirmed,
    setConfirmed,
    current,
    saved,
    retry: state.status === 'error',
    uncertain,
    changed,
    busy,
    pending,
    locked,
    ready,
    storageError,
    recoveryBlocked,
    recoveryText,
    setRecoveryText,
    recoveryMessage,
    intent,
    refreshing: pending && intent === 'refresh',
    execute,
    refresh,
    setOutcome: (outcome: FinishOutcome) =>
      prepare({ version: draft.version, resourceVersion: draft.resourceVersion, outcome }),
    useCurrentVersions: () =>
      prepare({
        version: options.version,
        resourceVersion: options.resourceVersion,
        outcome: draft.outcome,
      }),
    exportRequest,
    importRequest,
    retryStorage,
  };
}

export function FinishRecoveryPanel({
  recovery,
}: {
  recovery: ReturnType<typeof useFinishRecovery>;
}) {
  return (
    <>
      {recovery.storageError && <p role="alert">{recovery.storageError}</p>}
      {recovery.storageError && (
        <button
          type="button"
          className="secondary-button"
          disabled={recovery.busy || !recovery.identity}
          onClick={recovery.retryStorage}
        >
          Retry recovery storage
        </button>
      )}
      <details>
        <summary>Recover an original result request</summary>
        <p>
          Submitted requests are retained in this browser tab across reloads. Closing the tab can
          discard them. Export the original request before closing; restoring it never submits a
          command automatically.
        </p>
        <button
          type="button"
          className="secondary-button"
          disabled={recovery.busy || !recovery.identity}
          onClick={recovery.exportRequest}
        >
          Export original request
        </button>
        <label>
          Recovery text
          <textarea
            rows={6}
            maxLength={FINISH_RECOVERY_LIMIT}
            value={recovery.recoveryText}
            disabled={recovery.busy || !recovery.identity}
            onChange={(event) => recovery.setRecoveryText(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={recovery.busy || !recovery.identity || !recovery.recoveryText}
          onClick={recovery.importRequest}
        >
          Restore original request
        </button>
        {recovery.recoveryMessage && <p role="status">{recovery.recoveryMessage}</p>}
      </details>
    </>
  );
}
