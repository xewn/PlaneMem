import Link from 'next/link';
import { parseProjectSearchQuery } from '@planemem/contracts';
import { PageError, toneFor } from '../../components/page-state';
import { Badge, Panel } from '../../components/ui';
import { searchWorkbenchProject } from '../../lib/server-api';

export default async function ProjectSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (
      Object.keys(params).some(
        (key) => !['q', 'type', 'mode', 'inactive', 'cursor'].includes(key),
      ) ||
      Object.values(params).some((value) => Array.isArray(value))
    )
      throw new Error('Use one value per search filter.');
    const text = typeof params.q === 'string' ? params.q : '';
    if (text.length > 500 || /[\u0000\p{Cs}]/u.test(text))
      throw new Error('Search text must be at most 500 characters.');
    const type = params.type ?? 'all',
      mode = params.mode ?? 'fts';
    if (
      !['all', 'work_item', 'context_item'].includes(String(type)) ||
      !['fts', 'substring'].includes(String(mode)) ||
      (params.inactive !== undefined && params.inactive !== 'true')
    )
      throw new Error('Invalid search filters.');
    const inactive = params.inactive === 'true';
    const query = text.trim()
      ? parseProjectSearchQuery({
          query: text,
          type,
          mode,
          include_inactive_context: inactive,
          limit: 20,
          ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
        })
      : undefined;
    if (!query && params.cursor !== undefined)
      throw new Error('Enter a search query before continuing a page.');
    const result = query ? await searchWorkbenchProject(query) : undefined;
    const page = result?.data;
    function pageHref(cursor?: string) {
      const search = new URLSearchParams({
        q: query?.query ?? '',
        type: String(type),
        mode: String(mode),
      });
      if (inactive) search.set('inactive', 'true');
      if (cursor) search.set('cursor', cursor);
      return '/search?' + search.toString();
    }
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Project Search</h1>
            <p>Find saved work items and context in the current project.</p>
          </div>
        </div>
        <form
          className="filters work-item-filters"
          role="search"
          action="/search"
          method="get"
          key={JSON.stringify([text, type, mode, inactive])}
        >
          <label className="filter-input">
            <input
              type="search"
              name="q"
              defaultValue={text}
              required
              maxLength={500}
              placeholder="Search project records…"
              aria-label="Search text"
            />
          </label>
          <select
            className="filter-chip"
            name="type"
            defaultValue={String(type)}
            aria-label="Record type"
          >
            <option value="all">Work items and context</option>
            <option value="work_item">Work items</option>
            <option value="context_item">Context</option>
          </select>
          <select
            className="filter-chip"
            name="mode"
            defaultValue={String(mode)}
            aria-label="Search method"
          >
            <option value="fts">Match words</option>
            <option value="substring">Contains text</option>
          </select>
          <label>
            <input type="checkbox" name="inactive" value="true" defaultChecked={inactive} /> Include
            expired and excluded context
          </label>
          <button className="primary-button" type="submit">
            Search
          </button>
        </form>
        <p className="muted">
          Use Contains text for partial names or text that word matching misses. Archived records
          stay out of results.
        </p>
        <Panel
          title={page ? `${page.hits.length} results on this page` : 'Search saved records'}
          icon="search"
        >
          {!page ? (
            <div className="empty-state">
              <h3>Enter a query to search this project</h3>
            </div>
          ) : (
            <div className="side-detail">
              <p>
                Saved record matches do not confirm source freshness or review readiness. Open a
                result to read its current details.
              </p>
              {page.hits.length === 0 ? (
                <div className="empty-state">
                  <h3>{query?.cursor ? 'No more matches on this page' : 'No matching records'}</h3>
                  <p>Change the text or filters, or try Contains text.</p>
                </div>
              ) : null}
              {page.hits.map((hit) => (
                <article className="proposal" key={`${hit.type}:${hit.id}`}>
                  <div className="drawer-badges">
                    <Badge tone="cyan">{hit.type === 'work_item' ? 'Work item' : 'Context'}</Badge>
                    <Badge tone={toneFor(hit.status)}>{hit.status}</Badge>
                    <Badge>{hit.classification}</Badge>
                  </div>
                  <h2>
                    <Link
                      href={{
                        pathname: hit.type === 'work_item' ? '/work-items/detail' : '/context',
                        query: { item: hit.id },
                      }}
                      prefetch={false}
                    >
                      {hit.title}
                    </Link>
                  </h2>
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {hit.snippet || 'No text excerpt recorded.'}
                  </p>
                  <p className="muted">
                    Local version {hit.version} · Updated {hit.updated_at}
                    {hit.expires_at ? ` · Expires ${hit.expires_at}` : ''}
                  </p>
                  <details>
                    <summary>{hit.source_refs.length} recorded sources</summary>
                    {hit.source_refs.length ? (
                      <ul>
                        {hit.source_refs.map((ref, index) => (
                          <li key={index} style={{ overflowWrap: 'anywhere' }}>
                            {ref.type} · {ref.id}
                            {ref.revision === undefined ? '' : ` · revision ${ref.revision}`}
                            {ref.uri ? ` · ${ref.uri}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No sources recorded.</p>
                    )}
                  </details>
                </article>
              ))}
              <nav className="heading-actions" aria-label="Search pages">
                {query?.cursor ? (
                  <Link className="panel-link" href={pageHref()} prefetch={false}>
                    First page
                  </Link>
                ) : null}
                {page.next_cursor ? (
                  <Link className="panel-link" href={pageHref(page.next_cursor)} prefetch={false}>
                    Next page
                  </Link>
                ) : null}
              </nav>
              <p className="muted">Trace {result?.trace_id}</p>
            </div>
          )}
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Project Search</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/search">
          Start a new search
        </Link>
      </>
    );
  }
}
