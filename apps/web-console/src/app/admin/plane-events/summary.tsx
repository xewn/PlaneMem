import Link from 'next/link';
import type { PlaneInboxSummary } from '@planemem/contracts';
import { Panel } from '../../../components/ui';

export function PlaneQueueOverview({
  summary,
  trace,
}: {
  summary: PlaneInboxSummary;
  trace: string;
}) {
  const { counts } = summary;
  const statuses = [
    { label: 'Visible events', value: counts.total, status: 'all' },
    { label: 'Pending', value: counts.pending, status: 'pending' },
    { label: 'Processed', value: counts.applied, status: 'applied' },
    { label: 'Rejected', value: counts.rejected, status: 'rejected' },
  ];
  const pendingStates = [
    { label: 'Pending and due now', value: counts.due, state: 'due' },
    { label: 'Pending with a later attempt', value: counts.delayed, state: 'delayed' },
    {
      label: 'Pending with a recorded version gap',
      value: counts.version_gap,
      state: 'version_gap',
    },
  ];
  return (
    <Panel title="Visible project queue" icon="activity">
      <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
        <p>
          All events currently visible in this project. The list filters below do not change these
          totals.
        </p>
        <div className="detail-grid">
          {statuses.map(({ label, value, status }) => (
            <div key={status}>
              <small>{label}</small>
              <strong>
                <Link
                  href={{ pathname: '/admin/plane-events', query: { status } }}
                  aria-label={`View ${label.toLowerCase()}: ${value}`}
                  prefetch={false}
                >
                  {value}
                </Link>
              </strong>
            </div>
          ))}
          {pendingStates.map(({ label, value, state }) => (
            <div key={state}>
              <small>{label}</small>
              <strong>
                <Link
                  href={{
                    pathname: '/admin/plane-events',
                    query: { status: 'pending', pending_state: state },
                  }}
                  aria-label={`View ${label.toLowerCase()}: ${value}`}
                  prefetch={false}
                >
                  {value}
                </Link>
              </strong>
            </div>
          ))}
        </div>
        <p>
          Due and later attempts make up the pending total. Version gaps may appear in either group.
          Due events have reached their scheduled time. They may be blocked or already processing
          with a result that has not yet been saved.
        </p>
        <dl>
          <dt>Oldest pending event received (UTC)</dt>
          <dd>{summary.oldest_pending_received_at ?? 'No visible pending events'}</dd>
          <dt>Oldest currently due event received (UTC)</dt>
          <dd>{summary.oldest_due_received_at ?? 'No visible due events'}</dd>
          <dt>Earliest pending scheduled attempt (UTC)</dt>
          <dd>{summary.earliest_pending_attempt_at ?? 'None'}</dd>
          <dt>Latest visible event received (UTC)</dt>
          <dd>{summary.latest_received_at ?? 'No visible events'}</dd>
        </dl>
        <p className="muted">
          Checked {summary.checked_at} · Read trace: {trace}
        </p>
        <p className="muted">
          The overview and list are separate reads and may show different moments. These totals do
          not certify worker health, upstream completeness or current observation availability.
        </p>
      </div>
    </Panel>
  );
}
