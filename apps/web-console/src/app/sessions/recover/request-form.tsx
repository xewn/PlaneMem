'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { submitCheckpointSave } from '../checkpoint-actions';
import { submitStart } from '../actions';
import { parseStartFeedback } from '../start-model';
import { submitActivityCreate } from '../activity/create/actions';
import { parseActivityCreateFeedback } from '../../../lib/activity-create';
import { submitActivityFinish } from '../activity/finish-actions';
import {
  checkpointFields,
  checkpointLabels,
  parseCheckpointSaveFeedback,
} from '../checkpoint-model';
import { parseFinishFeedback } from '../activity/finish-model';
import {
  recoveryLabels,
  recoveryStorageKey,
  originalResourceId,
  originalSessionId,
  decodeOriginalSessionRequest,
  encodeOriginalSessionRequest,
  unknownOriginalFeedback,
  type OriginalSessionRequest,
  type OriginalSessionFeedback,
} from './model';

/** The loader fixes this request for the lifetime of this view; no current record is synthesized. */
export function OriginalSessionRequestForm({
  original,
  canWrite,
}: {
  original: OriginalSessionRequest;
  canWrite: boolean;
}) {
  const [feedback, setFeedback] = useState<OriginalSessionFeedback>(() =>
    unknownOriginalFeedback(original, 'Original request loaded. Its outcome is still unknown.'),
  );
  const [confirmation, setConfirmation] = useState<OriginalSessionRequest>();
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [localMessage, setLocalMessage] = useState('');
  const [exportText, setExportText] = useState('');
  const [intent, setIntent] = useState<'retry' | 'receipt'>('receipt');
  const [pending, transition] = useTransition();
  const active = useRef(false);
  const confirmed = confirmation === original && canWrite;
  const saved = feedback.value.status === 'done';
  const busy = !ready || pending;
  const storageKey = recoveryStorageKey(
    original.request.identity,
    original.operation,
    originalSessionId(original),
    originalResourceId(original),
  );
  const currentSessionId =
    originalSessionId(original) ??
    (feedback.kind === 'start' && feedback.value.status === 'done'
      ? feedback.value.receipt.session_id
      : undefined);

  function readStored() {
    const raw = sessionStorage.getItem(storageKey);
    if (raw === null) return;
    const prior = decodeOriginalSessionRequest(raw, original.operation, original.request.identity);
    if (encodeOriginalSessionRequest(prior) !== encodeOriginalSessionRequest(original))
      throw new TypeError('A different original request is saved for this record.');
  }
  function persist() {
    readStored();
    const raw = encodeOriginalSessionRequest(original);
    sessionStorage.setItem(storageKey, raw);
    if (sessionStorage.getItem(storageKey) !== raw)
      throw new Error('Recovery storage is unavailable.');
    setStorageError('');
  }
  useEffect(() => {
    try {
      readStored();
    } catch {
      setStorageError(
        'The saved request could not be matched or storage is unavailable. Retry writes are disabled; the loaded request can still be exported or checked.',
      );
    } finally {
      setReady(true);
    }
    // The loader never replaces an open original request. Identity changes remount the loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => setConfirmation(undefined), [original, canWrite]);

  function saveLocally() {
    if (busy || active.current) return;
    setConfirmation(undefined);
    try {
      persist();
      setLocalMessage('The original request is saved in this tab. No server request was sent.');
    } catch {
      setStorageError(
        'The original request could not be preserved in this tab. Conflicting or damaged saved data has not been replaced. Keep an exported copy.',
      );
    }
  }
  function exportOriginal() {
    if (busy || active.current) return;
    try {
      setExportText(encodeOriginalSessionRequest(original));
      setLocalMessage(
        'Copy this text before leaving the tab. It includes the original account identifiers and any checkpoint notes, without credentials.',
      );
    } catch {
      setLocalMessage('The original request could not be exported. No server request was sent.');
    }
  }
  function execute(lookup: boolean) {
    if (busy || active.current || saved || (!lookup && (!canWrite || !confirmed || !!storageError)))
      return;
    active.current = true;
    setConfirmation(undefined);
    try {
      persist();
    } catch {
      setStorageError(
        lookup
          ? 'The original request remains in this page for this receipt query. Recovery storage could not be updated; keep an exported copy.'
          : 'The original request could not be saved and read back. No retry was sent.',
      );
      if (!lookup) {
        active.current = false;
        return;
      }
    }
    setIntent(lookup ? 'receipt' : 'retry');
    setFeedback(
      unknownOriginalFeedback(
        original,
        lookup
          ? 'Checking the original receipt.'
          : 'The original retry result is not yet confirmed.',
      ),
    );
    transition(async () => {
      try {
        let next: OriginalSessionFeedback;
        if (original.operation === 'session.start') {
          next = {
            kind: 'start',
            value: parseStartFeedback(
              await submitStart(original.request, lookup ? 'receipt' : 'start', confirmed, true),
              original.request,
            ),
          };
        } else if (original.operation === 'run.start' || original.operation === 'tool.call') {
          next = {
            kind: 'activity',
            value: parseActivityCreateFeedback(
              await submitActivityCreate(
                original.request,
                lookup ? 'receipt' : 'create',
                confirmed,
                true,
              ),
              original.request,
            ),
          };
        } else if (original.operation === 'checkpoint.save') {
          next = {
            kind: 'checkpoint',
            value: parseCheckpointSaveFeedback(
              await submitCheckpointSave(
                original.request,
                lookup ? 'receipt' : 'save',
                confirmed,
                true,
              ),
              original.request,
            ),
          };
        } else {
          next = {
            kind: 'finish',
            value: parseFinishFeedback(
              await submitActivityFinish(
                original.request,
                lookup ? 'receipt' : 'finish',
                confirmed,
                true,
              ),
              original.request,
            ),
          };
        }
        if (next.value.status === 'error' && !next.value.uncertain) throw new TypeError();
        setFeedback(next);
      } catch {
        setFeedback(
          unknownOriginalFeedback(
            original,
            'The response did not confirm the original result. Keep this request and check its receipt; current record state cannot resolve it.',
          ),
        );
      } finally {
        active.current = false;
      }
    });
  }

  return (
    <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
      <h3>{recoveryLabels[original.operation]} · Original request</h3>
      <p>
        Current record details have not been read. This request is fixed in this view. Imported text
        stays in memory until you explicitly save it or request a receipt or retry.
      </p>
      <dl className="detail-grid" style={{ overflowWrap: 'anywhere' }}>
        {original.operation !== 'session.start' && (
          <>
            <div>
              <dt>Session</dt>
              <dd>{original.request.sessionId}</dd>
            </div>
            <div>
              <dt>Original session version</dt>
              <dd>{original.request.version}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Original request key</dt>
          <dd>{original.request.key}</dd>
        </div>
      </dl>
      {original.operation === 'session.start' ? (
        <>
          <p>
            Original parent session · {original.request.session.parent_session_id ?? 'Not supplied'}
          </p>
          <p>
            Original actor field ·{' '}
            {original.request.session.actor_id ??
              'Not supplied; uses the original verified account'}
          </p>
          <p>
            Original client field ·{' '}
            {original.request.session.client_id ??
              'Not supplied; uses the original verified client'}
          </p>
          <p>The new session ID is shown only after a matching start receipt is confirmed.</p>
        </>
      ) : original.operation === 'run.start' || original.operation === 'tool.call' ? (
        <>
          {original.request.operation === 'run.start' ? (
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              Original model · {original.request.model ?? 'Not supplied'}
            </p>
          ) : (
            <>
              <p>Original run · {original.request.runId}</p>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                Original tool name · {original.request.toolName}
              </p>
              <p>Original initial status · {original.request.status}</p>
            </>
          )}
          <p>This request records activity. It does not execute a model or tool.</p>
        </>
      ) : original.operation === 'checkpoint.save' ? (
        <>
          <p>Original context pack · {original.request.contextPackId ?? 'None'}</p>
          <p>These are the original note entries, including their whitespace and line breaks.</p>
          {checkpointFields.map((field) => (
            <details key={field}>
              <summary>
                {checkpointLabels[field]} · {original.request.notes[field].length} entries
              </summary>
              {original.request.notes[field].length ? (
                <ol>
                  {original.request.notes[field].map((note, index) => (
                    <li key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {note}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No entries.</p>
              )}
            </details>
          ))}
        </>
      ) : (
        <>
          <p>Original selected result · {original.request.outcome}</p>
          {original.request.operation !== 'end' && (
            <p style={{ overflowWrap: 'anywhere' }}>
              Original record · {original.request.resourceId} · Version{' '}
              {original.request.resourceVersion}
            </p>
          )}
          <p>
            Recording a result does not stop connected clients, runs or external tool processes.
          </p>
        </>
      )}
      {storageError && <p role="alert">{storageError}</p>}
      <div className="heading-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={saveLocally}>
          Save original request in this tab
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={exportOriginal}>
          Export original request
        </button>
      </div>
      {localMessage && <p role="status">{localMessage}</p>}
      {exportText && (
        <label>
          Original recovery text
          <textarea rows={6} readOnly value={exportText} spellCheck={false} />
        </label>
      )}
      {!canWrite && (
        <p>
          Session write permission is unavailable. You can retain or export this request and
          explicitly request its receipt; the server checks current access.
        </p>
      )}
      {!saved && (
        <form
          className="handoff-form"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
            if (action === 'retry' || action === 'receipt') execute(action === 'receipt');
          }}
        >
          <button className="secondary-button" type="submit" value="receipt" disabled={busy}>
            {pending && intent === 'receipt' ? 'Checking receipt…' : 'Check original receipt'}
          </button>
          <label className="confirmation-box">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || !canWrite || !!storageError}
              onChange={(event) => setConfirmation(event.target.checked ? original : undefined)}
            />
            Retry this exact original request using its original contents, key and any original
            versions.
          </label>
          <button
            className="primary-button"
            type="submit"
            value="retry"
            disabled={busy || !canWrite || !!storageError || !confirmed}
          >
            {pending && intent === 'retry' ? 'Retrying…' : 'Retry original request'}
          </button>
          <p>
            The result remains unknown until a matching receipt is confirmed. A missing receipt or a
            rejected retry does not establish failure of the earlier request.
          </p>
        </form>
      )}
      <div aria-live="polite">
        <p>{feedback.value.message}</p>
        {feedback.value.trace && <small>Trace · {feedback.value.trace}</small>}
        <OriginalReceipt feedback={feedback} />
      </div>
      {currentSessionId && (
        <Link
          className="panel-link"
          target="_blank"
          rel="noreferrer"
          prefetch={false}
          href={{ pathname: '/sessions/detail', query: { session: currentSessionId } }}
        >
          Read current session state in another tab
        </Link>
      )}
    </div>
  );
}

function OriginalReceipt({ feedback }: { feedback: OriginalSessionFeedback }) {
  if (feedback.kind === 'start' && feedback.value.status === 'done') {
    const receipt = feedback.value.receipt;
    return (
      <p>
        Recorded session · {receipt.session_id} · Started {receipt.started_at}. Read its current
        state separately.
      </p>
    );
  }
  if (feedback.kind === 'activity' && feedback.value.status === 'done') {
    const receipt = feedback.value.receipt;
    return (
      <p>
        <Link
          className="panel-link"
          target="_blank"
          rel="noreferrer"
          prefetch={false}
          href={
            receipt.operation === 'run.start'
              ? {
                  pathname: '/sessions/activity/run',
                  query: { session: receipt.session_id, run: receipt.run_id },
                }
              : {
                  pathname: '/sessions/activity/tool',
                  query: { session: receipt.session_id, tool: receipt.tool_call_id },
                }
          }
        >
          Read current {receipt.operation === 'run.start' ? 'run' : 'tool call'} record ·{' '}
          {receipt.operation === 'run.start' ? receipt.run_id : receipt.tool_call_id}
        </Link>
      </p>
    );
  }
  if (feedback.kind === 'checkpoint' && feedback.value.status === 'done') {
    const receipt = feedback.value.receipt;
    return (
      <p>
        <Link
          className="panel-link"
          target="_blank"
          rel="noreferrer"
          prefetch={false}
          href={{
            pathname: '/sessions/checkpoint',
            query: { session: receipt.session_id, checkpoint: receipt.checkpoint_id },
          }}
        >
          Read recorded checkpoint revision {receipt.revision}
        </Link>
      </p>
    );
  }
  if (feedback.kind === 'finish' && feedback.value.status === 'done') {
    const receipt = feedback.value.receipt;
    if (receipt.operation === 'end') return null;
    return (
      <p>
        <Link
          className="panel-link"
          target="_blank"
          rel="noreferrer"
          prefetch={false}
          href={
            receipt.operation === 'run.finish'
              ? {
                  pathname: '/sessions/activity/run',
                  query: { session: receipt.session_id, run: receipt.run_id },
                }
              : {
                  pathname: '/sessions/activity/tool',
                  query: { session: receipt.session_id, tool: receipt.tool_call_id },
                }
          }
        >
          Read current {receipt.operation === 'run.finish' ? 'run' : 'tool call'} record
        </Link>
      </p>
    );
  }
  return null;
}
