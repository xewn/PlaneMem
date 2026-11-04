import Link from 'next/link';
import {
  parseContextPackComparisonQuery,
  type ContextPackComparisonQuery,
  type SavedPackCandidate,
} from '@planemem/contracts';
import { PageError } from '../../../../components/page-state';
import { Badge, Panel } from '../../../../components/ui';
import { getWorkbenchContextPackComparison } from '../../../../lib/context-pack-comparison-server';
import type { ContextSearchParams } from '../../navigation';
import { packReadHref } from '../read/navigation';
import { packDirectoryHref } from '../navigation';
import {
  packComparisonHref,
  parsePackComparisonParams,
  type PackComparisonNavigation,
} from './navigation';

export const dynamic = 'force-dynamic';

export default async function SavedPackComparisonPage({
  searchParams,
}: {
  searchParams: Promise<ContextSearchParams>;
}) {
  let navigation: PackComparisonNavigation;
  try {
    navigation = parsePackComparisonParams(await searchParams);
  } catch (error) {
    return (
      <>
        <h1>Compare saved packs</h1>
        <PageError error={error} />
        <Link className="panel-link" href="/context" prefetch={false}>
          Return to context
        </Link>
      </>
    );
  }
  let query: ContextPackComparisonQuery | undefined;
  let failure: unknown;
  if (navigation.from_pack_id !== undefined && navigation.to_pack_id !== undefined) {
    try {
      query = parseContextPackComparisonQuery({
        from_pack_id: navigation.from_pack_id,
        to_pack_id: navigation.to_pack_id,
      });
    } catch (error) {
      failure = error;
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Compare saved packs</h1>
          <p>Review changes in selected knowledge, exclusions, sources and token budgets.</p>
        </div>
        <Link className="panel-link" href={navigation.return_href ?? '/context'} prefetch={false}>
          {navigation.return_href?.startsWith('/context/packs?') ||
          navigation.return_href === '/context/packs'
            ? 'Back to saved packs'
            : 'Back to context'}
        </Link>
      </div>
      <Panel title="Choose two saved packs" icon="context">
        <div className="side-detail">
          <Link
            className="panel-link"
            prefetch={false}
            href={packDirectoryHref({
              query: { limit: 25 },
              base_pack_id: navigation.from_pack_id,
            })}
          >
            Choose from saved packs
          </Link>
          <form
            action="/context/packs/compare"
            method="get"
            className="artifact-lookup-form"
            key={JSON.stringify(navigation)}
          >
            {navigation.return_href && (
              <input type="hidden" name="return_to" value={navigation.return_href} />
            )}
            <label htmlFor="pack-compare-from">Base pack ID</label>
            <input
              id="pack-compare-from"
              name="from"
              type="text"
              required
              maxLength={26}
              pattern="[0-9A-HJKMNP-TV-Z]{26}"
              defaultValue={navigation.from_pack_id ?? ''}
            />
            <label htmlFor="pack-compare-to">Comparison pack ID</label>
            <input
              id="pack-compare-to"
              name="to"
              type="text"
              required
              maxLength={26}
              pattern="[0-9A-HJKMNP-TV-Z]{26}"
              defaultValue={navigation.to_pack_id ?? ''}
            />
            <label htmlFor="pack-compare-show">Display</label>
            <select id="pack-compare-show" name="show" defaultValue={navigation.show ?? 'all'}>
              <option value="all">All candidates and fields</option>
              <option value="changes">Changes only</option>
            </select>
            <label htmlFor="pack-compare-query">Find candidate ID or saved text (optional)</label>
            <input
              id="pack-compare-query"
              name="q"
              type="search"
              maxLength={256}
              defaultValue={navigation.query ?? ''}
              aria-describedby="pack-compare-query-help"
            />
            <p id="pack-compare-query-help" className="muted">
              Finds candidate IDs, included content or exclusion reason codes from either saved
              pack, ignoring case. Pack information and source comparisons keep their original
              scope.
            </p>
            <p className="muted">
              Choose two different saved pack IDs in this project. Both must still be readable;
              expired or stale packs are not replaced with newer ones.
            </p>
            <button type="submit" className="primary-button">
              Compare saved packs
            </button>
          </form>
        </div>
      </Panel>
      {failure !== undefined ? (
        <PageError error={failure} />
      ) : query ? (
        <Comparison query={query} navigation={navigation} />
      ) : (
        <p className="side-detail">Choose both pack IDs to load the comparison.</p>
      )}
    </>
  );
}

async function Comparison({
  query,
  navigation,
}: {
  query: ContextPackComparisonQuery;
  navigation: PackComparisonNavigation;
}) {
  try {
    const { from, to, comparison } = await getWorkbenchContextPackComparison(query);
    const changesOnly = navigation.show === 'changes';
    const needle = navigation.query?.toLowerCase() ?? '';
    // Filter only the finished report; both complete packs have already passed their read checks.
    const matches = comparison.candidates.filter(
      (row) =>
        row.id.toLowerCase().includes(needle) ||
        candidateMatches(row.before, needle) ||
        candidateMatches(row.after, needle),
    );
    const rows = matches.filter((row) => !changesOnly || row.status !== 'same');
    const fields = comparison.fields.filter((field) => !changesOnly || field.changed);
    const { show: _show, ...selection } = navigation;
    const { query: _candidateQuery, ...unfiltered } = navigation;
    const controls = (
      <nav className="heading-actions" aria-label="Saved pack comparison display">
        <Link
          className="panel-link"
          href={packComparisonHref(selection)}
          prefetch={false}
          aria-current={!changesOnly ? 'page' : undefined}
        >
          Show all
        </Link>
        <Link
          className="panel-link"
          href={packComparisonHref({ ...selection, show: 'changes' })}
          prefetch={false}
          aria-current={changesOnly ? 'page' : undefined}
        >
          Changes only
        </Link>
        <Link
          className="panel-link"
          href={packComparisonHref({
            ...navigation,
            from_pack_id: query.to_pack_id,
            to_pack_id: query.from_pack_id,
          })}
          prefetch={false}
        >
          Reverse comparison
        </Link>
      </nav>
    );
    return (
      <>
        <Panel title={`Saved version ${from.data.version} → ${to.data.version}`} icon="context">
          <div className="side-detail">
            {controls}
            <p>
              {comparison.counts.added} added candidates, {comparison.counts.removed} removed,{' '}
              {comparison.counts.changed} changed and {comparison.counts.same} unchanged.
            </p>
            <p className="muted">
              Added and removed refer to the saved candidate lists, not deletion of project
              knowledge. Moving between selected and excluded is a selection change. Order is
              compared within each list.
            </p>
            <nav className="heading-actions" aria-label="Compared saved packs">
              <Link
                className="panel-link"
                href={packReadHref({
                  pack_id: query.from_pack_id,
                  return_href: packComparisonHref(navigation),
                })}
                prefetch={false}
              >
                Open base pack
              </Link>
              <Link
                className="panel-link"
                href={packReadHref({
                  pack_id: query.to_pack_id,
                  return_href: packComparisonHref(navigation),
                })}
                prefetch={false}
              >
                Open comparison pack
              </Link>
              <a className="panel-link" href="#pack-candidates">
                Candidate changes
              </a>
              <a className="panel-link" href="#pack-sources">
                Sources
              </a>
            </nav>
            <p className="muted">
              Each complete pack passed its read checks and saved hash check. The two reads are
              separate observations and do not guarantee that sources remain available.
            </p>
          </div>
          <div className="table-wrap">
            <table className="data-table context-comparison-table">
              <caption>Saved pack information{changesOnly ? ' · changed fields only' : ''}</caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Base</th>
                  <th scope="col">Comparison</th>
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
        </Panel>
        <div id="pack-candidates" className="context-comparison-section" tabIndex={-1}>
          <Panel title="Saved candidate changes" icon="context">
            <div className="side-detail">
              <form
                action="/context/packs/compare"
                method="get"
                className="artifact-lookup-form"
                key={JSON.stringify(navigation)}
              >
                <input type="hidden" name="from" value={query.from_pack_id} />
                <input type="hidden" name="to" value={query.to_pack_id} />
                {navigation.show && <input type="hidden" name="show" value={navigation.show} />}
                {navigation.return_href && (
                  <input type="hidden" name="return_to" value={navigation.return_href} />
                )}
                <label htmlFor="pack-candidate-query">Find in compared candidates</label>
                <input
                  id="pack-candidate-query"
                  name="q"
                  type="search"
                  maxLength={256}
                  defaultValue={navigation.query ?? ''}
                  aria-describedby="pack-candidate-query-help"
                />
                <button type="submit" className="primary-button">
                  Find in these saved packs
                </button>
              </form>
              <p id="pack-candidate-query-help" className="muted">
                Searches candidate IDs and saved content or exclusion reason codes on either side.
                It keeps these two pack IDs and the current display mode. Differences, positions and
                the totals above are computed from both complete packs.
              </p>
              <p>
                {matches.length} of {comparison.candidates.length} candidates match the text;{' '}
                {rows.length} shown in this view.
                {changesOnly &&
                  matches.length > rows.length &&
                  ` ${matches.length - rows.length} matching unchanged candidates are hidden.`}
              </p>
              {(navigation.query !== undefined ||
                (changesOnly && matches.length > rows.length)) && (
                <nav className="heading-actions" aria-label="Saved candidate search results">
                  {navigation.query && (
                    <Link
                      className="panel-link"
                      href={packComparisonHref(unfiltered)}
                      prefetch={false}
                    >
                      Clear candidate text filter
                    </Link>
                  )}
                  {changesOnly && matches.length > rows.length && (
                    <Link
                      className="panel-link"
                      href={packComparisonHref(selection)}
                      prefetch={false}
                    >
                      Show all matching candidates
                    </Link>
                  )}
                </nav>
              )}
              {rows.length === 0 && (
                <p>
                  {comparison.candidates.length === 0
                    ? 'Both packs have empty candidate lists.'
                    : matches.length === 0
                      ? 'No saved candidates match this text. Clear the text filter to inspect other candidates.'
                      : 'Matching candidates are unchanged and hidden by Changes only. Pack information or aggregate sources may still differ.'}
                </p>
              )}
              {rows.map((row) => (
                <details key={row.id} className="side-detail">
                  <summary>
                    <span className="context-hash">{row.id}</span> · {row.status}
                    {row.differences.length ? ' · ' + row.differences.join(', ') : ''}
                  </summary>
                  <div className="context-comparison-values">
                    <Candidate title="Base" value={row.before} />
                    <Candidate title="Comparison" value={row.after} />
                  </div>
                </details>
              ))}
            </div>
          </Panel>
        </div>
        <div id="pack-sources" className="context-comparison-section" tabIndex={-1}>
          <Panel
            title="Aggregate sources"
            icon="context"
            action={
              <Badge tone={comparison.sources.changed ? 'yellow' : 'neutral'}>
                {comparison.sources.changed ? 'Changed' : 'Same'}
              </Badge>
            }
          >
            <div className="side-detail">
              <p className="muted">
                Complete saved source references, in their original order. These references do not
                verify external evidence.
              </p>
              {changesOnly && !comparison.sources.changed ? (
                <p>Sources match. Choose Show all to read them.</p>
              ) : (
                <div className="context-comparison-values">
                  <div>
                    <h3>Base</h3>
                    <pre className="context-content" tabIndex={0}>
                      {JSON.stringify(comparison.sources.before, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <h3>Comparison</h3>
                    <pre className="context-content" tabIndex={0}>
                      {JSON.stringify(comparison.sources.after, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
              <details>
                <summary>Read information</summary>
                <p className="context-hash">
                  Project: {comparison.scope.project_id}
                  <br />
                  Base read: {from.trace_id}
                  <br />
                  Comparison read: {to.trace_id}
                </p>
              </details>
            </div>
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    const params = new URLSearchParams(packComparisonHref(navigation).split('?')[1]);
    return (
      <>
        <PageError error={error} />
        <p className="side-detail">
          The full comparison could not be completed. Retry the same saved IDs or change the
          selection above.
        </p>
        <nav className="heading-actions" aria-label="Read compared packs">
          <Link
            className="panel-link"
            prefetch={false}
            href={packReadHref({
              pack_id: query.from_pack_id,
              return_href: packComparisonHref(navigation),
            })}
          >
            Read base pack
          </Link>
          <Link
            className="panel-link"
            prefetch={false}
            href={packReadHref({
              pack_id: query.to_pack_id,
              return_href: packComparisonHref(navigation),
            })}
          >
            Read comparison pack
          </Link>
        </nav>
        <form action="/context/packs/compare" method="get">
          {Array.from(params).map(([name, value]) => (
            <input key={name} name={name} value={value} type="hidden" />
          ))}
          <button className="secondary-button" type="submit">
            Retry these saved packs
          </button>
        </form>
      </>
    );
  }
}

function candidateMatches(value: SavedPackCandidate, needle: string): boolean {
  if (value.state === 'selected') return value.item.content.toLowerCase().includes(needle);
  if (value.state === 'excluded') return value.exclusion.reason.toLowerCase().includes(needle);
  return false;
}

function Candidate({ title, value }: { title: string; value: SavedPackCandidate }) {
  return (
    <div>
      <h3>{title}</h3>
      {value.state === 'absent' ? (
        <p>Not in this saved candidate list.</p>
      ) : (
        <>
          <p>
            {value.state === 'selected' ? 'Selected' : 'Excluded'} · position {value.position}
          </p>
          {value.state === 'selected' ? (
            <pre className="context-content" tabIndex={0} aria-label={title + ' saved content'}>
              {value.item.content}
            </pre>
          ) : (
            <p>Reason: {value.exclusion.reason}</p>
          )}
          <details>
            <summary>Complete saved candidate</summary>
            <pre
              className="context-content"
              tabIndex={0}
              aria-label={title + ' complete saved candidate'}
            >
              {JSON.stringify(value.state === 'selected' ? value.item : value.exclusion, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
