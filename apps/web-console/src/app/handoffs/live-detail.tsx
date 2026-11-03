'use client';

import { useRef, useState, useTransition } from 'react';
import { Panel } from '../../components/ui';
import { HandoffDetail } from './detail';
import { refreshHandoffDetail } from './detail-actions';
import {
  parseHandoffRefresh,
  type HandoffSnapshot,
  type HandoffDetailControls,
} from './detail-model';

export function LiveHandoffDetail({ initial }: { initial: HandoffSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [identity] = useState(initial.session_identity);
  const [fresh, setFresh] = useState(true);
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<'idle' | 'refresh' | 'operation'>('idle');
  const [reviewRevision, setReviewRevision] = useState(0);
  const [pending, transition] = useTransition();
  const active = useRef(false);
  const handoff = snapshot.data;

  function acquire(next: 'refresh' | 'operation'): boolean {
    if (active.current) return false;
    active.current = true;
    setPhase(next);
    // An earlier checked confirmation never authorizes an action after a new read/operation.
    setReviewRevision((value) => value + 1);
    return true;
  }
  function release(writeAttempted: boolean) {
    if (writeAttempted) {
      setFresh(false);
      setMessage(
        'An operation was sent. Read current state before another write; its original receipt result remains in the form.',
      );
    }
    active.current = false;
    setPhase('idle');
  }
  function refresh() {
    if (!acquire('refresh')) return;
    setFresh(false);
    setMessage('Reading current ownership and access. Original requests remain in their forms.');
    transition(async () => {
      try {
        const result = parseHandoffRefresh(
          await refreshHandoffDetail(handoff.handoff_id, identity),
          snapshot,
        );
        if (result.status === 'error') {
          setMessage(result.message + (result.trace ? ` Trace · ${result.trace}` : ''));
          return;
        }
        setSnapshot(result.snapshot);
        setFresh(true);
        setMessage(
          'Current state refreshed. Review it and confirm again before an action. Original versions, keys and receipt outcomes are retained.',
        );
      } catch {
        setMessage(
          'The current state could not be confirmed. Last-read details and original requests are retained; query receipts or try reading again.',
        );
      } finally {
        release(false);
      }
    });
  }
  const controls: HandoffDetailControls = {
    busy: phase !== 'idle' || pending,
    writeReady: fresh,
    reviewRevision,
    acquire: () => acquire('operation'),
    release,
  };
  return (
    <>
      <Panel title={fresh ? 'Current handoff' : 'Last-read handoff'} icon="handoffs">
        <div className="side-detail">
          <p>
            This snapshot does not confirm an original creation, claim or resume request. Keep
            unresolved original requests and query their receipts.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={controls.busy}
            onClick={refresh}
          >
            {phase === 'refresh' ? 'Reading current state…' : 'Refresh current handoff state'}
          </button>
          {message && <p role="status">{message}</p>}
          {!fresh && (
            <p>
              Write controls are paused until a successful current read. Original request queries
              and exports remain available when this page is idle.
            </p>
          )}
        </div>
        <HandoffDetail
          handoff={{
            ...handoff,
            origin: 'session',
            offered_to: handoff.target_client,
            recipient_matches:
              !!identity &&
              (!handoff.target_client || handoff.target_client === identity.client_id),
            claimed_here:
              !!identity &&
              handoff.claimed_by === identity.client_id &&
              handoff.claimed_by_actor === identity.actor_id,
          }}
          identity={identity}
          canWrite={snapshot.handoff_permissions.write_sessions}
          canClaim={snapshot.handoff_permissions.claim}
          canResume={snapshot.handoff_permissions.write_sessions}
          controls={controls}
        />
      </Panel>
      <Panel title="Recorded sources" icon="database">
        <div className="side-detail">
          <p>Reference availability and context validity were not checked by this read.</p>
          <ul>
            {handoff.source_refs.map((source, index) => (
              <li key={index} style={{ overflowWrap: 'anywhere' }}>
                <code>
                  {source.type}: {source.id}
                </code>
                {source.revision !== undefined && <> · revision {source.revision}</>}
                {source.uri && <p>{source.uri}</p>}
              </li>
            ))}
          </ul>
          <p style={{ overflowWrap: 'anywhere' }}>Record trace · {handoff.trace_id}</p>
          <p style={{ overflowWrap: 'anywhere' }}>
            Last successful read trace · {snapshot.trace_id}
          </p>
        </div>
      </Panel>
    </>
  );
}
