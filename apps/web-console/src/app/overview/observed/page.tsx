import Link from 'next/link';
import type { ReactNode } from 'react';
import { ObservedReadError, ObservedSnapshotView } from '../../../components/observed-snapshot';
import { getWorkbenchObservedProject } from '../../../lib/server-api';

export default async function ObservedProjectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let content: ReactNode;
  try {
    if (Object.keys(await searchParams).length)
      throw new Error(
        'Project observations use the current project and do not accept query parameters.',
      );
    const result = await getWorkbenchObservedProject();
    content = <ObservedSnapshotView snapshot={result.data} trace={result.trace_id} />;
  } catch (error) {
    content = <ObservedReadError error={error} />;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Plane project observation</h1>
          <p>The saved Plane observation for your current project.</p>
        </div>
        <form action="/overview/observed" method="get">
          <button className="secondary-button" type="submit">
            Refresh saved observation
          </button>
        </form>
      </div>
      <nav className="heading-actions" aria-label="Project observation navigation">
        <Link className="panel-link" href="/overview">
          Back to overview
        </Link>
        <Link className="panel-link" href="/work-items/observed" prefetch={false}>
          Find a work item observation
        </Link>
      </nav>
      {content}
    </>
  );
}
