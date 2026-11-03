import Link from 'next/link';
import { parseWorkItemProjectionQuery } from '@planemem/contracts';
import { PageError, toneFor } from '../../../components/page-state';
import { Badge, EmptyState, Panel, Progress } from '../../../components/ui';
import { getWorkbenchWorkItem, WorkbenchApiError } from '../../../lib/server-api';

export default async function WorkItemDetailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (Object.keys(params).some((key) => key !== 'item'))
      throw new Error('Select one work item to read its details.');
    const { item_id } = parseWorkItemProjectionQuery({ item_id: params.item });
    const result = await getWorkbenchWorkItem(item_id);
    const item = result.data;
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Work item details</h1>
            <p>Saved work item information and its recorded sources.</p>
          </div>
          <form action="/work-items/detail" method="get">
            <input type="hidden" name="item" value={item_id} />
            <button className="secondary-button" type="submit">
              Refresh details
            </button>
          </form>
        </div>
        <nav className="heading-actions" aria-label="Work item navigation">
          <Link
            className="panel-link"
            href={{ pathname: '/work-items/observed', query: { item: item.external_id } }}
            prefetch={false}
          >
            Look up Plane observation by this reference
          </Link>
          <Link className="panel-link" href={{ pathname: '/work-items', query: { item: item_id } }}>
            Open in board
          </Link>
          <Link
            className="panel-link"
            href={{ pathname: '/work-items', query: { item: item_id, view: 'list' } }}
          >
            Open in list
          </Link>
        </nav>
        <Panel title={item.external_id} icon="work">
          <div className="side-detail">
            <h2>{item.title}</h2>
            <div className="drawer-badges">
              <Badge tone={toneFor(item.status)}>{item.status.replaceAll('_', ' ')}</Badge>
              <Badge tone={toneFor(item.priority)}>{item.priority}</Badge>
              <Badge>{item.classification}</Badge>
            </div>
            <div className="detail-grid">
              <div>
                <small>Owner</small>
                <strong>{item.owner || '—'}</strong>
              </div>
              <div>
                <small>Due date</small>
                <strong>{item.due_at ?? '—'}</strong>
              </div>
              <div>
                <small>Progress</small>
                <strong>{item.progress}%</strong>
              </div>
              <div>
                <small>Local projection version</small>
                <strong>{item.version}</strong>
              </div>
              <div>
                <small>Created</small>
                <strong>{item.created_at}</strong>
              </div>
              <div>
                <small>Updated</small>
                <strong>{item.updated_at}</strong>
              </div>
              <div>
                <small>Local ID</small>
                <strong>{item.id}</strong>
              </div>
              <div>
                <small>Record trace ID</small>
                <strong>{item.trace_id || '—'}</strong>
              </div>
            </div>
            <Progress value={item.progress} />
            <p>
              This is a saved local snapshot. Its version does not establish the current Plane state
              or a version for updating Plane.
            </p>
            <div className="proposal">
              <h3>Description</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {item.description || 'No description recorded.'}
              </p>
            </div>
          </div>
        </Panel>
        <Panel title="Recorded sources" icon="work">
          <div className="side-detail">
            <p>
              These references were saved with the work item. Their current availability has not
              been checked.
            </p>
            {item.source_refs.length ? (
              <ul>
                {item.source_refs.map((ref, index) => (
                  <li key={index}>
                    <strong>
                      {ref.type} · {ref.id}
                    </strong>
                    {ref.revision === undefined ? null : <p>Recorded revision: {ref.revision}</p>}
                    {ref.uri ? <p style={{ overflowWrap: 'anywhere' }}>{ref.uri}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No source references recorded.</p>
            )}
            <div className="source-line">
              <span>Read trace ID</span>
              <strong>{result.trace_id}</strong>
            </div>
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Work item details</h1>
          <Link className="panel-link" href="/work-items">
            Back to work items
          </Link>
        </div>
        {error instanceof WorkbenchApiError && error.status === 404 ? (
          <Panel title="Work item unavailable" icon="work">
            <EmptyState
              title="Work item not available"
              message="This item is missing or cannot be read in the current project."
              trace={error.trace_id}
            />
          </Panel>
        ) : (
          <PageError error={error} />
        )}
      </>
    );
  }
}
