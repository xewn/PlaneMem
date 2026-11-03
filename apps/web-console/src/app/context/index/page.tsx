import Link from 'next/link';
import { parseLegacyContextListQuery } from '@planemem/contracts';
import { PageError } from '../../../components/page-state';
import { Badge, Panel } from '../../../components/ui';
import { listWorkbenchLegacyIndexes } from '../../../lib/server-api';

export default async function IndexDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (
      Object.keys(params).some((key) => !['q', 'state', 'managed_by', 'cursor'].includes(key)) ||
      Object.values(params).some((value) => Array.isArray(value))
    )
      throw new Error('Use one value per index filter.');
    const query = parseLegacyContextListQuery({
      query: params.q ?? '',
      state: params.state ?? 'all',
      managed_by: params.managed_by ?? 'manual',
      limit: 25,
      ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    });
    const result = await listWorkbenchLegacyIndexes(query);
    const page = result.data;
    function href(cursor?: string) {
      const search = new URLSearchParams({
        q: query.query,
        state: query.state,
        managed_by: query.managed_by,
      });
      if (cursor) search.set('cursor', cursor);
      return '/context/index?' + search;
    }
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Context indexes</h1>
            <p>Find local index records, including expired and deleted entries.</p>
          </div>
          <Link className="secondary-button" href="/context">
            Context items
          </Link>
        </div>
        <form
          className="filters work-item-filters"
          action="/context/index"
          method="get"
          role="search"
          key={JSON.stringify(query)}
        >
          <label className="filter-input">
            <input
              type="search"
              name="q"
              defaultValue={query.query}
              maxLength={500}
              placeholder="Contains index ID…"
              aria-label="Index ID contains"
            />
          </label>
          <select
            className="filter-chip"
            name="state"
            defaultValue={query.state}
            aria-label="Index state"
          >
            <option value="all">All states</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="deleted">Deleted</option>
          </select>
          <select
            className="filter-chip"
            name="managed_by"
            defaultValue={query.managed_by}
            aria-label="Managed by"
          >
            <option value="manual">Manual indexes</option>
            <option value="plane">Plane indexes</option>
            <option value="all">All indexes</option>
          </select>
          <button className="primary-button" type="submit">
            Apply filters
          </button>
          <Link className="panel-link" href={href()} prefetch={false}>
            Refresh from first page
          </Link>
        </form>
        <p className="muted">
          This directory shows metadata for the older context index. Context items and saved packs
          are managed on the Context page. Plane indexes are read-only.
        </p>
        <Panel title={`${page.items.length} indexes on this page`} icon="context">
          <div className="side-detail">
            {page.items.length === 0 && (
              <div className="empty-state">
                <h3>No indexes on this page</h3>
                <p>Try different filters or return to the first page.</p>
              </div>
            )}
            {page.items.map((item) => (
              <article className="proposal" key={item.id}>
                <div className="drawer-badges">
                  <Badge
                    tone={
                      item.state === 'active'
                        ? 'green'
                        : item.state === 'expired'
                          ? 'yellow'
                          : 'neutral'
                    }
                  >
                    {item.state}
                  </Badge>
                  <Badge>{item.classification}</Badge>
                  <Badge>{item.managed_by}</Badge>
                </div>
                <h2 style={{ overflowWrap: 'anywhere' }}>
                  <Link
                    href={{ pathname: '/context/index/detail', query: { id: item.id } }}
                    prefetch={false}
                  >
                    {item.id}
                  </Link>
                </h2>
                <p>
                  Revision {item.revision} · Updated {item.updated_at}
                </p>
                <p className="muted">
                  Expires {item.expires_at ?? 'not set'}
                  {item.deleted_at ? ` · Deleted ${item.deleted_at}` : ''}
                </p>
              </article>
            ))}
            <nav className="heading-actions" aria-label="Index directory pages">
              {query.cursor && (
                <Link className="panel-link" href={href()} prefetch={false}>
                  First page
                </Link>
              )}
              {page.next_cursor && (
                <Link className="panel-link" href={href(page.next_cursor)} prefetch={false}>
                  Next page
                </Link>
              )}
            </nav>
            <p className="muted">
              Pages reflect current data. Deletion, restoration and expiry can change the list while
              browsing. Trace · {result.trace_id}
            </p>
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Context indexes</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/context/index">
          Reset index filters
        </Link>
      </>
    );
  }
}
