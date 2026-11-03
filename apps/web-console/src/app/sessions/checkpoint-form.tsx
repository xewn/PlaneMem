'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  parseSessionClosureState,
  parseSessionCommandIdentity,
  type SessionClosureState,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import type { CheckpointNotes } from '../../lib/server-api';
import { refreshSessionEnd } from './end-actions';
import { submitCheckpointSave } from './checkpoint-actions';
import {
  checkpointLabels,
  checkpointFields,
  CHECKPOINT_FIELD_LIMIT,
  CHECKPOINT_RECOVERY_LIMIT,
  checkpointRecoveryStorageKey,
  parseCheckpointSaveRequest,
  parseCheckpointSaveFeedback,
  sameCheckpointSave,
  encodeCheckpointRecovery,
  decodeCheckpointRecovery,
  type CheckpointSaveRequest,
  type CheckpointSaveFeedback,
} from './checkpoint-model';

type NoteDraft = Record<keyof CheckpointNotes, string>;
const emptyNotes = (): NoteDraft => ({
  completed: '',
  in_progress: '',
  next_actions: '',
  decisions: '',
  risks: '',
  open_questions: '',
});

export function CheckpointForm({
  initial,
  identity: initialIdentity,
  canWrite: initialCanWrite,
  initialKey,
}: {
  initial: SessionClosureState;
  identity?: SessionCommandIdentity;
  canWrite: boolean;
  initialKey: string;
}) {
  const [identity] = useState(initialIdentity);
  const [detail, setDetail] = useState(initial);
  const [canWrite, setCanWrite] = useState(initialCanWrite && !!identity);
  const [key, setKey] = useState(initialKey);
  const [baseVersion, setBaseVersion] = useState(initial.version);
  const [draft, setDraft] = useState<NoteDraft>(emptyNotes);
  const [packId, setPackId] = useState('');
  const [state, setState] = useState<CheckpointSaveFeedback>({ status: 'idle' });
  const [confirmed, setConfirmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [readMessage, setReadMessage] = useState('');
  const [recoveryText, setRecoveryText] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [refreshedAfterAttempt, setRefreshedAfterAttempt] = useState(false);
  const [intent, setIntent] = useState<'save' | 'receipt' | 'refresh'>('save');
  const [pending, transition] = useTransition();
  const active = useRef(false);
  const storageKey = checkpointRecoveryStorageKey(identity, initial.session_id);
  const saved = state.status === 'done';
  const uncertain = state.status === 'error' && state.uncertain;
  const live = ['running', 'paused'].includes(detail.status);
  const changed = baseVersion !== detail.version;
  const hasUnsentNotes =
    state.status === 'idle' && (Boolean(packId) || Object.values(draft).some(Boolean));
  const busy = pending || !ready;
  const locked = busy || !canWrite || !identity || blocked || !!storageError || uncertain || saved;

  function bound(value: unknown) {
    const request = parseCheckpointSaveRequest(value);
    if (
      !identity ||
      request.sessionId !== initial.session_id ||
      JSON.stringify(request.identity) !== JSON.stringify(parseSessionCommandIdentity(identity))
    )
      throw new TypeError(
        'This checkpoint request belongs to another session, project or account.',
      );
    return request;
  }
  function readStored() {
    const raw = sessionStorage.getItem(storageKey);
    return raw === null ? undefined : bound(decodeCheckpointRecovery(raw));
  }
  function persist(request: CheckpointSaveRequest) {
    const prior = readStored();
    if (prior && !sameCheckpointSave(prior, request))
      throw new TypeError('Another original request is already saved.');
    const raw = encodeCheckpointRecovery(request);
    sessionStorage.setItem(storageKey, raw);
    if (sessionStorage.getItem(storageKey) !== raw)
      throw new Error('Recovery storage is unavailable');
    setStorageError('');
  }
  function restore(request: CheckpointSaveRequest) {
    const next = emptyNotes();
    for (const field of checkpointFields) next[field] = request.notes[field].join('\n');
    setDraft(next);
    setPackId(request.contextPackId ?? '');
    setKey(request.key);
    setBaseVersion(request.version);
    setConfirmed(false);
    setRefreshedAfterAttempt(false);
    setState({
      status: 'error',
      request,
      uncertain: true,
      message:
        'Original checkpoint request recovered. Check its receipt; its outcome has not been confirmed in this page.',
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
      setBlocked(true);
      setStorageError(
        'The saved checkpoint request could not be read. New writes are disabled to protect its recovery information.',
      );
    } finally {
      setReady(true);
    }
    // The parent is keyed by the verified identity and selected session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function execute(lookup: boolean) {
    if (
      !ready ||
      active.current ||
      !identity ||
      !canWrite ||
      blocked ||
      saved ||
      (lookup && state.status === 'idle') ||
      (!lookup && (!confirmed || storageError || (!uncertain && (!live || changed))))
    )
      return;
    let request: CheckpointSaveRequest;
    try {
      if (state.status !== 'idle') request = bound(state.request);
      else {
        const notes = {} as CheckpointNotes;
        for (const field of checkpointFields)
          notes[field] = draft[field]
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        request = bound({
          identity,
          key,
          sessionId: initial.session_id,
          version: baseVersion,
          notes,
          ...(packId.trim() ? { contextPackId: packId.trim() } : {}),
        });
      }
    } catch (error) {
      setReadMessage(
        error instanceof Error
          ? error.message
          : 'Review the original checkpoint notes and version.',
      );
      return;
    }
    const wasUncertain = uncertain;
    const before: Exclude<CheckpointSaveFeedback, { status: 'idle' | 'done' }> = {
      status: 'error',
      request,
      uncertain: wasUncertain || !lookup,
      message: lookup
        ? 'Checking the original save receipt.'
        : 'The save result is not yet confirmed. Keep the original request.',
    };
    try {
      persist(request);
    } catch {
      setStorageError(
        lookup
          ? 'Recovery storage is unavailable. This receipt query retains the original request in the open page.'
          : 'The original checkpoint request could not be saved. No write was sent.',
      );
      if (!lookup) return;
    }
    active.current = true;
    setState(before);
    setIntent(lookup ? 'receipt' : 'save');
    setRefreshedAfterAttempt(false);
    transition(async () => {
      try {
        const next = parseCheckpointSaveFeedback(
          await submitCheckpointSave(request, lookup ? 'receipt' : 'save', confirmed, wasUncertain),
          request,
        );
        if (wasUncertain && next.status === 'error' && !next.uncertain) throw new TypeError();
        setState(next);
      } catch {
        setState({
          ...before,
          message:
            'The response did not confirm this save. Keep the original notes and check the original receipt.',
        });
      } finally {
        active.current = false;
      }
    });
  }
  function clearOriginal(): boolean {
    try {
      const stored = readStored();
      if (stored && (state.status === 'idle' || !sameCheckpointSave(stored, state.request)))
        throw new Error();
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error();
      return true;
    } catch {
      setStorageError(
        'The previous recovery request could not be cleared. No new request was prepared.',
      );
      return false;
    }
  }
  function edit(change: () => void) {
    if (active.current || locked || !live || !clearOriginal()) return;
    change();
    setState({ status: 'idle' });
    setKey(crypto.randomUUID());
    setConfirmed(false);
    setRecoveryText('');
    setRecoveryMessage('');
  }
  function prepareAnother() {
    if (
      !ready ||
      active.current ||
      !saved ||
      !canWrite ||
      !identity ||
      !live ||
      blocked ||
      storageError ||
      !refreshedAfterAttempt ||
      (state.status !== 'idle' && detail.version < state.request.version) ||
      !clearOriginal()
    )
      return;
    setState({ status: 'idle' });
    setKey(crypto.randomUUID());
    setBaseVersion(detail.version);
    setDraft(emptyNotes());
    setPackId('');
    setConfirmed(false);
    setRecoveryText('');
    setRecoveryMessage('');
    setRefreshedAfterAttempt(false);
  }
  function clearUnsentNotes() {
    if (!ready || active.current || state.status !== 'idle' || !clearOriginal()) return;
    setDraft(emptyNotes());
    setPackId('');
    setKey(crypto.randomUUID());
    setConfirmed(false);
  }
  function refresh() {
    if (!ready || active.current) return;
    active.current = true;
    setIntent('refresh');
    setRefreshedAfterAttempt(false);
    transition(async () => {
      try {
        const result = await refreshSessionEnd(initial.session_id, identity);
        if (result.status === 'error') {
          setReadMessage(result.message + (result.trace ? ` Trace · ${result.trace}` : ''));
          return;
        }
        if (typeof result.canWrite !== 'boolean') throw new TypeError();
        setDetail(parseSessionClosureState(result.state, initial.session_id));
        setCanWrite(result.canWrite && !!identity);
        setRefreshedAfterAttempt(true);
        setReadMessage(
          'Current session state refreshed here. The original checkpoint request and the rest of this page are unchanged.',
        );
      } catch {
        setReadMessage(
          'Current session state could not be confirmed. The original checkpoint request is retained.',
        );
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
      } else persist(state.request);
      setStorageError('');
      setBlocked(false);
      setRecoveryMessage('Recovery storage is available. No save request was sent.');
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
          : encodeCheckpointRecovery(state.request);
      if (!raw || raw.length > CHECKPOINT_RECOVERY_LIMIT) throw new Error();
      setRecoveryText(raw);
      setRecoveryMessage(
        'Copy this text before closing the tab. It contains the original checkpoint notes and account identifiers.',
      );
    } catch {
      setRecoveryMessage(
        'No bounded original request is available to export. Unsaved edits remain in this page.',
      );
    }
  }
  function importRequest() {
    if (!ready || active.current || !identity) return;
    try {
      const request = bound(decodeCheckpointRecovery(recoveryText));
      if (state.status !== 'idle' && !sameCheckpointSave(state.request, request)) throw new Error();
      if (state.status === 'idle' && (packId || Object.values(draft).some(Boolean)))
        throw new Error(
          'Copy your unsent edits and clear them before restoring an original request.',
        );
      persist(request);
      restore(request);
      setBlocked(false);
      setRecoveryMessage(
        'Original checkpoint request restored. Check its receipt or confirm before retrying. No command was submitted.',
      );
    } catch (error) {
      setRecoveryMessage(
        error instanceof Error
          ? error.message
          : 'Recovery text could not be restored. Existing information has not been changed.',
      );
    }
  }

  if (!identity) return null;
  return (
    <details>
      <summary>
        {saved
          ? 'Checkpoint save confirmed'
          : live
            ? 'Write a checkpoint'
            : 'Recover an earlier checkpoint save'}
      </summary>
      <p>
        Last read session: {detail.status} · Version {detail.version}
      </p>
      <button type="button" className="secondary-button" disabled={busy} onClick={refresh}>
        {pending && intent === 'refresh' ? 'Reading session…' : 'Refresh current session state'}
      </button>
      {readMessage && <p role="status">{readMessage}</p>}
      {storageError && (
        <>
          <p role="alert">{storageError}</p>
          <button type="button" className="secondary-button" disabled={busy} onClick={retryStorage}>
            Retry recovery storage
          </button>
        </>
      )}
      <details>
        <summary>Recover an original checkpoint request</summary>
        <p>
          Submitted requests are retained in this tab across reloads. Export before closing the tab.
          Recovery text includes your notes; it does not include credentials. Unsent edits are kept
          only in this page.
        </p>
        <button type="button" className="secondary-button" disabled={busy} onClick={exportRequest}>
          Export original request
        </button>
        <label>
          Recovery text
          <textarea
            rows={6}
            maxLength={CHECKPOINT_RECOVERY_LIMIT}
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
        {recoveryMessage && <p role="status">{recoveryMessage}</p>}
      </details>
      {!canWrite && (
        <p>Session write permission is unavailable. Your original request remains here.</p>
      )}
      {!live && (
        <p>The session has closed. Its original checkpoint request can still be checked.</p>
      )}
      {(state.status !== 'idle' || hasUnsentNotes || (canWrite && live)) && (
        <form
          className="handoff-form checkpoint-form"
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
              <p>
                Record work to carry into the next session. Enter one item per line. Each category
                allows up to 200 items and 16384 characters.
              </p>
              {checkpointFields.map((name) => (
                <label key={name}>
                  {checkpointLabels[name]}
                  <textarea
                    rows={2}
                    maxLength={CHECKPOINT_FIELD_LIMIT}
                    readOnly={locked || !live}
                    value={draft[name]}
                    onChange={(event) =>
                      edit(() => setDraft({ ...draft, [name]: event.target.value }))
                    }
                  />
                </label>
              ))}
              <label>
                Saved context pack ID (optional)
                <input
                  maxLength={26}
                  value={packId}
                  readOnly={locked || !live}
                  onChange={(event) => edit(() => setPackId(event.target.value))}
                />
                <small>
                  The saved pack and its sources are checked again when this checkpoint is resumed.
                </small>
              </label>
              <Link className="panel-link" href="/context" target="_blank" rel="noreferrer">
                Review saved context packs
              </Link>
              {hasUnsentNotes && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || blocked || !!storageError}
                  onClick={clearUnsentNotes}
                >
                  Clear unsent notes and pack selection
                </button>
              )}
              <small>Original request session version {baseVersion}</small>
              <label className="confirmation-box">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={
                    busy ||
                    !canWrite ||
                    blocked ||
                    !!storageError ||
                    (!uncertain && (!live || changed))
                  }
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Save these notes with this context pack selection.
              </label>
              {uncertain && (
                <p role="status">
                  The save result is unknown. Keep the original notes, pack, version and key.
                  Refreshing session state does not resolve this save.
                </p>
              )}
              {changed && (
                <div>
                  <p>
                    The session changed from version {baseVersion} to {detail.version}. Review the
                    current state before preparing a new request.
                  </p>
                  {live && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={locked}
                      onClick={() => edit(() => setBaseVersion(detail.version))}
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
                  value="save"
                  disabled={
                    busy ||
                    !canWrite ||
                    blocked ||
                    !!storageError ||
                    !confirmed ||
                    (!uncertain && changed)
                  }
                >
                  {pending && intent === 'save'
                    ? 'Saving…'
                    : state.status === 'error'
                      ? 'Retry original save'
                      : 'Save checkpoint'}
                </button>
              )}
              {state.status === 'error' && (
                <button
                  className="secondary-button"
                  name="intent"
                  value="receipt"
                  formNoValidate
                  disabled={busy || !canWrite || blocked}
                >
                  {pending && intent === 'receipt'
                    ? 'Checking receipt…'
                    : 'Check whether this checkpoint was saved'}
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
          {state.status === 'done' && (
            <>
              <Link
                className="panel-link"
                target="_blank"
                rel="noreferrer"
                href={{
                  pathname: '/sessions/checkpoint',
                  query: {
                    session: state.receipt.session_id,
                    checkpoint: state.receipt.checkpoint_id,
                  },
                }}
              >
                Read saved checkpoint ↗
              </Link>
              <Link
                className="panel-link"
                href={{
                  pathname: '/handoffs/create',
                  query: {
                    session: state.receipt.session_id,
                    checkpoint: state.receipt.checkpoint_id,
                  },
                }}
                target="_blank"
                rel="noreferrer"
              >
                Hand off this checkpoint
              </Link>
              {live && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={
                    busy || !canWrite || blocked || !!storageError || !refreshedAfterAttempt
                  }
                  onClick={prepareAnother}
                >
                  Write another checkpoint
                </button>
              )}
              {!refreshedAfterAttempt && (
                <p>Refresh the current session state before preparing another checkpoint.</p>
              )}
            </>
          )}
        </form>
      )}
    </details>
  );
}
