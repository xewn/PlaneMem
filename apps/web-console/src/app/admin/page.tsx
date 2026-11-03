import Link from 'next/link';
import {
  WORKBENCH_ADMIN_CHECKS,
  type WorkbenchAdminCount,
  type WorkbenchAdminSnapshot,
} from '@planemem/contracts';
import { PageError } from '../../components/page-state';
import { Badge, Panel } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';

const checkLabels: Record<(typeof WORKBENCH_ADMIN_CHECKS)[number], string> = {
  audit_write: 'Audit write and recovery',
  identity_provider: 'Identity provider availability',
  policy_service: 'Policy service availability',
  plane_connector: 'Plane connector availability',
  telemetry: 'Telemetry delivery',
  release_readiness: 'Release readiness',
};

export default async function AdminPage() {
  let content;
  try {
    const response = await queryWorkbench<WorkbenchAdminSnapshot>('admin');
    const snapshot = response.data;
    const { counts } = snapshot;
    content = (
      <>
        <div className="status-card-grid">
          <CountCard
            label="Visible audit records"
            count={counts.audit_records}
            access="Audit access required"
          />
          <CountCard
            label="Running sessions"
            count={counts.running_sessions}
            access="Context access required"
          />
          <CountCard
            label="Open visible conflicts"
            count={counts.open_conflicts}
            access="Context access required"
          />
          <section className="panel status-card">
            <small>Gateway reported version</small>
            <strong className="text-purple">{snapshot.gateway_version}</strong>
            <div className="muted">Runtime declaration</div>
          </section>
        </div>
        <p className="muted">
          Counts include records visible to this session in this project at the time of the query.
          Missing access is shown separately from zero. Refresh explicitly to read a new snapshot.
        </p>
        <div className="service-grid admin-service-grid">
          <Panel title="Database read observation" icon="database">
            <div className="side-detail">
              <Badge tone="cyan">Query completed</Badge>
              <dl className="detail-grid">
                <div>
                  <dt>Read at</dt>
                  <dd>
                    <time dateTime={snapshot.read_at}>{snapshot.read_at}</time>
                  </dd>
                </div>
                <div>
                  <dt>PostgreSQL reported version</dt>
                  <dd>{snapshot.database.version}</dd>
                </div>
                <div>
                  <dt>Project</dt>
                  <dd>{response.scope?.project_id}</dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>{response.scope?.workspace_id}</dd>
                </div>
                <div>
                  <dt>Tenant</dt>
                  <dd>{response.scope?.tenant_id}</dd>
                </div>
              </dl>
              <p>
                This observation confirms that this query returned. It does not establish uptime,
                database write availability, connector health or readiness to release.
              </p>
            </div>
          </Panel>
          <Panel title="Checks outside this snapshot" icon="admin">
            <div className="admin-list">
              {WORKBENCH_ADMIN_CHECKS.map((key) => (
                <div className="source-line" key={key}>
                  <span>{checkLabels[key]}</span>
                  <Badge>
                    {snapshot.checks[key] === 'not-checked' ? 'Not checked' : 'Unknown'}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="muted">
              These checks need their own observations. Record counts do not indicate feature
              settings, event latency or the state of a release manifest.
            </p>
          </Panel>
        </div>
        <Panel title="Project records and sources" icon="context">
          <nav className="heading-actions" aria-label="Administration record views">
            {counts.audit_records.state === 'available' && (
              <Link className="panel-link" href="/audit" prefetch={false}>
                Audit records
              </Link>
            )}
            {counts.running_sessions.state === 'available' && (
              <Link className="panel-link" href="/sessions" prefetch={false}>
                Sessions
              </Link>
            )}
            {counts.open_conflicts.state === 'available' && (
              <Link className="panel-link" href="/conflicts" prefetch={false}>
                Conflicts
              </Link>
            )}
            <Link className="panel-link" href="/admin/plane-events" prefetch={false}>
              Plane event queue
            </Link>
          </nav>
          <p className="muted">Each destination checks the current permissions again.</p>
          <div className="source-line">
            <span>Query trace</span>
            <strong>{response.trace_id}</strong>
          </div>
          <ul>
            {response.source_refs.map((ref) => (
              <li key={`${ref.type}:${ref.id}`}>
                {ref.type}: {ref.id}
              </li>
            ))}
          </ul>
        </Panel>
      </>
    );
  } catch (error) {
    content = <PageError error={error} />;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Admin</h1>
          <p>Project counts and the database observation from this page load.</p>
        </div>
        <form action="/admin" method="get">
          <button className="secondary-button" type="submit">
            Refresh snapshot
          </button>
        </form>
      </div>
      {content}
    </>
  );
}

function CountCard({
  label,
  count,
  access,
}: {
  label: string;
  count: WorkbenchAdminCount;
  access: string;
}) {
  return (
    <section className="panel status-card">
      <small>{label}</small>
      <strong className={count.state === 'available' ? 'text-cyan' : 'muted'}>
        {count.state === 'available' ? count.value.toLocaleString('en-US') : 'Not available'}
      </strong>
      <div className="muted">{count.state === 'available' ? 'Visible at query time' : access}</div>
    </section>
  );
}
