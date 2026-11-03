import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  parsePlaneInboxRecordQuery,
  type PlaneInboxRecord,
  type PlaneInboxVersionPosition,
} from '@planemem/contracts';
import { PageError } from '../../../../components/page-state';
import { PlaneEventStatus } from '../../../../components/plane-event-state';
import { EmptyState, Panel } from '../../../../components/ui';
import { getWorkbenchPlaneInboxDiagnosis } from '../../../../lib/server-api';

const explanations: Record<PlaneInboxVersionPosition, string> = {
  deleted_stream:
    'The latest committed observation deleted this work item. An ordinary update cannot restore it, even with a higher version. A restoration observation must reference that deletion.',
  baseline_unavailable:
    'No usable current committed baseline is readable. It may be absent, legacy or unavailable under current access. This does not prove that no event was committed. Initial-stream checks are not evaluated here.',
  ambiguous_stream:
    'Two readable committed receipts claim the highest stream version. Resolve the stream ambiguity before interpreting a next version.',
  already_recorded:
    'This event is the readable current committed baseline. This is historical processing evidence, not proof that its observation is currently available.',
  at_or_behind:
    'This event is at or below another committed event’s version. Scheduling it again does not override the stream’s ordering rules.',
  next_version:
    'This event is the next version after the readable committed baseline. Other processing checks may still block or reject it.',
  gap: 'The target is ahead of the next version required by the readable committed baseline. The interval below has not advanced the committed stream; its events may already be queued.',
};

export default async function PlaneEventDiagnosisPage({
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
        <EmptyState
          title="Choose an event"
          message="Enter the canonical event ID from a saved processing receipt."
        />
      );
    } else {
      const { event_id } = parsePlaneInboxRecordQuery({ event_id: params.event });
      const result = await getWorkbenchPlaneInboxDiagnosis(event_id);
      const diagnosis = result.data;
      const record = diagnosis.record;
      content = (
        <>
          <Panel title="Version comparison" icon="activity">
            <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
              <PlaneEventStatus status={record.status} />
              <p>
                Event {record.event_id} · Version {record.aggregate_version}
              </p>
              <p>
                {record.aggregate_type === 'project' ? 'Project' : 'Work item'} ·{' '}
                {record.aggregate_id}
              </p>
              <p>{explanations[diagnosis.position]}</p>
              {record.event_type === 'WorkItemRestored' ? (
                <p>
                  Version comparison does not check the referenced deletion or the saved deletion
                  snapshot and index. Being next in sequence does not confirm that restoration can
                  succeed.
                </p>
              ) : null}
              {diagnosis.next_version ? (
                <p>
                  Next required committed version: <strong>{diagnosis.next_version}</strong>
                </p>
              ) : null}
              {diagnosis.uncommitted_versions ? (
                <p>
                  Versions before the target still outside the committed stream:{' '}
                  <strong>
                    {diagnosis.uncommitted_versions.from}–{diagnosis.uncommitted_versions.to}
                  </strong>
                  .
                </p>
              ) : null}
              <p>Last recorded error: {record.last_error_code ?? 'None'}.</p>
              <p className="muted">
                Checked {record.checked_at} · Read trace: {result.trace_id}
              </p>
              <p>
                This comparison does not fetch missing events, schedule a retry or verify aliases,
                indexes, permissions or current observation availability.
              </p>
              <Link
                className="panel-link"
                href={{
                  pathname: '/admin/plane-events',
                  query: { aggregate_id: record.aggregate_id },
                }}
                prefetch={false}
              >
                Browse visible events for this aggregate
              </Link>
            </div>
          </Panel>
          <ReceiptGroup
            title="Readable committed baseline"
            items={diagnosis.baseline}
            hasMore={false}
            empty="No usable baseline is available for this diagnosis."
          />
          <ReceiptGroup
            title="Visible receipts for the next required version"
            items={diagnosis.next_version_candidates.items}
            hasMore={diagnosis.next_version_candidates.has_more}
            empty={
              diagnosis.next_version === null
                ? 'No next version is determined by this comparison.'
                : 'No matching receipt is currently visible. This does not prove that the event was never received.'
            }
          />
          <ReceiptGroup
            title="Other visible receipts at the target version"
            items={diagnosis.same_version_candidates.items}
            hasMore={diagnosis.same_version_candidates.has_more}
            empty="No other matching receipt is currently visible."
          />
          <p className="muted">
            All sections use one database snapshot. Candidate lists show at most 10 visible
            receipts, in event ID order. An empty list does not describe hidden records. The
            committed baseline shows at most two receipts to identify ambiguity. Read again for
            current data.
          </p>
        </>
      );
    }
  } catch (error) {
    content = <PageError error={error} />;
  }
  const eventId = typeof params.event === 'string' ? params.event : '';
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Plane event version diagnosis</h1>
          <p>Read-only stream comparison and visible processing candidates.</p>
        </div>
        <Link className="panel-link" href="/admin/plane-events" prefetch={false}>
          Event queue
        </Link>
      </div>
      <form className="filters" action="/admin/plane-events/diagnosis" method="get" key={eventId}>
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
          Read diagnosis
        </button>
      </form>
      {content}
    </>
  );
}

function ReceiptGroup({
  title,
  items,
  hasMore,
  empty,
}: {
  title: string;
  items: PlaneInboxRecord[];
  hasMore: boolean;
  empty: string;
}) {
  return (
    <Panel title={title}>
      <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
        {items.length === 0 ? (
          <p>{empty}</p>
        ) : (
          items.map((item) => (
            <article className="proposal" key={item.event_id}>
              <PlaneEventStatus status={item.status} />
              <p>
                <Link
                  href={{ pathname: '/admin/plane-events/detail', query: { event: item.event_id } }}
                  prefetch={false}
                >
                  {item.event_id}
                </Link>{' '}
                · Version {item.aggregate_version}
              </p>
              <p>
                Queue revision {item.revision} · Attempts {item.attempts}
              </p>
              <p>
                Last error: {item.last_error_code ?? 'None'} · Scheduled attempt:{' '}
                {item.next_attempt_at ?? 'None'}
              </p>
            </article>
          ))
        )}
        {hasMore ? (
          <p>
            More visible candidates exist. Use the aggregate event list to continue investigating.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
