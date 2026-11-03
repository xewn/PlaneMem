import Link from 'next/link';
import { parseLegacyContextStatusQuery } from '@planemem/contracts';
import { PageError } from '../../../../components/page-state';
import { Panel } from '../../../../components/ui';
import { getWorkbenchLegacyIndex } from '../../../../lib/server-api';
import { IndexManager } from './form';

export default async function IndexDetailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const query = parseLegacyContextStatusQuery(await searchParams);
    const result = await getWorkbenchLegacyIndex(query.id);
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Index details</h1>
            <p>Review the local index state and manage its availability.</p>
          </div>
        </div>
        <nav className="heading-actions" aria-label="Related pages in new tabs">
          <Link
            className="panel-link"
            href="/context/index"
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Index directory ↗
          </Link>
          <Link
            className="panel-link"
            href="/context"
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Context items ↗
          </Link>
        </nav>
        <Panel title="Index metadata" icon="context">
          <IndexManager
            key={JSON.stringify(result.index_identity) + query.id}
            initial={result.data}
            identity={result.index_identity}
            canWrite={result.index_permissions.write}
            initialKey={crypto.randomUUID()}
          />
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Index details</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/context/index">
          Browse indexes
        </Link>
      </>
    );
  }
}
