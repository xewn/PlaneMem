import Link from 'next/link';
import type { ReactNode } from 'react';
import { parsePlaneInboxListQuery } from '@planemem/contracts';
import { PageError } from '../../../components/page-state';
import { PlaneEventStatus, planeEventExplanation } from '../../../components/plane-event-state';
import { Badge, EmptyState, Panel } from '../../../components/ui';
import { getWorkbenchPlaneInboxSummary, listWorkbenchPlaneEvents } from '../../../lib/server-api';
import { PlaneQueueOverview } from './summary';

export default async function PlaneEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let content: ReactNode;
  let overview: ReactNode = null;
  try {
    if (
      Object.keys(params).some(
        (key) => !['status', 'pending_state', 'aggregate_id', 'cursor'].includes(key),
      ) ||
      Object.values(params).some(Array.isArray)
    )
      throw new Error('Use one value per event filter.');
    const query = parsePlaneInboxListQuery({
      status: params.status ?? 'all',
      pending_state: params.pending_state ?? 'all',
      limit: 25,
      ...(params.aggregate_id === undefined || params.aggregate_id === ''
        ? {}
        : { aggregate_id: params.aggregate_id }),
      ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    });
    const [listed, summarized] = await Promise.allSettled([
      listWorkbenchPlaneEvents(query),
      getWorkbenchPlaneInboxSummary(),
    ]);
    if (summarized.status === 'fulfilled') {
      const result = summarized.value;
      if (
        listed.status === 'fulfilled' &&
        (listed.value.data.scope.tenant_id !== result.data.scope.tenant_id ||
          listed.value.data.scope.workspace_id !== result.data.scope.workspace_id ||
          listed.value.data.scope.project_id !== result.data.scope.project_id)
      )
        throw new Error('The project changed between queue reads. Refresh from the first page.');
      overview = <PlaneQueueOverview summary={result.data} trace={result.trace_id} />;
    } else {
      overview = (
        <Panel title="Queue overview unavailable">
          <PageError error={summarized.reason} />
        </Panel>
      );
    }
    if (listed.status === 'rejected') throw listed.reason;
    const result = listed.value;
    const page = result.data;
    function href(cursor?: string) {
      const search = new URLSearchParams({
        status: query.status,
        pending_state: query.pending_state,
      });
      if (query.aggregate_id) search.set('aggregate_id', query.aggregate_id);
      if (cursor) search.set('cursor', cursor);
      return '/admin/plane-events?' + search;
    }
    content = (
      <Panel title={`${page.items.length} events on this page`} icon="activity">
        <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
          {!page.items.length ? (
            <EmptyState
              title="No visible events on this page"
              message="Try another status, pending filter or aggregate ID, or return to the first page. Only receipts visible in your current project are included."
            />
          ) : null}
          {page.items.map((item) => (
            <article className="proposal" key={item.event_id}>
              <div className="drawer-badges">
                <PlaneEventStatus status={item.status} />
                <Badge>{item.classification}</Badge>
              </div>
              <h2>
                <Link
                  href={{ pathname: '/admin/plane-events/detail', query: { event: item.event_id } }}
                  prefetch={false}
                >
                  {item.event_type ?? 'Unknown event type'}
                </Link>
              </h2>
              <p>Event {item.event_id}</p>
              <p>
                {item.aggregate_type === 'project' ? 'Project' : 'Work item'} · {item.aggregate_id}{' '}
                · Version {item.aggregate_version}
              </p>
              <p>{planeEventExplanation(item)}</p>
              <p className="muted">
                Processing attempts: {item.attempts} · Received {item.received_at}
              </p>
              {item.status === 'pending' ? (
                <p className="muted">
                  Scheduled attempt {item.next_attempt_at} · Checked {item.checked_at}
                </p>
              ) : null}
              {item.last_error_code ? (
                <p>
                  <code>{item.last_error_code}</code>
                </p>
              ) : null}
            </article>
          ))}
          <nav className="heading-actions" aria-label="Event queue pages">
            <Link className="panel-link" href={href()} prefetch={false}>
              Refresh from first page
            </Link>
            {page.next_cursor ? (
              <Link className="panel-link" href={href(page.next_cursor)} prefetch={false}>
                Next page
              </Link>
            ) : null}
          </nav>
          <p className="muted">
            Event IDs are ordered descending. Pages reflect current data, so processing and access
            changes can change the list while browsing. Due and delayed filters use the time of each
            read; return to the first page to see newly matching events. Read trace:{' '}
            {result.trace_id}
          </p>
        </div>
      </Panel>
    );
  } catch (error) {
    content = <PageError error={error} />;
  }
  const status = typeof params.status === 'string' ? params.status : 'all';
  const pendingState = typeof params.pending_state === 'string' ? params.pending_state : 'all';
  const aggregateId = typeof params.aggregate_id === 'string' ? params.aggregate_id : '';
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Plane event queue</h1>
          <p>Saved event processing receipts in the current project.</p>
        </div>
        <Link className="panel-link" href="/admin">
          Back to admin
        </Link>
      </div>
      {overview}
      <form
        className="filters work-item-filters"
        action="/admin/plane-events"
        method="get"
        key={JSON.stringify([status, pendingState, aggregateId])}
      >
        <select
          className="filter-chip"
          name="status"
          defaultValue={status}
          aria-label="Processing status"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="applied">Processed</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          className="filter-chip"
          name="pending_state"
          defaultValue={pendingState}
          aria-label="Pending event filter"
          aria-describedby="pending-filter-help"
        >
          <option value="all">No pending filter</option>
          <option value="due">Pending: due now</option>
          <option value="delayed">Pending: scheduled later</option>
          <option value="version_gap">Pending: recorded version gap</option>
        </select>
        <label className="filter-input">
          <input
            name="aggregate_id"
            defaultValue={aggregateId}
            maxLength={26}
            placeholder="Aggregate ID (optional)"
            aria-label="Aggregate ID"
          />
        </label>
        <button className="secondary-button" type="submit">
          Apply filters
        </button>
        <Link className="panel-link" href="/admin/plane-events" prefetch={false}>
          Clear filters
        </Link>
        <Link className="panel-link" href="/admin/plane-events/detail" prefetch={false}>
          Find by event ID
        </Link>
      </form>
      <p className="muted" id="pending-filter-help">
        Pending filters require All statuses or Pending. A recorded version gap describes the last
        processing attempt; earlier versions may have arrived since then.
      </p>
      <p className="muted">
        Pending means the event was saved but processing is not complete. Rejected events require
        investigation and are not retried automatically.
      </p>
      {content}
    </>
  );
}
