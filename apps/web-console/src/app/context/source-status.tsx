import Link from 'next/link';
import {
  isSyncIdentifier,
  type ContextSourceReferenceCheck,
  type SourceRef,
} from '@planemem/contracts';

const descriptions: Record<ContextSourceReferenceCheck['state'], string> = {
  current: 'The pinned source and its local dependencies passed this check.',
  stale:
    'This source or its dependencies changed. Review the current source before changing the pin.',
  unavailable:
    'A source is missing, archived or unavailable in this project. Review the reference.',
  expired: 'This source or one of its dependencies has expired. Review its content and lifetime.',
  excluded: 'This source or one of its dependencies is excluded from use.',
  cycle: 'The local source chain contains a cycle. Remove circular references before using it.',
  limit: 'The source chain exceeded the inspection limit. This result cannot establish validity.',
  invalid:
    'The reference or source metadata is invalid. Review its identifier and pinned revision.',
  'not-checked': 'This reference was not evaluated. Resolve the item-level issue and check again.',
};

function explanation(check: ContextSourceReferenceCheck | undefined) {
  switch (check?.issue) {
    case 'reference':
      return 'Use a valid local item identifier and a positive pinned revision.';
    case 'revision':
      return 'The pinned revision differs from the current source. Review both versions before editing the pin.';
    case 'confirmation':
      return 'This source must be confirmed before it can support the item. Review and confirm the source first, then review its new revision.';
    case 'classification':
      return 'The source classification exceeds this item’s classification. Review the source selection.';
    default:
      return descriptions[check?.state ?? 'not-checked'];
  }
}

export function ContextSourceStatus({
  sources,
  checks,
  current,
  confirmation = false,
}: {
  sources: SourceRef[];
  checks: ContextSourceReferenceCheck[];
  current: boolean;
  confirmation?: boolean;
}) {
  const byIndex = new Map(checks.map((check) => [check.source_index, check]));
  if (!sources.length) return <p className="muted">No source references are recorded.</p>;
  return (
    <details open={!current}>
      <summary>
        {confirmation
          ? 'Review sources required for confirmation'
          : 'Review individual source references'}
      </summary>
      {confirmation && (
        <p className="muted">
          Confirmation requires every local dependency to be confirmed at the pinned revision.
          Confirming a source creates a new revision; review that version before updating this
          item’s pin. External evidence still needs your review.
        </p>
      )}
      <p className="muted">
        Results use the {confirmation ? 'confirmation readiness' : 'item source'} check above.
        Current revisions are shown only for readable, active sources with valid metadata. Links
        open in a new tab; pins are never updated automatically. After reviewing a change, use “Edit
        this item” to repair its sources.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Pinned revision</th>
              <th>Current revision</th>
              <th>Check and next step</th>
            </tr>
          </thead>
          <tbody>
            {sources.slice(0, 32).map((source, index) => {
              const local = source.type === 'context-item';
              const check = byIndex.get(index);
              const linked =
                local && isSyncIdentifier(source.id) && source.id !== '.' && source.id !== '..';
              return (
                <tr key={index}>
                  <td>
                    {index + 1}. {source.type}: {source.id}
                    {linked && (
                      <div className="heading-actions">
                        <Link
                          className="panel-link"
                          href={'/context?item=' + encodeURIComponent(source.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open current source
                        </Link>
                        {Number.isSafeInteger(source.revision) && (source.revision ?? 0) > 0 && (
                          <Link
                            className="panel-link"
                            href={
                              '/context/history?item=' +
                              encodeURIComponent(source.id) +
                              '&version=' +
                              source.revision
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View pinned history
                          </Link>
                        )}
                      </div>
                    )}
                  </td>
                  <td>{source.revision ?? 'Not pinned'}</td>
                  <td>
                    {local
                      ? (check?.current_revision ?? 'Not available at this check')
                      : 'Not checked'}
                  </td>
                  <td>
                    {local
                      ? explanation(check)
                      : 'External reference. Review the original evidence directly.'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sources.length > 32 && (
        <p className="muted">
          Only the first 32 references are shown. This item exceeds the supported source limit.
        </p>
      )}
    </details>
  );
}
