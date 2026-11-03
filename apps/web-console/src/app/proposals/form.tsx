'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { proposalText } from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import type { ProposalSubmissionBinding } from './original-model';
import { prepareProposalReview } from './review-actions';
import {
  decodeReviewOriginal,
  encodeReviewOriginal,
  type ProposalReviewOriginal,
} from './review-model';
import { OriginalProposalReview } from './review-submission';

export function ProposalReviewForm({
  id,
  revision,
  initialKey,
  canConfirm,
  binding,
}: {
  id: string;
  revision: number;
  initialKey: string;
  canConfirm: boolean;
  binding: ProposalSubmissionBinding;
}) {
  const [key, setKey] = useState(initialKey);
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [original, setOriginal] = useState<ProposalReviewOriginal>();
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
    };
  }, []);
  function edited() {
    setKey('proposal-review-' + crypto.randomUUID());
    setAcknowledged(false);
    setMessage('');
  }
  async function prepare(data: FormData) {
    if (
      !mounted.current ||
      operation.current ||
      original ||
      !acknowledged ||
      !choice ||
      (choice === 'confirm' && !canConfirm)
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    try {
      const expected = encodeReviewOriginal({
        schema_version: 1,
        kind: 'proposal-review-submission',
        binding,
        request_key: key,
        proposal_id: id,
        expected_revision: revision,
        decision: choice,
        reason: proposalText(reason, 'reason', 2000),
      });
      const result = await backupOperation(controller.signal, async (_signal, check) => {
        const result = await prepareProposalReview(data);
        check();
        return result;
      });
      if (!mounted.current || operation.current !== controller) return;
      if (result.status === 'prepared') {
        if (result.original !== expected) throw new TypeError();
        setOriginal(decodeReviewOriginal(result.original));
      } else setMessage(result.message);
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'The original review could not be prepared. Your decision and reason remain here. No review was sent.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (mounted.current) setPending(false);
      }
    }
  }
  if (original) return <OriginalProposalReview original={original} saveOnMount />;
  return (
    <form
      className="handoff-form"
      onSubmit={(event) => {
        event.preventDefault();
        void prepare(new FormData(event.currentTarget));
      }}
    >
      <p>
        Review the content, sources and provenance. Prepare and save the original decision, then
        explicitly send it. A confirmed proposal records your review; it does not change Plane work
        items.
      </p>
      <input type="hidden" name="key" value={key} />
      <input type="hidden" name="binding" value={JSON.stringify(binding)} />
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
          disabled={pending}
          onChange={(event) => {
            if (operation.current) return;
            setChoice(event.target.value);
            edited();
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
          readOnly={pending}
          onChange={(event) => {
            if (operation.current) return;
            setReason(event.target.value);
            edited();
          }}
        />
      </label>
      <label className="context-archive-confirm">
        <input
          type="checkbox"
          required
          checked={acknowledged}
          disabled={pending}
          onChange={(event) => {
            if (!operation.current) setAcknowledged(event.target.checked);
          }}
        />{' '}
        I reviewed the content and supporting sources and want to prepare this decision.
      </label>
      <button
        className="primary-button"
        disabled={
          pending ||
          !choice ||
          !reason.trim() ||
          !acknowledged ||
          (choice === 'confirm' && !canConfirm)
        }
      >
        {pending ? 'Preparing original review…' : 'Prepare original review'}
      </button>
      <Link
        href="/proposals/recover-review"
        prefetch={false}
        target="_blank"
        rel="noopener noreferrer"
      >
        Recover an original review ↗
      </Link>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
