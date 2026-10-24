import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';

export default async function AuditPage() {
  try {
    const response = await queryWorkbench<Record<string, unknown>[]>('audit');
    const records = response.data ?? [];
    const allowed = records.filter((record) => String(record.result) === 'allowed').length;
    const denied = records.filter((record) => String(record.result) === 'denied').length;
    const selected = records[0];
    const sourceCount = records.reduce((sum, item) => sum + (Array.isArray(item.source_refs) ? item.source_refs.length : 0), 0);

    return (
      <>
        <div className="page-heading">
          <div><h1>Audit</h1><p>Trace every read, decision, handoff and policy result with source references.</p></div>
          <div className="heading-actions"><Badge tone="cyan">{records.length} records</Badge><button className="secondary-button"><Icon name="external" /> Export JSON</button><button className="secondary-button">Redact</button></div>
        </div>
        <div className="status-card-grid audit-metrics">
          <Status label="Records in scope" value={records.length} tone="cyan" />
          <Status label="Allowed" value={allowed} tone="green" />
          <Status label="Denied" value={denied} tone={denied ? 'red' : 'blue'} />
          <Status label="Source refs" value={sourceCount} tone="purple" />
        </div>
        <Panel title="Audit records" icon="audit">
          <div className="filters audit-filters">
            <div className="filter-input"><Icon name="search" /> Search trace, actor, resource</div>
            <button className="filter-chip">Date range <Icon name="chevron" /></button><button className="filter-chip">Project <Icon name="chevron" /></button><button className="filter-chip">Actor <Icon name="chevron" /></button><button className="filter-chip">Action <Icon name="chevron" /></button><button className="filter-chip">Result <Icon name="chevron" /></button><button className="filter-chip">Classification <Icon name="chevron" /></button>
          </div>
        </Panel>
        <div className="drawer-layout audit-layout">
          <Panel title="Event stream" icon="activity">
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Occurred</th><th>Action</th><th>Resource</th><th>Actor / client</th><th>Result</th><th>Classification</th><th>Trace</th></tr></thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={String(record.audit_id)}>
                      <td>{textValue(record.occurred_at)}</td><td><strong>{textValue(record.action)}</strong></td><td>{textValue(record.resource)}</td>
                      <td><div><strong>{textValue(record.actor_id)}</strong><small className="table-subline">{textValue(record.client_id)}</small></div></td>
                      <td><Badge tone={toneFor(record.result)}>{textValue(record.result)}</Badge></td><td><Badge tone="neutral">{textValue(record.classification)}</Badge></td><td className="muted">{textValue(record.trace_id).slice(0, 15)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {records.length === 0 ? <div className="empty-state"><h3>No audit records</h3><p>Audit records are persisted by the API Gateway into <code>wcp_audit_records</code>.</p></div> : null}
            </div>
          </Panel>
          <Panel title="Selected record" icon="audit" className="drawer audit-drawer">
            {selected ? <AuditDetail record={selected} /> : <div className="empty-state"><h3>Select an audit record</h3><p>No scoped audit record exists yet.</p></div>}
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    return <><div className="page-heading"><div><h1>Audit</h1><p>Trace every read, decision, handoff and policy result with source references.</p></div></div><PageError error={error} /></>;
  }
}

function AuditDetail({ record }: { record: Record<string, unknown> }) {
  const refs = Array.isArray(record.source_refs) ? record.source_refs : [];
  const details = record.details && typeof record.details === 'object' ? record.details : {};
  return (
    <div className="side-detail audit-detail">
      <div className="selected-session-header"><div className="selected-session-icon"><Icon name="audit" /></div><div><h2>{textValue(record.action)}</h2><small>{textValue(record.audit_id)}</small></div><Badge tone={toneFor(record.result)}>{textValue(record.result)}</Badge></div>
      <div className="drawer-badges"><Badge tone="neutral">{textValue(record.classification)}</Badge><Badge tone="cyan">{textValue(record.client_id)}</Badge></div>
      <div className="detail-grid"><div><small>Occurred</small><strong>{textValue(record.occurred_at)}</strong></div><div><small>Actor</small><strong>{textValue(record.actor_id)}</strong></div><div><small>Resource</small><strong>{textValue(record.resource)}</strong></div><div><small>Session</small><strong>{textValue(record.session_id, '—')}</strong></div></div>
      <hr />
      <h3 className="detail-section-title">Trace and source references</h3>
      <div className="source-line"><span>Trace ID</span><strong>{textValue(record.trace_id)}</strong></div><div className="source-line"><span>References</span><strong>{numberValue(refs.length)}</strong></div>
      <div className="source-tags">{refs.length ? refs.map((ref, index) => <Badge key={String(ref) + '-' + index} tone="cyan">{typeof ref === 'object' && ref ? textValue((ref as Record<string, unknown>).type) : String(ref)}</Badge>) : <Badge tone="neutral">No references</Badge>}</div>
      <h3 className="detail-section-title">Details JSON</h3><pre className="json-view">{JSON.stringify(details, null, 2)}</pre>
      <div className="heading-actions detail-actions"><button className="primary-button">Open trace</button><button className="secondary-button">Copy JSON</button></div>
    </div>
  );
}

function Status({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <section className="panel status-card"><small>{label}</small><strong className={'text-' + tone}>{value}</strong><div className="muted">live from PostgreSQL</div></section>;
}
