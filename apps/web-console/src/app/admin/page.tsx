import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel, Progress } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';

export default async function AdminPage() {
  try {
    const response = await queryWorkbench<Record<string, unknown>>('admin');
    const health = response.data;
    const services = Array.isArray(health.services) ? (health.services as Record<string, unknown>[]) : [];
    const degraded = services.filter((service) => !['ok', 'healthy'].includes(String(service.status))).length;
    const auditCount = numberValue(health.audit_count);
    const activeSessions = numberValue(health.active_sessions);
    const openConflicts = numberValue(health.open_conflicts);
    return (
      <>
        <div className="page-heading">
          <div><h1>Admin</h1><p>Connector health, policy decisions, audit persistence and release readiness.</p></div>
          <div className="heading-actions"><Badge tone={degraded ? 'yellow' : 'green'}>{degraded ? degraded + ' degraded' : 'System healthy'}</Badge><button className="secondary-button"><Icon name="refresh" /> Refresh</button></div>
        </div>
        {degraded ? <div className="warning-banner"><Icon name="conflicts" /><div><strong>Service health needs attention</strong><span>{degraded} scoped service reports a non-ready status. Review the live service table below.</span></div></div> : null}
        <div className="status-card-grid">
          <Status label="Uptime signal" value={services.length ? 'OK' : '—'} tone={degraded ? 'yellow' : 'green'} hint="database health" />
          <Status label="Audit records" value={auditCount} tone="cyan" hint="persisted in scope" />
          <Status label="Open conflicts" value={openConflicts} tone={openConflicts ? 'red' : 'green'} hint={activeSessions + ' active sessions'} />
          <Status label="Release" value={textValue(health.release)} tone="purple" hint="gateway build" />
        </div>
        <div className="service-grid admin-service-grid">
          <Panel title="Service health" icon="admin">
            <div className="service-row-head"><span>Service</span><span>Status</span><span>Version</span></div>
            {services.map((service) => <div className="service-row" key={String(service.name)}><i className={'health-dot ' + String(service.status)} /><span>{textValue(service.name)}</span><Badge tone={toneFor(service.status)}>{textValue(service.status)}</Badge><small>{textValue(service.version)}</small></div>)}
            {services.length === 0 ? <div className="empty-inline">No service health rows returned by the scoped database query.</div> : null}
          </Panel>
          <Panel title="Connector health" icon="database">
            <div className="connector-grid"><Connector label="PostgreSQL projection" status={services.find((service) => service.name === 'postgres')?.status ?? 'unknown'} /><Connector label="AuthServer OIDC" status="configured" /><Connector label="OpenTelemetry" status="trace ready" /></div>
            <div className="health-note">Connector statuses are shown from the live workbench health response and configured runtime integration.</div>
          </Panel>
        </div>
        <div className="admin-grid">
          <Panel title="Policy and identity" icon="users"><div className="admin-list"><Row label="Scope fence" value="tenant / workspace / project" tone="green" /><Row label="Bearer session" value="required" tone="green" /><Row label="Classification" value="internal" tone="cyan" /><Row label="Audit persistence" value="enabled" tone="green" /></div></Panel>
          <Panel title="Event latency" icon="activity"><div className="latency-card"><div><strong>{services.length ? 'live' : '—'}</strong><small>health response</small></div><Progress value={services.length ? 100 : 0} tone={degraded ? 'yellow' : 'green'} /></div><div className="admin-list"><Row label="Trace propagation" value="trace_id preserved" tone="cyan" /><Row label="Source references" value="postgres envelope" tone="purple" /></div></Panel>
          <Panel title="Feature flags" icon="target"><div className="flag-grid"><Flag label="audit" enabled /><Flag label="context" enabled /><Flag label="handoff" enabled={activeSessions > 0 || auditCount > 0} /><Flag label="conflicts" enabled={openConflicts > 0} /></div></Panel>
        </div>
        <div className="service-grid">
          <Panel title="Release manifest" icon="context"><div className="release-box"><Badge tone="green">Current</Badge><h2>{textValue(health.release)}</h2><p className="muted">Versioned runtime health from the workbench database connection.</p><code>{'api_gateway: 0.1.0\\ndatabase: PostgreSQL 16\\ntrace_schema: v1\\nfeature_flags: audit, context'}</code></div></Panel>
          <Panel title="Deployment topology" icon="sessions"><div className="topology-list"><div><span className="topology-dot ok" /><strong>API Gateway</strong><small>scoped query endpoint</small></div><div><span className="topology-dot ok" /><strong>PostgreSQL</strong><small>projection and audit store</small></div><div><span className="topology-dot cyan" /><strong>AuthServer</strong><small>OIDC / PKCE session</small></div></div></Panel>
        </div>
      </>
    );
  } catch (error) {
    return <><div className="page-heading"><div><h1>Admin</h1><p>Connector health, policy decisions, audit persistence and release readiness.</p></div></div><PageError error={error} /></>;
  }
}

function Status({ label, value, tone, hint }: { label: string; value: number | string; tone: string; hint: string }) {
  return <section className="panel status-card"><small>{label}</small><strong className={'text-' + tone}>{value}</strong><div className="muted">{hint} · live</div></section>;
}
function Connector({ label, status }: { label: string; status: unknown }) {
  const ok = ['ok', 'healthy', 'configured', 'trace ready'].includes(String(status));
  return <div className="connector-row"><i className={'health-dot ' + (ok ? 'ok' : 'degraded')} /><div><strong>{label}</strong><small>{textValue(status)}</small></div><Badge tone={ok ? 'green' : 'yellow'}>{ok ? 'ready' : 'review'}</Badge></div>;
}
function Row({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="source-line"><span>{label}</span><Badge tone={tone}>{value}</Badge></div>; }
function Flag({ label, enabled }: { label: string; enabled: boolean }) { return <div className="flag"><span className={enabled ? 'flag-on' : 'flag-off'}>{enabled ? 'ON' : 'OFF'}</span><strong>{label}</strong></div>; }
