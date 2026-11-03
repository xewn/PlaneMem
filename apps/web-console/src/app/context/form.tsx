'use client';

import { useActionState, useState } from 'react';
import { compilePack, type PackFeedback } from './actions';

const idle: PackFeedback = { status: 'idle' };

export function CompilePackForm({ initialKey, allowed }: { initialKey: string; allowed: boolean }) {
  const [state, submit, pending] = useActionState(compilePack, idle);
  const [baseKey] = useState(initialKey);
  const [revision, setRevision] = useState(0);
  const [budget, setBudget] = useState('4096');
  const [ttl, setTtl] = useState('3600');
  const key = baseKey + '-' + revision;
  const current = state.key === key;
  const uncertain = current && state.uncertain === true;
  const unusable = current && state.unusable === true;
  const locked = pending || uncertain || unusable;
  if (!allowed)
    return (
      <p className="muted">An authorized client session is required to compile a context pack.</p>
    );
  return (
    <form action={submit} className="handoff-form context-pack-form">
      <p>Compile all available project context. List filters do not change the pack.</p>
      <input type="hidden" name="key" value={key} />
      <label>
        Estimated content token budget
        <input
          type="number"
          name="budget"
          min={128}
          max={32768}
          step={1}
          required
          value={budget}
          readOnly={locked}
          onChange={(event) => {
            if (locked) return;
            setBudget(event.target.value);
            setRevision((value) => value + 1);
          }}
        />
      </label>
      <label>
        Maximum lifetime (seconds)
        <input
          type="number"
          name="ttl"
          min={60}
          max={86400}
          step={1}
          required
          value={ttl}
          readOnly={locked}
          onChange={(event) => {
            if (locked) return;
            setTtl(event.target.value);
            setRevision((value) => value + 1);
          }}
        />
      </label>
      <button className="primary-button" disabled={pending || unusable}>
        {pending ? 'Compiling…' : uncertain ? 'Retry compile' : 'Compile ContextPack'}
      </button>
      {current && state.message && (
        <div role="status">
          <p>{state.message}</p>
          {state.trace && <small>Trace · {state.trace}</small>}
        </div>
      )}
      {uncertain && (
        <p role="status">
          The save result is unknown. Keep this page open and retry the original budget, lifetime
          and request key. Later sign-in or permission errors do not establish whether it was saved.
        </p>
      )}
      {current && state.status === 'error' && !uncertain && (
        <button
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={() => setRevision((value) => value + 1)}
        >
          {unusable ? 'Prepare a fresh pack request' : 'Start a new request'}
        </button>
      )}
    </form>
  );
}
