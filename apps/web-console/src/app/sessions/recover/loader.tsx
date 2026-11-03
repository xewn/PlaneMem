'use client';

import { useState } from 'react';
import { isUlid, type SessionCommandIdentity } from '@planemem/contracts';
import { OriginalSessionRequestForm } from './request-form';
import {
  recoveryLabels,
  recoveryLimit,
  recoveryStorageKey,
  originalResourceId,
  originalSessionId,
  decodeOriginalSessionRequest,
  type RecoveryOperation,
  type OriginalSessionRequest,
} from './model';

export function SessionRecoveryLoader({
  identity,
  canWrite,
}: {
  identity: SessionCommandIdentity;
  canWrite: boolean;
}) {
  const [operation, setOperation] = useState<RecoveryOperation>('checkpoint.save');
  const [sessionId, setSessionId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [original, setOriginal] = useState<OriginalSessionRequest>();
  const needsSession = operation !== 'session.start';
  const needsResource =
    operation === 'run.finish' || operation === 'tool.finish' || operation === 'tool.call';

  function loadStored() {
    if (original) return;
    try {
      if ((needsSession && !isUlid(sessionId)) || (needsResource && !isUlid(resourceId)))
        throw new TypeError('Enter the original session and, where required, run or tool call ID.');
      const session = needsSession ? sessionId : undefined;
      const resource = needsResource
        ? resourceId
        : operation === 'checkpoint.save' || operation === 'end'
          ? sessionId
          : undefined;
      const raw = sessionStorage.getItem(
        recoveryStorageKey(identity, operation, session, resource),
      );
      if (raw === null)
        throw new TypeError(
          'No original request is saved for this operation, identity and selected record in this tab. Import an exported copy if available. Missing local data does not establish the operation result.',
        );
      const request = decodeOriginalSessionRequest(raw, operation, identity);
      if (originalSessionId(request) !== session || originalResourceId(request) !== resource)
        throw new TypeError('The stored request does not match the selected original record.');
      setOriginal(request);
      setText('');
      setError('');
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? cause.message
          : 'The saved request could not be read or decoded. You can import an exported copy. Existing data has not been changed.',
      );
    }
  }
  function importOriginal() {
    if (original) return;
    try {
      setOriginal(decodeOriginalSessionRequest(text, operation, identity));
      setText('');
      setError('');
    } catch {
      setError(
        'Use supported recovery text for the selected operation and original account, client and project. Nothing was submitted or replaced.',
      );
    }
  }

  if (original) return <OriginalSessionRequestForm original={original} canWrite={canWrite} />;
  return (
    <div className="side-detail">
      <label>
        Original operation
        <select
          value={operation}
          onChange={(event) => {
            const next = event.target.value;
            if (!Object.prototype.hasOwnProperty.call(recoveryLabels, next)) return;
            setOperation(next as RecoveryOperation);
            setError('');
          }}
        >
          {Object.entries(recoveryLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p>
        Load one original request from this tab, or paste an exported copy below. Loading only reads
        local data. It does not request current records, receipts or retries.
      </p>
      <form
        className="handoff-form"
        onSubmit={(event) => {
          event.preventDefault();
          loadStored();
        }}
      >
        {needsSession ? (
          <label>
            Original session ID
            <input
              required
              minLength={26}
              maxLength={26}
              pattern="[0-9A-HJKMNP-TV-Z]{26}"
              spellCheck={false}
              autoCapitalize="characters"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
            />
          </label>
        ) : (
          <p>
            A session start is saved under the original identity. No new session ID is needed to
            recover it.
          </p>
        )}
        {needsResource && (
          <label>
            {operation === 'tool.finish' ? 'Original tool call ID' : 'Original run ID'}
            <input
              required
              minLength={26}
              maxLength={26}
              pattern="[0-9A-HJKMNP-TV-Z]{26}"
              spellCheck={false}
              autoCapitalize="characters"
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
            />
          </label>
        )}
        <button className="secondary-button" type="submit">
          Load original request from this tab
        </button>
      </form>
      <label>
        Exported original recovery text
        <textarea
          rows={6}
          maxLength={recoveryLimit(operation)}
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <p className="muted">
        Recovery text may include checkpoint notes and account identifiers. It must keep its
        original format, versions and request key. The selected format allows up to{' '}
        {recoveryLimit(operation)} characters.
      </p>
      <button
        className="secondary-button"
        type="button"
        disabled={!text || text.length > recoveryLimit(operation)}
        onClick={importOriginal}
      >
        Load exported original request
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
