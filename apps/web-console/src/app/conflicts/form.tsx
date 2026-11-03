'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  parseConflictReceiptQuery,
  type ConflictCommandIdentity,
  type ConflictReceiptQuery,
} from '@planemem/contracts';
import { OriginalConflictRequest } from './original-request';
import { conflictOriginalStorageKey } from './original-model';
import {
  loadConflictOriginal,
  prepareBrowserConflictOriginal,
  type ConflictOriginalSelection,
} from './original-store';
import { CONFLICT_RECEIPT_REQUEST_BYTES } from './receipt/model';

export function ResolutionForm({
  id,
  version,
  open,
  identity,
}: {
  id: string;
  version: number;
  open: boolean;
  identity: ConflictCommandIdentity;
}) {
  const [original, setOriginal] = useState<ConflictReceiptQuery>();
  const [prepared, setPrepared] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [choice, setChoice] = useState('');
  const [merged, setMerged] = useState('');
  const [reviewed, setReviewed] = useState(version);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readAttempt, setReadAttempt] = useState(0);
  const frozen = useRef(false);
  const active = useRef(false);
  const mounted = useRef(false);
  const storageKey = conflictOriginalStorageKey(identity, id);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (frozen.current || active.current) return;
    let canceled = false;
    setReady(false);
    setLoading(true);
    setMessage('');
    void loadConflictOriginal(identity, id)
      .then((saved) => {
        if (canceled || frozen.current || active.current) return;
        if (saved) {
          frozen.current = true;
          setOriginal(saved);
        }
        setReady(true);
      })
      .catch(() => {
        if (canceled || frozen.current || active.current) return;
        setMessage(
          'Saved originals could not be read, or the browser and this tab contain different copies. Keep existing data and use recovery to inspect each copy or import an exported file. No new request was prepared.',
        );
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [storageKey, identity, id, readAttempt]);

  async function prepare() {
    if (active.current || frozen.current || !ready || !open || !confirmed || reviewed !== version)
      return;
    active.current = true;
    setBusy(true);
    setMessage('');
    const retained: { selection?: ConflictOriginalSelection } = {};
    try {
      if (!['local', 'server', 'merge'].includes(choice)) throw new TypeError();
      if (new TextEncoder().encode(merged).byteLength > CONFLICT_RECEIPT_REQUEST_BYTES)
        throw new TypeError();
      const value = choice === 'merge' ? JSON.parse(merged) : undefined;
      const selected = await prepareBrowserConflictOriginal(
        identity,
        id,
        () => {
          if (!mounted.current) throw new TypeError();
          return parseConflictReceiptQuery({
            identity,
            request_key: crypto.randomUUID(),
            command: {
              conflict_id: id,
              expected_version: reviewed,
              resolution: choice,
              ...(choice === 'merge' ? { merged_value: value } : {}),
            },
          });
        },
        (selection) => {
          retained.selection = selection;
          frozen.current = true;
        },
      );
      if (mounted.current) {
        setOriginal(selected.original);
        setPrepared(selected.created);
        setMessage(
          selected.created
            ? 'The complete original request is saved in this browser. Review it before sending.'
            : 'An existing original was recovered unchanged. Check its receipt before deciding whether to resend it.',
        );
      }
    } catch {
      if (mounted.current) {
        if (retained.selection) {
          setOriginal(retained.selection.original);
          setPrepared(retained.selection.created);
          setMessage(
            'The original is frozen but its local save could not be confirmed. Keep this page open and export it, or retry saving. No decision was sent.',
          );
        } else {
          setMessage(
            'The request could not be prepared. Check saved originals again and use valid JSON within the 1 MB limit. Existing requests were not replaced and no decision was sent.',
          );
        }
      }
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (original)
    return (
      <>
        {message && <p role="status">{message}</p>}
        <OriginalConflictRequest original={original} prepared={prepared} />
      </>
    );
  return (
    <div className="side-detail" aria-busy={busy || loading}>
      <p>
        Account · {identity.actor_id} · Client · {identity.client_id} · Project ·{' '}
        {identity.project_id}
      </p>
      <p>
        Prepare freezes one request and saves it in this browser before sending. It can be loaded
        after reopening a tab in the same browser profile. Keep an exported copy too; clearing
        browser data can remove local requests. An existing original is recovered unchanged.
      </p>
      {open && (
        <form
          className="handoff-form checkpoint-form"
          onSubmit={(event) => {
            event.preventDefault();
            void prepare();
          }}
        >
          <label>
            Resolution
            <select
              required
              disabled={!ready || busy}
              value={choice}
              onChange={(event) => {
                setChoice(event.target.value);
                setConfirmed(false);
              }}
            >
              <option value="">Choose a resolution</option>
              <option value="server">Keep server value</option>
              <option value="local">Keep local value</option>
              <option value="merge">Use a merged value</option>
            </select>
          </label>
          {choice === 'merge' && (
            <label>
              Merged value (JSON)
              <textarea
                required
                rows={5}
                spellCheck={false}
                maxLength={CONFLICT_RECEIPT_REQUEST_BYTES}
                disabled={!ready || busy}
                value={merged}
                onChange={(event) => {
                  setMerged(event.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
          )}
          <p className="muted">
            Decision values use JavaScript JSON number precision. Large integer values may be
            rounded when submitted; the detail text alone does not make writes arbitrary precision.
          </p>
          {reviewed !== version ? (
            <div>
              <p>
                The conflict is now version {version}. Review the values again before preparing.
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setReviewed(version);
                  setConfirmed(false);
                }}
              >
                I reviewed version {version}
              </button>
            </div>
          ) : (
            <label className="confirmation-box">
              <input
                type="checkbox"
                required
                disabled={!ready || busy || !choice}
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I reviewed this decision for conflict version {reviewed}.
            </label>
          )}
          <button
            className="primary-button"
            disabled={!ready || busy || !choice || !confirmed || reviewed !== version}
          >
            Prepare and save original request
          </button>
        </form>
      )}
      {!open && (
        <p>
          This conflict already has a decision. Recover its saved original request to confirm a
          prior submission.
        </p>
      )}
      {message && <p role="alert">{message}</p>}
      {loading && <p role="status">Checking saved originals in this browser…</p>}
      <button
        type="button"
        className="secondary-button"
        disabled={busy || loading}
        onClick={() => {
          setReady(false);
          setReadAttempt((attempt) => attempt + 1);
        }}
      >
        Check saved originals again
      </button>
      <Link href="/conflicts/recover" prefetch={false}>
        Recover a saved original conflict request
      </Link>
    </div>
  );
}
