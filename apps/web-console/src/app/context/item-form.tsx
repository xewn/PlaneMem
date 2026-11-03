'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  parseCreateContextItem,
  parseUpdateContextItem,
  type SourceRef,
} from '@planemem/contracts';
import { saveContextItem, type ItemFeedback } from './item-actions';
import {
  ContextSourceFields,
  sourceDraft,
  sourceRefs,
  sourceValues,
  validateLocalSources,
  type SourceDraft,
} from './source-fields';

const idle: ItemFeedback = { status: 'idle' };
type Item = Record<string, unknown>;

function formValues(item?: Item) {
  return {
    title: String(item?.title ?? ''),
    content: item
      ? typeof item.content === 'string'
        ? item.content
        : (JSON.stringify(item.content, null, 2) ?? '')
      : '',
    item_type: String(item?.item_type ?? 'note'),
    layer: String(item?.layer ?? 'L4'),
    priority: String(item?.priority ?? 'Medium'),
    confidence: String(item?.confidence ?? '0.5'),
    classification: String(item?.classification ?? 'internal'),
    status: item?.status === 'excluded' ? 'excluded' : 'proposed',
    expires_at: item?.expires_at ? String(item.expires_at) : '',
  };
}

export function ContextItemEditor({
  initial,
  initialKey,
  restricted,
}: {
  initial?: Item;
  initialKey: string;
  restricted: boolean;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(saveContextItem, idle);
  const [base] = useState(initialKey);
  const [revision, setRevision] = useState(0);
  const [original] = useState(() => formValues(initial));
  const [values, setValues] = useState(original);
  const [originalSources] = useState(() =>
    initial && Array.isArray(initial.source_refs)
      ? (initial.source_refs as SourceRef[]).map((source, index) => sourceDraft(index, source))
      : [sourceDraft(0)],
  );
  const [sources, setSources] = useState(originalSources);
  const [nextSourceKey, setNextSourceKey] = useState(originalSources.length);
  const sourcesChanged =
    JSON.stringify(sourceValues(sources)) !== JSON.stringify(sourceValues(originalSources));
  const key = base + '-' + revision;
  const current = state.key === key;
  const uncertain = current && state.uncertain;
  const locked = pending || uncertain === true;
  const patch: Record<string, unknown> = {};
  for (const name of [
    'title',
    'content',
    'item_type',
    'layer',
    'priority',
    'confidence',
    'expires_at',
    'status',
  ] as const) {
    if (initial && values[name] === original[name]) continue;
    if (!initial && name === 'status') continue;
    patch[name] =
      name === 'confidence'
        ? values[name].trim()
          ? Number(values[name])
          : Number.NaN
        : name === 'expires_at'
          ? values[name] || null
          : values[name];
  }
  if (!initial) {
    patch.classification = values.classification;
  }
  if (!initial || sourcesChanged) patch.source_refs = sourceRefs(sources);
  const hasChanges = Object.keys(patch).length > 0;
  let validation: string | undefined;
  try {
    if (hasChanges) {
      if (initial) parseUpdateContextItem(patch);
      else parseCreateContextItem(patch);
      if (!initial || sourcesChanged)
        validateLocalSources(sourceRefs(sources), initial ? String(initial.id) : undefined);
    }
  } catch (error) {
    validation = error instanceof Error ? error.message : 'Check the item fields.';
  }
  function change(name: keyof typeof values, value: string) {
    if (locked) return;
    setValues((previous) => ({ ...previous, [name]: value }));
    setRevision((value) => value + 1);
  }
  function changeSource(sourceKey: number, name: Exclude<keyof SourceDraft, 'key'>, value: string) {
    if (locked) return;
    setSources((previous) =>
      previous.map((source) => (source.key === sourceKey ? { ...source, [name]: value } : source)),
    );
    setRevision((value) => value + 1);
  }
  return (
    <form
      action={submit}
      className="handoff-form context-item-form"
      noValidate
      onSubmit={(event) => {
        if (pending || !hasChanges || validation !== undefined) event.preventDefault();
      }}
    >
      <p>
        {initial
          ? 'Edits return confirmed content to proposed. Classification is preserved. Source references change only when you edit them.'
          : 'Add knowledge with a traceable source. New items start as proposed.'}
      </p>
      <input type="hidden" name="key" value={key} />
      <input type="hidden" name="operation" value={initial ? 'update' : 'create'} />
      <input type="hidden" name="item_id" value={String(initial?.id ?? '')} />
      <input type="hidden" name="version" value={String(initial?.version ?? '')} />
      <input type="hidden" name="draft" value={JSON.stringify(patch)} />
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
        Content
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
          Item type
          <input
            required
            maxLength={64}
            value={values.item_type}
            readOnly={locked}
            onChange={(event) => change('item_type', event.target.value)}
          />
        </label>
        <label>
          Layer
          <select
            value={values.layer}
            disabled={locked}
            onChange={(event) => change('layer', event.target.value)}
          >
            {['L0', 'L1', 'L2', 'L3', 'L4'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={values.priority}
            disabled={locked}
            onChange={(event) => change('priority', event.target.value)}
          >
            {['High', 'Medium', 'Low'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Confidence
          <input
            type="number"
            min={0}
            max={1}
            step={0.001}
            required
            value={values.confidence}
            readOnly={locked}
            onChange={(event) => change('confidence', event.target.value)}
          />
        </label>
      </div>
      <label>
        Expiry in UTC (optional)
        <input
          placeholder="2026-12-01T00:00:00Z"
          value={values.expires_at}
          readOnly={locked}
          onChange={(event) => change('expires_at', event.target.value)}
        />
        <small>Leave empty for no expiry. Use a date and time ending in Z.</small>
      </label>
      {initial ? (
        <label>
          Availability
          <select
            value={values.status}
            disabled={locked}
            onChange={(event) => change('status', event.target.value)}
          >
            <option value="proposed">Proposed · eligible for context packs</option>
            <option value="excluded">Excluded from new context packs</option>
          </select>
        </label>
      ) : (
        <>
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
          </label>
        </>
      )}
      <ContextSourceFields
        sources={sources}
        locked={locked}
        changed={sourcesChanged}
        onChange={changeSource}
        onAdd={() => {
          if (locked || sources.length >= 32) return;
          setSources((previous) => [...previous, sourceDraft(nextSourceKey)]);
          setNextSourceKey((value) => value + 1);
          setRevision((value) => value + 1);
        }}
        onRemove={(sourceKey) => {
          if (locked || sources.length <= 1) return;
          setSources((previous) => previous.filter((source) => source.key !== sourceKey));
          setRevision((value) => value + 1);
        }}
        onReset={
          initial
            ? () => {
                if (locked) return;
                setSources(originalSources);
                setRevision((value) => value + 1);
              }
            : undefined
        }
      />
      {validation && revision > 0 && (
        <p role="status" className="muted">
          {validation}
        </p>
      )}
      <button
        className="primary-button"
        disabled={pending || !hasChanges || validation !== undefined}
      >
        {pending
          ? 'Saving…'
          : uncertain
            ? 'Retry with original values'
            : initial
              ? 'Save changes'
              : 'Add proposed item'}
      </button>
      {current && state.message && (
        <div role="status">
          <p>{state.message}</p>
          {state.trace && <small>Trace · {state.trace}</small>}
        </div>
      )}
      {uncertain && (
        <p role="status">
          The save result is unknown. Keep this page open and retry the original content, sources
          and request key to resolve it.
        </p>
      )}
      {current && state.reload && (
        <p>
          Reloading replaces this draft with the current item.{' '}
          <button
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={() => router.refresh()}
          >
            Reload current item
          </button>
        </p>
      )}
      {current && state.status === 'error' && !uncertain && !state.reload && (
        <button
          className="secondary-button"
          type="button"
          disabled={pending}
          onClick={() => setRevision((value) => value + 1)}
        >
          Start a new request
        </button>
      )}
    </form>
  );
}

export function ArchiveContextItem({ item, initialKey }: { item: Item; initialKey: string }) {
  return <ContextItemLifecycleForm item={item} initialKey={initialKey} operation="archive" />;
}

export function RestoreContextItem({ item, initialKey }: { item: Item; initialKey: string }) {
  return <ContextItemLifecycleForm item={item} initialKey={initialKey} operation="restore" />;
}

export function ConfirmContextItem({ item, initialKey }: { item: Item; initialKey: string }) {
  const [state, submit, pending] = useActionState(saveContextItem, idle);
  const [reason, setReason] = useState('');
  const [requestRevision, setRequestRevision] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const router = useRouter();
  const key = initialKey + '-' + requestRevision;
  const current = state.key === key;
  const uncertain = current && state.uncertain === true;
  const locked = pending || uncertain;
  return (
    <form action={submit} className="handoff-form context-item-form">
      <p>
        Review this version and all its sources before confirming. This records your approval;
        future edits require a new confirmation. External evidence still needs your review.
      </p>
      <input type="hidden" name="operation" value="confirm" />
      <input type="hidden" name="key" value={key} />
      <input type="hidden" name="item_id" value={String(item.id)} />
      <input type="hidden" name="version" value={String(item.version)} />
      <input type="hidden" name="acknowledged" value={acknowledged ? 'yes' : ''} />
      <input type="hidden" name="reason" value={reason} />
      <label>
        Confirmation reason
        <textarea
          required
          maxLength={2000}
          value={reason}
          disabled={locked}
          onChange={(event) => {
            setReason(event.target.value);
            setRequestRevision((value) => value + 1);
            setAcknowledged(false);
          }}
        />
      </label>
      <label className="context-archive-confirm">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={locked}
          required
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        I reviewed version {String(item.version)} and want to confirm its content.
      </label>
      <button
        className="secondary-button"
        disabled={pending || !acknowledged || !reason.trim() || (current && state.reload === true)}
      >
        {pending ? 'Saving…' : uncertain ? 'Retry original confirmation' : 'Confirm this version'}
      </button>
      {current && state.message && (
        <div role="status">
          <p>{state.message}</p>
          {state.trace && <small>Trace · {state.trace}</small>}
        </div>
      )}
      {uncertain && (
        <p role="status">
          The confirmation result is unknown. Keep this page open and retry with the original reason
          and request key.
        </p>
      )}
      {current && state.reload && !uncertain && (
        <button
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={() => router.refresh()}
        >
          Reload current item
        </button>
      )}
    </form>
  );
}

function ContextItemLifecycleForm({
  item,
  initialKey,
  operation,
}: {
  item: Item;
  initialKey: string;
  operation: 'archive' | 'restore';
}) {
  const [state, submit, pending] = useActionState(saveContextItem, idle);
  const [key] = useState(initialKey);
  const [confirmed, setConfirmed] = useState(false);
  const router = useRouter();
  return (
    <form action={submit} className="handoff-form context-item-form">
      <p>
        {operation === 'restore'
          ? 'Restoring returns the item to the active list as excluded. Review and edit it before making it eligible for context packs. Its classification and expiry are preserved; old packs remain stale.'
          : 'Archiving removes this item from current views and new context packs. Saved packs that reference it become stale.'}
      </p>
      <input type="hidden" name="key" value={key} />
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="acknowledged" value={confirmed ? 'yes' : ''} />
      <input type="hidden" name="item_id" value={String(item.id)} />
      <input type="hidden" name="version" value={String(item.version)} />
      <label className="context-archive-confirm">
        <input
          type="checkbox"
          required
          checked={confirmed}
          disabled={pending || state.uncertain === true}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {operation === 'restore' ? 'Restore this item as excluded' : 'Archive this item'}
      </label>
      <button className="secondary-button" disabled={pending || !confirmed}>
        {pending
          ? 'Saving…'
          : state.uncertain
            ? 'Retry original request'
            : operation === 'restore'
              ? 'Restore item'
              : 'Archive item'}
      </button>
      {state.message && (
        <div role="status">
          <p>{state.message}</p>
          {state.trace && <small>Trace · {state.trace}</small>}
        </div>
      )}
      {state.reload && (
        <button
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={() => router.refresh()}
        >
          Reload current item
        </button>
      )}
      {state.uncertain && (
        <p role="status">
          The result is still unknown. Keep this page open and retry the original request to confirm
          its outcome.
        </p>
      )}
    </form>
  );
}
