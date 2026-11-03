'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  parseCreateProposal,
  proposalKinds,
  type Classification,
  type ProposalDocument,
} from '@planemem/contracts';
import { submitProposal, type ReviewFeedback } from './actions';

export interface ProposalSourceSeed {
  id: string;
  version: number;
  title: string;
  classification: Classification;
}
export type ProposalDraftSeed = Pick<
  ProposalDocument,
  | 'proposal_id'
  | 'revision'
  | 'kind'
  | 'title'
  | 'content'
  | 'classification'
  | 'source_refs'
  | 'status'
  | 'expires_at'
> & {
  sources_current: boolean;
};
interface SourceDraft {
  key: number;
  type: string;
  id: string;
  revision: string;
  uri: string;
}
const idle: ReviewFeedback = { status: 'idle' };
const emptySource = (key: number): SourceDraft => ({
  key,
  type: 'document',
  id: '',
  revision: '',
  uri: '',
});

export function ProposalCreateForm({
  initialKey,
  restricted,
  source,
  origin,
}: {
  initialKey: string;
  restricted: boolean;
  source?: ProposalSourceSeed;
  origin?: ProposalDraftSeed;
}) {
  const [state, submit, pending] = useActionState(submitProposal, idle);
  const [base] = useState(initialKey);
  const [startingSource] = useState(source);
  const [startingOrigin] = useState(origin);
  const [originRevision, setOriginRevision] = useState(String(origin?.revision ?? ''));
  const [sequence, setSequence] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [values, setValues] = useState({
    kind: origin?.kind ?? 'next_step',
    title: origin?.title ?? '',
    content: origin?.content ?? '',
    model_version: '',
    prompt_version: '',
    classification: origin?.classification ?? source?.classification ?? 'internal',
    ttl_seconds: '604800',
  });
  const [sources, setSources] = useState<SourceDraft[]>(() =>
    origin
      ? origin.source_refs.map((entry, key) => ({
          key,
          type: entry.type,
          id: entry.id,
          revision: entry.revision === undefined ? '' : String(entry.revision),
          uri: entry.uri ?? '',
        }))
      : source
        ? [
            {
              key: 0,
              type: 'context-item',
              id: source.id,
              revision: String(source.version),
              uri: '',
            },
          ]
        : [emptySource(0)],
  );
  const [nextSourceKey, setNextSourceKey] = useState(sources.length);
  const key = base + '-' + sequence;
  const current = state.key === key;
  const uncertain = current && state.uncertain === true;
  const locked = pending || uncertain;
  const draft = {
    ...values,
    ttl_seconds: Number(values.ttl_seconds),
    source_refs: sources.map(({ type, id, revision, uri }) => ({
      type: type.trim(),
      id: id.trim(),
      ...(revision.trim() ? { revision: Number(revision) } : {}),
      ...(uri.trim() ? { uri: uri.trim() } : {}),
    })),
    ...(startingOrigin
      ? {
          derived_from: {
            proposal_id: startingOrigin.proposal_id,
            revision: Number(originRevision),
          },
        }
      : {}),
  };
  let validation: string | undefined;
  try {
    parseCreateProposal(draft);
  } catch (error) {
    validation = error instanceof Error ? error.message : 'Check the proposal fields.';
  }
  function edited() {
    setSequence((value) => value + 1);
    setAcknowledged(false);
  }
  function change(name: keyof typeof values, value: string) {
    if (locked) return;
    setValues((previous) => ({ ...previous, [name]: value }));
    edited();
  }
  function changeSource(sourceKey: number, name: Exclude<keyof SourceDraft, 'key'>, value: string) {
    if (locked) return;
    setSources((previous) =>
      previous.map((entry) => (entry.key === sourceKey ? { ...entry, [name]: value } : entry)),
    );
    edited();
  }
  return (
    <form action={submit} className="handoff-form context-item-form">
      <p>
        Submit a sourced suggestion for review. The submitted content and sources cannot be edited
        afterward.
      </p>
      {startingSource && (
        <p className="muted">
          Started from {startingSource.title} · revision {startingSource.version}. Check the sources
          below before submitting.
        </p>
      )}
      {startingOrigin && (
        <div>
          <p>
            New draft based on “{startingOrigin.title}” ({startingOrigin.status}). This will create
            a separate proposal for a new review. The original decision is preserved.
          </p>
          {!startingOrigin.sources_current && (
            <p role="status">
              The original evidence is stale. Review and repair the copied sources before
              submitting.
            </p>
          )}
          <p className="muted">
            The original expires at {startingOrigin.expires_at}. Choose a new lifetime below and
            enter the actual model and authoring process for this revision; the original provenance
            is not reused automatically.
          </p>
          <Link
            className="panel-link"
            href={
              '/proposals?status=all&proposal=' + encodeURIComponent(startingOrigin.proposal_id)
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            Review original proposal
          </Link>
          <label>
            Original proposal revision reviewed
            <input
              type="number"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              required
              value={originRevision}
              readOnly={locked}
              onChange={(event) => {
                if (locked) return;
                setOriginRevision(event.target.value);
                edited();
              }}
            />
            <small>
              If the original was reviewed while you edited this draft, open it and check its new
              revision before changing this value.
            </small>
          </label>
        </div>
      )}
      <input type="hidden" name="key" value={key} />
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />
      <input type="hidden" name="acknowledged" value={acknowledged ? 'yes' : ''} />
      <label>
        Kind
        <select
          value={values.kind}
          disabled={locked}
          onChange={(event) => change('kind', event.target.value)}
        >
          {proposalKinds.map((kind) => (
            <option key={kind}>{kind}</option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input
          required
          maxLength={300}
          value={values.title}
          readOnly={locked}
          onChange={(event) => change('title', event.target.value)}
        />
      </label>
      <label>
        Suggested content
        <textarea
          required
          rows={8}
          maxLength={131072}
          value={values.content}
          readOnly={locked}
          onChange={(event) => change('content', event.target.value)}
        />
      </label>
      <div className="context-item-fields">
        <label>
          Classification
          <select
            value={values.classification}
            disabled={locked}
            onChange={(event) => change('classification', event.target.value)}
          >
            {['public', 'internal', 'confidential', ...(restricted ? ['restricted'] : [])].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
          <small>
            Linked context items and the original proposal may raise the saved classification.
          </small>
        </label>
        <label>
          Valid for (seconds)
          <input
            type="number"
            required
            min={60}
            max={2592000}
            step={1}
            value={values.ttl_seconds}
            readOnly={locked}
            onChange={(event) => change('ttl_seconds', event.target.value)}
          />
          <small>Default: seven days. Allowed: one minute to thirty days.</small>
        </label>
      </div>
      <h3>How this suggestion was produced</h3>
      <p className="muted">
        Record the actual model and prompt versions. For a human-written suggestion, enter “manual”
        and identify the authoring process. These details are supplied by you.
      </p>
      <div className="context-item-fields">
        <label>
          Model version
          <input
            required
            maxLength={200}
            value={values.model_version}
            readOnly={locked}
            onChange={(event) => change('model_version', event.target.value)}
          />
        </label>
        <label>
          Prompt or authoring process version
          <input
            required
            maxLength={200}
            value={values.prompt_version}
            readOnly={locked}
            onChange={(event) => change('prompt_version', event.target.value)}
          />
        </label>
      </div>
      <h3>Supporting sources</h3>
      <p className="muted">
        Add 1–32 sources. Use “context-item” with the exact item revision for project knowledge.
        External references are retained for review.
      </p>
      {sources.map((entry, index) => (
        <fieldset className="proposal-source-fields" key={entry.key} disabled={locked}>
          <legend>Source {index + 1}</legend>
          <div className="context-item-fields">
            <label>
              Source type
              <input
                required
                maxLength={64}
                value={entry.type}
                onChange={(event) => changeSource(entry.key, 'type', event.target.value)}
                placeholder="context-item, document, meeting…"
              />
            </label>
            <label>
              Identifier
              <input
                required
                maxLength={255}
                value={entry.id}
                onChange={(event) => changeSource(entry.key, 'id', event.target.value)}
              />
            </label>
            <label>
              Revision {entry.type.trim() === 'context-item' ? '(required)' : '(optional)'}
              <input
                type="number"
                required={entry.type.trim() === 'context-item'}
                min={entry.type.trim() === 'context-item' ? 1 : 0}
                step={1}
                max={Number.MAX_SAFE_INTEGER}
                value={entry.revision}
                onChange={(event) => changeSource(entry.key, 'revision', event.target.value)}
              />
            </label>
          </div>
          <label>
            Source URL (optional)
            <input
              type="url"
              maxLength={2048}
              value={entry.uri}
              onChange={(event) => changeSource(entry.key, 'uri', event.target.value)}
            />
          </label>
          <div className="heading-actions">
            {entry.type.trim() === 'context-item' && entry.id.trim() && (
              <Link
                className="panel-link"
                href={'/context?item=' + encodeURIComponent(entry.id.trim())}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open current source in a new tab
              </Link>
            )}
            {sources.length > 1 && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  if (locked) return;
                  setSources((previous) => previous.filter((source) => source.key !== entry.key));
                  edited();
                }}
              >
                Remove source {index + 1}
              </button>
            )}
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary-button"
        disabled={locked || sources.length >= 32}
        onClick={() => {
          if (locked || sources.length >= 32) return;
          setSources((previous) => [...previous, emptySource(nextSourceKey)]);
          setNextSourceKey((value) => value + 1);
          edited();
        }}
      >
        Add source
      </button>
      <label className="context-archive-confirm">
        <input
          type="checkbox"
          required
          checked={acknowledged}
          disabled={locked}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        I checked the content, sources and provenance and want to submit this proposal for review.
      </label>
      {validation && sequence > 0 && <p className="muted">{validation}</p>}
      <button
        className="primary-button"
        disabled={pending || !acknowledged || validation !== undefined}
      >
        {pending ? 'Submitting…' : uncertain ? 'Retry original submission' : 'Submit for review'}
      </button>
      {current && state.message && (
        <div role="status">
          <p>{state.message}</p>
          {state.trace && <small>Trace · {state.trace}</small>}
        </div>
      )}
      {uncertain && (
        <p role="status">
          Keep this page open and retry the original submission to check its result. The draft stays
          locked until the gateway confirms the saved proposal.
        </p>
      )}
      {current && state.status === 'error' && !uncertain && (
        <p className="muted">
          Your draft is preserved. For a changed source, open its current version and update the
          source fields before submitting again.
        </p>
      )}
    </form>
  );
}
