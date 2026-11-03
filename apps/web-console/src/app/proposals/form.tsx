'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ReviewEditingPanel } from './review-editing-panel';
import { loadReviewOriginal } from './review-store';

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
  const [savePrepared, setSavePrepared] = useState(true);
  const mounted = useRef(false);
  const active = useRef(false);
  const prepared = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const beginStorage = useCallback(() => {
    if (!mounted.current || active.current || prepared.current) return false;
    active.current = true;
    setPending(true);
    setAcknowledged(false);
    return true;
  }, []);
  const endStorage = useCallback(() => {
    active.current = false;
    if (mounted.current) setPending(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
      active.current = false;
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
      active.current ||
      original ||
      !acknowledged ||
      !choice ||
      (choice === 'confirm' && !canConfirm)
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    active.current = true;
    setPending(true);
    setAcknowledged(false);
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
      let recovered = false;
      const result = await backupOperation(controller.signal, async (signal, check) => {
        const saved = await loadReviewOriginal(binding, key, signal);
        check();
        if (saved) {
          if (encodeReviewOriginal(saved) !== expected) throw new TypeError();
          recovered = true;
          return { status: 'prepared' as const, original: expected };
        }
        const result = await prepareProposalReview(data);
        check();
        return result;
      });
      if (!mounted.current || operation.current !== controller) return;
      if (result.status === 'prepared') {
        if (result.original !== expected) throw new TypeError();
        prepared.current = true;
        setSavePrepared(!recovered);
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
        active.current = false;
        if (mounted.current) setPending(false);
      }
    }
  }
  if (original) return <OriginalProposalReview original={original} saveOnMount={savePrepared} />;
  return (
    <>
      <form
        className="handoff-form"
        onSubmit={(event) => {
          event.preventDefault();
          void prepare(new FormData(event.currentTarget));
        }}
      >
        <p>
          Review the content, sources and provenance. Prepare and save the original decision, then
          explicitly send it. A confirmed proposal records your review; it does not change Plane
          work items.
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
              if (active.current) return;
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
              if (active.current) return;
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
              if (!active.current) setAcknowledged(event.target.checked);
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
          {pending && operation.current ? 'Preparing original review…' : 'Prepare original review'}
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
      <ReviewEditingPanel
        binding={binding}
        editor={{
          requestKey: key,
          proposalId: id,
          revision,
          decision: choice,
          reason,
          disabled: pending,
          begin: beginStorage,
          end: endStorage,
          onLoad: (draft) => {
            setKey(draft.request_key);
            setChoice(draft.decision);
            setReason(draft.reason);
            setAcknowledged(false);
            setMessage('Draft restored. Review the current proposal and sources before preparing.');
          },
          onOriginal: (saved) => {
            prepared.current = true;
            setSavePrepared(false);
            setAcknowledged(false);
            setOriginal(saved);
          },
        }}
      />
      <Link
        href="/proposals/recover-review-draft"
        prefetch={false}
        target="_blank"
        rel="noopener noreferrer"
      >
        Recover unfinished review drafts ↗
      </Link>
    </>
  );
}
