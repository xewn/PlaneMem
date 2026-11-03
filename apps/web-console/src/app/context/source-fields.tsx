'use client';

import Link from 'next/link';
import { isSyncIdentifier, type SourceRef } from '@planemem/contracts';

export interface SourceDraft {
  key: number;
  type: string;
  id: string;
  revision: string;
  uri: string;
}

export function sourceDraft(key: number, source?: SourceRef): SourceDraft {
  return {
    key,
    type: source?.type ?? 'manual',
    id: source?.id ?? '',
    revision: source?.revision === undefined ? '' : String(source.revision),
    uri: source?.uri ?? '',
  };
}

export function sourceValues(sources: SourceDraft[]) {
  return sources.map(({ type, id, revision, uri }) => ({ type, id, revision, uri }));
}

function revisionNumber(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

export function sourceRefs(sources: SourceDraft[]): SourceRef[] {
  return sources.map(({ type, id, revision, uri }) => ({
    type,
    id,
    ...(revision === '' ? {} : { revision: revisionNumber(revision) }),
    ...(uri === '' ? {} : { uri }),
  }));
}

export function validateLocalSources(sources: SourceRef[], itemId?: string) {
  const revisions = new Map<string, number>();
  for (const [index, source] of sources.entries()) {
    if (source.type.trim() !== 'context-item') continue;
    const label = 'Source ' + (index + 1);
    if (source.type !== 'context-item')
      throw new TypeError(label + ': use the exact type “context-item”.');
    if (!isSyncIdentifier(source.id) || source.id === '.' || source.id === '..')
      throw new TypeError(label + ': enter a valid local item identifier.');
    if (source.id === itemId) throw new TypeError(label + ': an item cannot reference itself.');
    if (
      source.revision === undefined ||
      !Number.isSafeInteger(source.revision) ||
      source.revision < 1
    )
      throw new TypeError(label + ': pin a positive whole-number revision.');
    const previous = revisions.get(source.id);
    if (previous !== undefined && previous !== source.revision)
      throw new TypeError(label + ': the same local item cannot use conflicting revisions.');
    revisions.set(source.id, source.revision);
  }
}

export function ContextSourceFields({
  sources,
  locked,
  changed,
  onChange,
  onAdd,
  onRemove,
  onReset,
}: {
  sources: SourceDraft[];
  locked: boolean;
  changed: boolean;
  onChange: (key: number, field: Exclude<keyof SourceDraft, 'key'>, value: string) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
  onReset?: (() => void) | undefined;
}) {
  return (
    <>
      <h3>Supporting sources</h3>
      <p className="muted">
        Add 1–32 references. Use “context-item” and the exact revision you reviewed for local
        project knowledge. Review the current source before changing a pinned revision. External
        references are retained for review; their contents are not checked automatically.
      </p>
      {sources.map((entry, index) => {
        const local = entry.type === 'context-item';
        const linked = local && isSyncIdentifier(entry.id) && entry.id !== '.' && entry.id !== '..';
        const revision = revisionNumber(entry.revision);
        return (
          <fieldset className="proposal-source-fields" key={entry.key} disabled={locked}>
            <legend>Source {index + 1}</legend>
            <div className="context-item-fields">
              <label>
                Source type
                <input
                  required
                  maxLength={64}
                  value={entry.type}
                  placeholder="manual, context-item, document…"
                  onChange={(event) => onChange(entry.key, 'type', event.target.value)}
                />
              </label>
              <label>
                Description or identifier
                <input
                  required
                  maxLength={255}
                  value={entry.id}
                  onChange={(event) => onChange(entry.key, 'id', event.target.value)}
                />
              </label>
              <label>
                Revision {local ? '(required)' : '(optional)'}
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]+"
                  required={local}
                  value={entry.revision}
                  onChange={(event) => onChange(entry.key, 'revision', event.target.value)}
                />
              </label>
            </div>
            <label>
              Source URI (optional)
              <input
                maxLength={2048}
                value={entry.uri}
                onChange={(event) => onChange(entry.key, 'uri', event.target.value)}
              />
            </label>
            <div className="heading-actions">
              {linked && (
                <>
                  <Link
                    className="panel-link"
                    href={'/context?item=' + encodeURIComponent(entry.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open current source
                  </Link>
                  {Number.isSafeInteger(revision) && revision > 0 && (
                    <Link
                      className="panel-link"
                      href={
                        '/context/history?item=' +
                        encodeURIComponent(entry.id) +
                        '&version=' +
                        revision
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View pinned revision {revision}
                    </Link>
                  )}
                </>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={sources.length <= 1}
                onClick={() => onRemove(entry.key)}
              >
                Remove source {index + 1}
              </button>
            </div>
          </fieldset>
        );
      })}
      <div className="heading-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={locked || sources.length >= 32}
          onClick={onAdd}
        >
          Add source
        </button>
        {onReset && changed && (
          <button type="button" className="secondary-button" disabled={locked} onClick={onReset}>
            Undo source changes
          </button>
        )}
      </div>
      <p className="muted">
        Links open in a new tab. A pinned revision may predate recorded history. Saving source
        changes requires a new confirmation and does not update existing packs or proposals.
      </p>
    </>
  );
}
