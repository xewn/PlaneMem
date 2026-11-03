import Link from 'next/link';
import type { ReactNode } from 'react';
import { parsePlaneInboxRecordQuery } from '@planemem/contracts';
import { PageError } from '../../../../components/page-state';
import { PlaneRetryManager } from './form';
import { EmptyState, Panel } from '../../../../components/ui';
import { getWorkbenchPlaneEvent, WorkbenchApiError } from '../../../../lib/server-api';

export default async function PlaneEventDetailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let content: ReactNode;
  try {
    if (Object.keys(params).some((key) => key !== 'event') || Array.isArray(params.event))
      throw new Error('Supply one event ID.');
    if (params.event === undefined) {
      content = (
        <Panel title="Find an event receipt">
          <EmptyState
            title="Enter an event ID"
            message="Use the canonical event ID from the webhook receipt."
          />
        </Panel>
      );
    } else {
      const { event_id } = parsePlaneInboxRecordQuery({ event_id: params.event });
      const result = await getWorkbenchPlaneEvent(event_id);
      const item = result.data;
      content = (
        <Panel title={item.event_type ?? 'Unknown event type'} icon="activity">
          <PlaneRetryManager
            key={JSON.stringify(result.plane_inbox_identity) + item.event_id}
            initial={item}
            identity={result.plane_inbox_identity}
            canRetry={result.plane_inbox_permissions.retry}
            initialKey={crypto.randomUUID()}
          />
        </Panel>
      );
    }
  } catch (error) {
    content =
      error instanceof WorkbenchApiError && error.status === 404 ? (
        <Panel title="Event receipt unavailable">
          <EmptyState
            title="No readable event receipt"
            message="This event is missing or cannot be read in the current project. A missing receipt does not prove that a webhook was never received."
            trace={error.trace_id}
          />
        </Panel>
      ) : (
        <PageError error={error} />
      );
  }
  const eventId = typeof params.event === 'string' ? params.event : '';
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Plane event receipt</h1>
          <p>Saved processing status and retry details.</p>
        </div>
        <Link className="panel-link" href="/admin/plane-events" prefetch={false}>
          Back to event queue
        </Link>
      </div>
      <form className="filters" action="/admin/plane-events/detail" method="get" key={eventId}>
        <label className="filter-input">
          <input
            name="event"
            defaultValue={eventId}
            required
            maxLength={26}
            placeholder="Event ID"
            aria-label="Event ID"
          />
        </label>
        <button className="secondary-button" type="submit">
          Find event
        </button>
      </form>
      {content}
    </>
  );
}
