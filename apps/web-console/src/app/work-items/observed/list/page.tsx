import Link from 'next/link';
import type { ReactNode } from 'react';
import { parseObservedWorkItemListQuery } from '@planemem/contracts';
import { PageError } from '../../../../components/page-state';
import { Badge, EmptyState, Panel } from '../../../../components/ui';
import { listWorkbenchObservedWorkItems } from '../../../../lib/server-api';

export default async function ObservedWorkItemDirectory({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let content: ReactNode;
  const selectedState =
    typeof params.state === 'string' && ['active', 'deleted', 'all'].includes(params.state)
      ? params.state
      : 'active';
  const inputQuery = typeof params.q === 'string' ? params.q : '';
  const href = (state: string, query: string, cursor?: string) => {
    const search = new URLSearchParams({ state });
    if (query) search.set('q', query);
    if (cursor) search.set('cursor', cursor);
    return '/work-items/observed/list?' + search;
  };
  try {
    if (Object.keys(params).some((key) => !['q', 'state', 'cursor'].includes(key)))
      throw new Error('Use a search query, state filter and an optional page cursor.');
    const query = parseObservedWorkItemListQuery({
      query: params.q ?? '',
      state: params.state ?? 'active',
      limit: 25,
      ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    });
    const result = await listWorkbenchObservedWorkItems(query);
    const page = result.data;
    content = (
      <>
        <Panel
          title="Saved observations"
          icon="work"
          action={<Badge>{page.items.length} on this page</Badge>}
        >
          {page.items.length ? (
            <div className="side-detail">
              {page.items.map((item) => (
                <article
                  className="proposal"
                  key={item.external_id}
                  style={{ overflowWrap: 'anywhere' }}
                >
                  <h3>
                    <Link
                      href={
                        '/work-items/observed?' +
                        new URLSearchParams({
                          item: item.external_id,
                          list_query: query.query,
                          list_state: query.state,
                          ...(query.cursor ? { list_cursor: query.cursor } : {}),
                        })
                      }
                      prefetch={false}
                    >
                      {item.state === 'deleted' ? item.external_id : item.title}
                    </Link>
                  </h3>
                  <div className="drawer-badges">
                    <Badge tone={item.state === 'deleted' ? 'red' : 'green'}>
                      {item.state === 'deleted' ? 'Deleted observation' : 'Active observation'}
                    </Badge>
                    {item.event_type === 'WorkItemRestored' ? (
                      <Badge tone="green">Restored observation</Badge>
                    ) : null}
                    <Badge>{item.classification}</Badge>
                    {item.status ? <Badge>{item.status}</Badge> : null}
                  </div>
                  <p>
                    {item.external_id} · Observed version {item.plane_version}
                  </p>
                  <p className="muted">
                    Source observation time (UTC):{' '}
                    <time dateTime={item.observed_at}>{item.observed_at}</time>
                  </p>
                  {item.deleted_at ? (
                    <p>
                      This deletion marker contains no saved title or status. Open the observation
                      to read its source.
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No visible observations on this page"
              message="No current observations match this filter and your access. This does not confirm that Plane has no work items or that synchronization is complete."
            />
          )}
        </Panel>
        <div className="filters">
          {query.cursor ? (
            <Link className="panel-link" href={href(query.state, query.query)} prefetch={false}>
              Return to first page
            </Link>
          ) : null}
          {page.next_cursor ? (
            <Link
              className="secondary-button"
              href={href(query.state, query.query, page.next_cursor)}
              prefetch={false}
            >
              Next page
            </Link>
          ) : null}
        </div>
        <p className="muted">
          Read at {page.checked_at} · Trace {result.trace_id}
        </p>
      </>
    );
  } catch (error) {
    content = <PageError error={error} />;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Plane observations</h1>
          <p>Browse saved work item observations in the current project.</p>
        </div>
        <div className="heading-actions">
          <Link className="panel-link" href="/work-items/observed" prefetch={false}>
            Find by ID
          </Link>
          <Link className="panel-link" href="/work-items" prefetch={false}>
            Local work items
          </Link>
        </div>
      </div>
      <form
        className="filters"
        action="/work-items/observed/list"
        method="get"
        key={JSON.stringify([selectedState, inputQuery])}
      >
        <label className="filter-input">
          <span>Find by title or ID</span>
          <input
            type="search"
            name="q"
            defaultValue={inputQuery}
            maxLength={500}
            placeholder="Title, external ID or aggregate ID"
            aria-describedby="observed-search-help"
          />
        </label>
        <label>
          <span>Observation state</span>{' '}
          <select name="state" defaultValue={selectedState}>
            <option value="active">Active</option>
            <option value="deleted">Deleted</option>
            <option value="all">All</option>
          </select>
        </label>
        <button className="secondary-button" type="submit">
          Apply filter
        </button>
        <Link className="panel-link" href="/work-items/observed/list" prefetch={false}>
          Reset
        </Link>
      </form>
      <p id="observed-search-help" className="muted">
        Search matches literal text in IDs and the displayed active title, ignoring English letter
        case. Deleted observations can be found by ID. Changing either filter starts at the first
        page.
      </p>
      <p className="muted">
        These are saved Plane observations, separate from local work item records. Active entries
        appear while their saved content remains available. Titles and status labels may be
        shortened; open an observation for its saved fields. Each page uses current access and
        availability, so records can change between pages.
      </p>
      {content}
    </>
  );
}
