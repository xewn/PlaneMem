'use client';

import Link from 'next/link';
import type { SessionCommandIdentity } from '@planemem/contracts';
import { textValue, toneFor } from '../../components/record-format';
import { Badge } from '../../components/ui';
import { ClaimForm } from './claim-form';
import { ResumeForm } from './resume-form';
import type { HandoffDetailControls } from './detail-model';

type Row = Record<string, unknown>;

export function HandoffDetail({
  handoff,
  canWrite,
  canClaim,
  identity,
  canResume,
  controls,
}: {
  handoff: Row;
  canWrite: boolean;
  canClaim: boolean;
  identity?: SessionCommandIdentity;
  canResume: boolean;
  controls?: HandoffDetailControls;
}) {
  return (
    <div className="side-detail">
      <div className="drawer-badges">
        <Badge tone={toneFor(handoff.status)}>{textValue(handoff.status)}</Badge>
        <Badge tone="cyan">to {textValue(handoff.offered_to, 'any client')}</Badge>
      </div>
      <h2>{typeof handoff.summary === 'string' ? 'Checkpoint summary' : 'Handoff details'}</h2>
      {typeof handoff.summary === 'string' && <p>{handoff.summary}</p>}
      {handoff.summary_state === 'too-large' && (
        <p className="muted">
          The summary exceeds the directory limit and was omitted. Open the original checkpoint,
          when available, to review its contents.
        </p>
      )}
      {handoff.summary_state === 'missing' && (
        <p className="muted">No summary was recorded in this directory entry.</p>
      )}
      <div className="detail-grid">
        {[
          ['Handoff', handoff.handoff_id],
          ['Session', handoff.session_id],
          ['Checkpoint', handoff.checkpoint_id],
          [
            'Version',
            handoff.version === undefined || handoff.version === null
              ? undefined
              : String(handoff.version),
          ],
          ['From client', handoff.from_client],
          ['Created', handoff.created_at],
          ['Updated', handoff.updated_at],
          ['Claimed by client', handoff.claimed_by],
          ['Claimed by actor', handoff.claimed_by_actor],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <small>{String(label)}</small>
            <strong style={{ overflowWrap: 'anywhere' }}>{textValue(value)}</strong>
          </div>
        ))}
      </div>
      <hr />
      {handoff.origin === 'session' ? (
        <>
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{
              pathname: '/sessions/checkpoint',
              query: {
                session: String(handoff.session_id),
                checkpoint: String(handoff.checkpoint_id),
              },
            }}
          >
            Read original checkpoint ↗
          </Link>
          <ClaimForm
            id={String(handoff.handoff_id)}
            session={String(handoff.session_id)}
            checkpoint={String(handoff.checkpoint_id)}
            identity={identity}
            canClaim={canClaim}
            version={Number(handoff.version)}
            eligible={handoff.status === 'open' && handoff.recipient_matches === true}
            controls={controls}
          />
          {handoff.status === 'open' &&
            typeof handoff.offered_to === 'string' &&
            !handoff.recipient_matches && (
              <p className="muted">Only the addressed client can claim this handoff.</p>
            )}
          {handoff.status === 'open' && handoff.recipient_matches === true && !canClaim && (
            <p className="muted">Claiming this handoff requires handoff claim access.</p>
          )}
          {handoff.status === 'claimed' && !handoff.claimed_by_actor && (
            <p className="muted">
              This claim predates user attribution. The workbench cannot identify its owner.
            </p>
          )}
          {handoff.status === 'claimed' && handoff.claimed_here === true && !canWrite && (
            <p className="muted">Resuming a session requires session write access.</p>
          )}
          <ResumeForm
            id={String(handoff.handoff_id)}
            session={String(handoff.session_id)}
            checkpoint={String(handoff.checkpoint_id)}
            identity={identity}
            canWrite={canResume}
            eligible={handoff.status === 'claimed' && handoff.claimed_here === true}
            controls={controls}
          />
        </>
      ) : (
        <p className="muted">Historical projection · view only</p>
      )}
      <Link
        className="panel-link"
        href={{ pathname: '/audit', query: { session_id: String(handoff.session_id) } }}
        target="_blank"
        rel="noreferrer"
        prefetch={false}
      >
        View audit ↗
      </Link>
    </div>
  );
}
