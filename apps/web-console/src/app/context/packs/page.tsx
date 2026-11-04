import Link from 'next/link';
import { PageError } from '../../../components/page-state';
import { Panel } from '../../../components/ui';
import { getWorkbenchContextPackDirectory } from '../../../lib/context-pack-directory-server';
import type { ContextSearchParams } from '../navigation';
import { packReadHref } from './read/navigation';
import { packComparisonHref } from './compare/navigation';
import {
  packDirectoryHref,
  parsePackDirectoryParams,
  type PackDirectoryNavigation,
} from './navigation';

export const dynamic = 'force-dynamic';
export default async function SavedPacksPage({
  searchParams,
}: {
  searchParams: Promise<ContextSearchParams>;
}) {
  let navigation: PackDirectoryNavigation;
  try {
    navigation = parsePackDirectoryParams(await searchParams);
  } catch (error) {
    return (
      <>
        <h1>Saved packs</h1>
        <PageError error={error} />
        <Link href="/context/packs" prefetch={false}>
          Restart saved pack browsing
        </Link>
      </>
    );
  }
  const { cursor: _cursor, ...filters } = navigation.query;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Saved packs</h1>
          <p>Find a saved pack to read or compare.</p>
        </div>
        <Link className="panel-link" href="/context" prefetch={false}>
          Back to context
        </Link>
      </div>
      <Panel title="Find saved packs" icon="context">
        <form
          className="artifact-lookup-form side-detail"
          action="/context/packs"
          method="get"
          key={JSON.stringify(navigation)}
        >
          {navigation.base_pack_id && (
            <input name="base" type="hidden" value={navigation.base_pack_id} />
          )}
          <label htmlFor="pack-filter">Exact pack ID (optional)</label>
          <input
            id="pack-filter"
            name="pack"
            maxLength={26}
            pattern="[0-9A-HJKMNP-TV-Z]{26}"
            defaultValue={filters.pack_id ?? ''}
          />
          <label htmlFor="pack-page-size">Packs per page</label>
          <input
            id="pack-page-size"
            name="limit"
            type="number"
            min={1}
            max={100}
            required
            defaultValue={filters.limit}
          />
          <button className="primary-button" type="submit">
            Find packs
          </button>
        </form>
        <div className="side-detail">
          <p className="muted">
            This list shows saved information only. Opening a pack checks its content and current
            sources; expired or changed packs may be unavailable.
          </p>
          {navigation.base_pack_id && (
            <>
              <p className="context-hash">Comparison base: {navigation.base_pack_id}</p>
              <Link
                className="panel-link"
                href={packDirectoryHref({ query: navigation.query })}
                prefetch={false}
              >
                Clear base selection
              </Link>
            </>
          )}
          <Link
            className="panel-link"
            href={packReadHref({ return_href: packDirectoryHref(navigation) })}
            prefetch={false}
          >
            Open a pack by ID or read latest
          </Link>
        </div>
      </Panel>
      <Directory navigation={navigation} />
    </>
  );
}
async function Directory({ navigation }: { navigation: PackDirectoryNavigation }) {
  const { cursor: _cursor, ...filters } = navigation.query;
  const returnHref = packDirectoryHref(navigation);
  try {
    const page = await getWorkbenchContextPackDirectory(navigation.query);
    return (
      <Panel title="Saved pack records" icon="context">
        <div className="side-detail">
          <p>{page.data.length} records on this page, newest saved version first.</p>
          {page.data.length === 0 && (
            <p>
              No saved pack metadata matches this page. Change the filter or return to the first
              page.
            </p>
          )}
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Pack</th>
                <th scope="col">Saved</th>
                <th scope="col">Expires</th>
                <th scope="col">Content tokens</th>
                <th scope="col">Comparison</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((pack) => (
                <tr key={pack.pack_id}>
                  <th scope="row">
                    <Link
                      className="panel-link context-hash"
                      prefetch={false}
                      href={packReadHref({ pack_id: pack.pack_id, return_href: returnHref })}
                    >
                      {pack.pack_id}
                    </Link>
                    <p>Version {pack.version}</p>
                  </th>
                  <td>{pack.created_at}</td>
                  <td>{pack.expires_at}</td>
                  <td>
                    {pack.used_tokens} / {pack.budget_tokens}
                  </td>
                  <td>
                    {navigation.base_pack_id === pack.pack_id ? (
                      <span>Selected base</span>
                    ) : (
                      <>
                        <Link
                          className="panel-link"
                          prefetch={false}
                          href={packDirectoryHref({ ...navigation, base_pack_id: pack.pack_id })}
                        >
                          Use as base
                        </Link>
                        {navigation.base_pack_id && (
                          <Link
                            className="panel-link"
                            prefetch={false}
                            href={packComparisonHref({
                              from_pack_id: navigation.base_pack_id,
                              to_pack_id: pack.pack_id,
                              return_href: returnHref,
                            })}
                          >
                            Compare with base
                          </Link>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav className="heading-actions side-detail" aria-label="Saved pack pages">
          <Link
            className="panel-link"
            prefetch={false}
            href={packDirectoryHref({ ...navigation, query: filters })}
          >
            First page with these filters
          </Link>
          {page.next_cursor && (
            <Link
              className="panel-link"
              prefetch={false}
              href={packDirectoryHref({
                ...navigation,
                query: { ...filters, cursor: page.next_cursor },
              })}
            >
              Next page
            </Link>
          )}
        </nav>
      </Panel>
    );
  } catch (error) {
    const params = new URLSearchParams(returnHref.split('?')[1]);
    return (
      <>
        <PageError error={error} />
        <form action="/context/packs" method="get">
          {Array.from(params).map(([name, value]) => (
            <input key={name} name={name} value={value} type="hidden" />
          ))}
          <button type="submit" className="secondary-button">
            Retry this pack list
          </button>
        </form>
        <Link
          className="panel-link"
          prefetch={false}
          href={packDirectoryHref({ ...navigation, query: filters })}
        >
          Restart with these filters
        </Link>
      </>
    );
  }
}
