'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { preparePackSave } from './actions';
import { decodePackSaveOriginal, encodePackSaveOriginal } from './save-model';
import { PackSaveSubmission } from './save-submission';
import { backupOperation } from '../sync/receipt/backup-operation';

export function CompilePackForm({ initialKey, allowed }: { initialKey: string; allowed: boolean }) {
  const [requestKey, setRequestKey] = useState(initialKey);
  const [budget, setBudget] = useState('4096');
  const [ttl, setTtl] = useState('3600');
  const [original, setOriginal] = useState<string>();
  const [message, setMessage] = useState('Prepare the original request before saving a pack.');
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
    };
  }, []);
  if (original)
    return (
      <PackSaveSubmission
        original={decodePackSaveOriginal(original)}
        onNew={() => {
          setOriginal(undefined);
          setRequestKey('context-pack-' + crypto.randomUUID());
          setMessage(
            'A separate new request will be prepared. The previous browser copy is retained.',
          );
        }}
      />
    );
  return (
    <>
      <p>
        <Link href="/context/packs/recover" prefetch={false}>
          Recover an original save request
        </Link>
      </p>
      {!allowed ? (
        <p className="muted">An authorized client session is required to prepare a save.</p>
      ) : (
        <form
          className="handoff-form context-pack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (active.current) return;
            active.current = true;
            setBusy(true);
            const controller = new AbortController();
            operation.current = controller;
            const data = new FormData();
            data.set('key', requestKey);
            data.set('budget', budget);
            data.set('ttl', ttl);
            try {
              const result = await backupOperation(controller.signal, async (_signal, check) => {
                const result = await preparePackSave(data);
                check();
                return result;
              });
              if (!mounted.current || operation.current !== controller) return;
              if (result.status === 'prepared') {
                const prepared = decodePackSaveOriginal(result.original);
                if (
                  prepared.request_key !== requestKey ||
                  prepared.parameters.budget_tokens !== Number(budget) ||
                  prepared.parameters.ttl_seconds !== Number(ttl)
                )
                  throw new TypeError();
                setOriginal(encodePackSaveOriginal(prepared));
              } else setMessage(result.message);
            } catch {
              if (mounted.current)
                setMessage('Preparation could not be confirmed. No pack save was requested.');
            } finally {
              active.current = false;
              operation.current = undefined;
              if (mounted.current) setBusy(false);
            }
          }}
        >
          <p>Compile all available project context. List filters do not change the pack.</p>
          <label>
            Estimated content token budget
            <input
              type="number"
              min={128}
              max={32768}
              step={1}
              required
              value={budget}
              disabled={busy}
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
          <label>
            Maximum lifetime (seconds)
            <input
              type="number"
              min={60}
              max={86400}
              step={1}
              required
              value={ttl}
              disabled={busy}
              onChange={(event) => setTtl(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Preparing…' : 'Prepare original request'}
          </button>
          {busy && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => operation.current?.abort()}
            >
              Stop waiting
            </button>
          )}
          <p role="status">{message}</p>
        </form>
      )}
    </>
  );
}
