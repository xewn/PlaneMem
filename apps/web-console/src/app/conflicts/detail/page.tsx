import Link from 'next/link';
import { parseConflictReadQuery } from '@planemem/contracts';
import { PageError } from '../../../components/page-state';
import { Badge, Panel } from '../../../components/ui';
import { getWorkbenchConflict } from '../../../lib/server-api';
import { ConflictLookup } from '../lookup';

export default async function ConflictDetailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Conflict details</h1>
          <p>Compare saved values and inspect the recorded decision.</p>
        </div>
      </div>
      <Link className="panel-link" href="/conflicts" prefetch={false}>
        Open conflict center
      </Link>
      <Detail searchParams={searchParams} />
      <ConflictLookup />
    </>
  );
}
async function Detail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (Object.keys(params).some((key) => key !== 'conflict'))
      throw new Error('Supply only a conflict ID.');
    const query = parseConflictReadQuery({ conflict_id: params.conflict });
    const result = await getWorkbenchConflict(query.conflict_id);
    const row = result.data;
    return (
      <>
        <Panel title="Saved conflict" icon="conflicts">
          <div className="side-detail">
            <Badge tone={row.status === 'open' ? 'red' : 'green'}>{row.status}</Badge>
            <dl className="detail-grid">
              <div>
                <dt>Conflict</dt>
                <dd>{row.conflict_id}</dd>
              </div>
              <div>
                <dt>Entity type</dt>
                <dd>{row.entity_type}</dd>
              </div>
              <div>
                <dt>Entity ID</dt>
                <dd>{row.entity_id}</dd>
              </div>
              <div>
                <dt>Field</dt>
                <dd>{row.field}</dd>
              </div>
              <div>
                <dt>Conflict version</dt>
                <dd>{row.version}</dd>
              </div>
              <div>
                <dt>Base version</dt>
                <dd>{row.base_version}</dd>
              </div>
              <div>
                <dt>Local version</dt>
                <dd>{row.local_version}</dd>
              </div>
              <div>
                <dt>Server version</dt>
                <dd>{row.server_version}</dd>
              </div>
            </dl>
            <p>
              This is a snapshot of the stored conflict. It does not confirm an original resolution
              request or show that a decision was applied to the source entity.
            </p>
            <div className="diff-box">
              <div>
                <span>Local saved value</span>
                <SavedValue json={row.local_value_json} />
              </div>
              <div>
                <span>Server saved value</span>
                <SavedValue json={row.server_value_json} />
              </div>
            </div>
            <p className="muted">
              Saved JSON is displayed as text to preserve large numbers. A saved null is shown as
              null; an unrecorded value is labeled separately.
            </p>
          </div>
        </Panel>
        <Panel title="Decision metadata" icon="conflicts">
          <div className="side-detail">
            {row.decision_state === 'none' ? (
              <p>No decision is recorded in this snapshot.</p>
            ) : (
              <>
                {row.decision_state === 'legacy' && (
                  <p>
                    This legacy decision has no saved resolution event reference. Missing metadata
                    is not reconstructed.
                  </p>
                )}
                <dl className="detail-grid">
                  <div>
                    <dt>Resolution</dt>
                    <dd>{row.resolution ?? 'Not recorded'}</dd>
                  </div>
                  <div>
                    <dt>Decision time</dt>
                    <dd>{row.resolved_at ?? 'Not recorded'}</dd>
                  </div>
                  <div>
                    <dt>Decision client</dt>
                    <dd>{row.resolved_by_client ?? 'Not recorded'}</dd>
                  </div>
                  <div>
                    <dt>Resolution event</dt>
                    <dd>{row.resolution_event_id ?? 'Not recorded'}</dd>
                  </div>
                </dl>
                <h3>Saved selected value</h3>
                <SavedValue json={row.resolved_value_json} />
              </>
            )}
            <p>Record actor · {row.actor_id ?? 'Not recorded'}</p>
            <p>Record trace · {row.trace_id}</p>
            <p>Read trace · {result.trace_id}</p>
            <h3>Recorded sources</h3>
            {row.source_refs.length ? (
              <ul>
                {row.source_refs.map((ref, index) => (
                  <li key={index} style={{ overflowWrap: 'anywhere' }}>
                    {ref.type} · {ref.id}
                    {ref.revision === undefined ? '' : ' · revision ' + ref.revision}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No sources recorded.</p>
            )}
            <Link
              className="panel-link"
              prefetch={false}
              href={{ pathname: '/audit', query: { resource: 'conflict:' + row.conflict_id } }}
            >
              View conflict audit
            </Link>
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    return <PageError error={error} />;
  }
}
function SavedValue({ json }: { json: string | null }) {
  return json === null ? (
    <p className="muted">Value not recorded</p>
  ) : (
    <pre className="json-view" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {json}
    </pre>
  );
}
