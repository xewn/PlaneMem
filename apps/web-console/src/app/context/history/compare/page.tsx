import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageError } from '../../../../components/page-state';
import { Badge, Panel } from '../../../../components/ui';
import { getWorkbenchContextComparison } from '../../../../lib/context-comparison-server';
import {
  contextComparisonHref,
  contextHistoryHref,
  parseContextComparisonParams,
  type ContextComparisonNavigation,
  type ContextSearchParams,
} from '../../navigation';
import { ContextComparisonForm } from './form';
import {
  parseContextComparisonQuery,
  type ContextComparisonQuery,
  type ContextSnapshotComparison,
} from './model';

export const dynamic = 'force-dynamic';

export default async function ContextComparisonPage({
  searchParams,
}: {
  searchParams: Promise<ContextSearchParams>;
}) {
  let navigation: ContextComparisonNavigation;
  try {
    navigation = parseContextComparisonParams(await searchParams);
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Compare context versions</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/context" prefetch={false}>
          Return to context
        </Link>
      </>
    );
  }
  let query: ContextComparisonQuery | undefined;
  let failure: unknown;
  if (navigation.from_version !== undefined && navigation.to_version !== undefined) {
    try {
      query = parseContextComparisonQuery({
        item_id: navigation.history.item_id,
        from_version: navigation.from_version,
        to_version: navigation.to_version,
      });
    } catch (error) {
      failure = error;
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Compare context versions</h1>
          <p>Review the recorded content and properties of two versions of this item.</p>
        </div>
        <nav className="heading-actions" aria-label="Context comparison return">
          <Link
            className="panel-link"
            href={contextHistoryHref(navigation.history)}
            prefetch={false}
          >
            Back to history
          </Link>
          {navigation.history.return_href && (
            <Link className="panel-link" href={navigation.history.return_href} prefetch={false}>
              Back to results
            </Link>
          )}
        </nav>
      </div>
      <Panel title="Choose two versions" icon="search">
        <div className="side-detail">
          <ContextComparisonForm navigation={navigation} />
          <p className="muted context-hash">Item: {navigation.history.item_id}</p>
        </div>
      </Panel>
      {failure !== undefined ? (
        <PageError error={failure} />
      ) : query ? (
        <Comparison query={query} navigation={navigation} />
      ) : (
        <p className="side-detail">Choose both version numbers to load their snapshots.</p>
      )}
    </>
  );
}

async function Comparison({
  query,
  navigation,
}: {
  query: ContextComparisonQuery;
  navigation: ContextComparisonNavigation;
}) {
  try {
    const { from, to, comparison } = await getWorkbenchContextComparison(query);
    const changed = [
      comparison.content.changed && 'content',
      comparison.sources.changed && 'sources',
      comparison.confirmation.changed && 'confirmation record',
    ].filter(Boolean);
    return (
      <>
        <Panel title={`Version ${query.from_version} → version ${query.to_version}`} icon="context">
          <div className="side-detail">
            <Badge tone="neutral">Recorded versions</Badge>
            <p>
              {comparison.changed_fields} of {comparison.fields.length} properties differ.{' '}
              {changed.length
                ? `Changes also include ${changed.join(', ')}.`
                : 'Content, sources and confirmation record match.'}
            </p>
            <p className="muted">
              These are historical records. Comparing them does not restore an item or make its
              sources current.
            </p>
            <nav className="heading-actions" aria-label="Compared versions">
              <Link
                className="panel-link"
                href={contextHistoryHref({ ...navigation.history, version: query.from_version })}
                prefetch={false}
              >
                Open base version {query.from_version}
              </Link>
              <Link
                className="panel-link"
                href={contextHistoryHref({ ...navigation.history, version: query.to_version })}
                prefetch={false}
              >
                Open comparison version {query.to_version}
              </Link>
              <Link
                className="panel-link"
                href={contextComparisonHref({
                  ...navigation,
                  from_version: query.to_version,
                  to_version: query.from_version,
                })}
                prefetch={false}
              >
                Reverse comparison
              </Link>
            </nav>
          </div>
          <FieldTable fields={comparison.fields} query={query} caption="Context properties" />
        </Panel>
        <ValuePair title="Recorded content" values={comparison.content} query={query}>
          Text includes its original whitespace. JSON is compared by structure, ignoring object key
          order and preserving array order.
        </ValuePair>
        <ValuePair title="Recorded sources" values={comparison.sources} query={query}>
          Base: {comparison.sources.before_count} sources · Comparison:{' '}
          {comparison.sources.after_count} sources. Order and duplicates are preserved. Source
          addresses are displayed as text; their availability has not been checked.
        </ValuePair>
        <ValuePair title="Historical confirmation" values={comparison.confirmation} query={query}>
          A recorded confirmation describes that version only. No confirmation is inferred for
          records without one.
        </ValuePair>
        <Panel title="Record information" icon="audit">
          <div className="side-detail">
            <p>
              Dates and attribution are compared separately from content properties. A baseline has
              no recorded command author.
            </p>
          </div>
          <FieldTable
            fields={comparison.records}
            query={query}
            caption="Historical record information"
          />
          <details className="side-detail context-hash">
            <summary>Read information</summary>
            <p>
              Both versions were read separately using the same session and project. The comparison
              does not represent one database snapshot.
            </p>
            <p>Project: {from.data.item.project_id}</p>
            <p>
              Base read trace: {from.trace_id}
              <br />
              Comparison read trace: {to.trace_id}
            </p>
          </details>
        </Panel>
      </>
    );
  } catch (error) {
    const fields = new URLSearchParams(contextComparisonHref(navigation).split('?')[1]);
    return (
      <>
        <PageError error={error} />
        <p className="side-detail">
          The comparison could not be completed. Retry the same two versions or change the selection
          above.
        </p>
        <form action="/context/history/compare" method="get">
          {Array.from(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <button className="secondary-button" type="submit">
            Retry these versions
          </button>
        </form>
      </>
    );
  }
}

function FieldTable({
  fields,
  query,
  caption,
}: {
  fields: ContextSnapshotComparison['fields'];
  query: ContextComparisonQuery;
  caption: string;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table context-comparison-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Base: {query.from_version}</th>
            <th scope="col">Comparison: {query.to_version}</th>
            <th scope="col">Difference</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.key}>
              <th scope="row">{field.label}</th>
              <td>{field.before}</td>
              <td>{field.after}</td>
              <td>{field.changed ? 'Changed' : 'Same'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ValuePair({
  title,
  values,
  query,
  children,
}: {
  title: string;
  values: ContextSnapshotComparison['content'];
  query: ContextComparisonQuery;
  children: ReactNode;
}) {
  return (
    <Panel
      title={title}
      icon="context"
      action={
        <Badge tone={values.changed ? 'yellow' : 'neutral'}>
          {values.changed ? 'Changed' : 'Same'}
        </Badge>
      }
    >
      <div className="side-detail">
        <p className="muted">{children}</p>
        <div className="context-comparison-values">
          <div>
            <h3>
              Base: {query.from_version} · {values.before_format}
            </h3>
            <pre
              className="context-content"
              tabIndex={0}
              aria-label={`${title}, base version ${query.from_version}`}
            >
              {values.before}
            </pre>
          </div>
          <div>
            <h3>
              Comparison: {query.to_version} · {values.after_format}
            </h3>
            <pre
              className="context-content"
              tabIndex={0}
              aria-label={`${title}, comparison version ${query.to_version}`}
            >
              {values.after}
            </pre>
          </div>
        </div>
      </div>
    </Panel>
  );
}
