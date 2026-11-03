'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { reviewProposal, type ReviewFeedback } from './actions';

const idle: ReviewFeedback = { status: 'idle' };
export function ProposalReviewForm({
  id,
  revision,
  initialKey,
  canConfirm,
}: {
  id: string;
  revision: number;
  initialKey: string;
  canConfirm: boolean;
}) {
  const [state, submit, pending] = useActionState(reviewProposal, idle);
  const [base] = useState(initialKey);
  const [sequence, setSequence] = useState(0);
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const router = useRouter();
  const key = base + '-' + sequence;
  const current = state.key === key;
  const uncertain = current && state.uncertain;
  const locked = pending || uncertain === true;
  return (
    <form action={submit} className="handoff-form">
      <p>
        Review the content, sources and provenance before deciding. A confirmed proposal records
        your review; it does not change Plane work items.
      </p>
      <input type="hidden" name="key" value={key} />
      <input type="hidden" name="proposal_id" value={id} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="choice" value={choice} />
      <input type="hidden" name="reason" value={reason} />
      <input type="hidden" name="acknowledged" value={acknowledged ? 'yes' : ''} />
      <label>
        Decision
        <select
          required
          value={choice}
          disabled={locked}
          onChange={(event) => {
            if (locked) return;
            setChoice(event.target.value);
            setSequence((value) => value + 1);
            setAcknowledged(false);
          }}
        >
          <option value="">Choose a decision</option>
          <option value="confirm" disabled={!canConfirm}>
            Confirm as reviewed
          </option>
          <option value="reject">Reject</option>
        </select>
      </label>
      <label>
        Review reason
        <textarea
          required
          rows={4}
          maxLength={2000}
          value={reason}
          readOnly={locked}
          onChange={(event) => {
            if (locked) return;
            setReason(event.target.value);
            setSequence((value) => value + 1);
            setAcknowledged(false);
          }}
        />
      </label>
      <label className="context-archive-confirm">
        <input
          type="checkbox"
          required
          checked={acknowledged}
          disabled={locked}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        I reviewed the content and supporting sources.
      </label>
      <button
        className="primary-button"
        disabled={
          pending ||
          !choice ||
          !reason.trim() ||
          !acknowledged ||
          (current && state.reload === true) ||
          (choice === 'confirm' && !canConfirm && !uncertain)
        }
      >
        {pending
          ? 'Saving decision…'
          : uncertain
            ? 'Retry original decision'
            : 'Save review decision'}
      </button>
      {current && state.message && (
        <div role="status">
          <p>{state.message}</p>
          {state.trace && <small>Trace · {state.trace}</small>}
        </div>
      )}
      {uncertain && (
        <p role="status">
          The review result is unknown. Keep this page open and retry the original decision, reason
          and request key. Do not submit a different decision until this request is resolved.
        </p>
      )}
      {current && state.reload && !uncertain && (
        <button
          className="secondary-button"
          type="button"
          disabled={pending}
          onClick={() => router.refresh()}
        >
          Reload proposal
        </button>
      )}
      {current && state.status === 'error' && !uncertain && !state.reload && (
        <button
          className="secondary-button"
          type="button"
          disabled={pending}
          onClick={() => setSequence((value) => value + 1)}
        >
          Start a new request
        </button>
      )}
    </form>
  );
}
