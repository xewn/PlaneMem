import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';

export default async function ConflictsPage() {
  try {
    const response = await queryWorkbench<Record<string, unknown>[]>('conflicts');
    const conflicts = response.data ?? [];
    const open = conflicts.filter((conflict) => String(conflict.status) === 'open');
    const resolved = conflicts.length - open.length;
    const selected = open[0] ?? conflicts[0];
    return (
      <>
        <div className="page-heading"><div><h1>Conflicts</h1><p>Compare versions, understand scope and resolve concurrent changes with an explicit decision.</p></div><div className="heading-actions"><Badge tone="red">{open.length} open</Badge><button className="secondary-button"><Icon name="audit" /> Open audit</button></div></div>
        <div className="status-card-grid"><Metric label="Open conflicts" value={open.length} tone={open.length ? 'red' : 'green'} /><Metric label="Resolved" value={resolved} tone="green" /><Metric label="Entities affected" value={new Set(conflicts.map((item) => String(item.entity_id))).size} tone="cyan" /><Metric label="Source refs" value={conflicts.reduce((sum, item) => sum + (Array.isArray(item.source_refs) ? item.source_refs.length : 0), 0)} tone="purple" /></div>
        <div className="filters conflict-filters"><div className="filter-input"><Icon name="search" /> Search entity or field</div><button className="filter-chip">Status <Icon name="chevron" /></button><button className="filter-chip">Entity type <Icon name="chevron" /></button><div className="view-tabs"><span className="active">Diff</span><span>History</span></div></div>
        <div className="drawer-layout conflict-layout">
          <Panel title="Conflict center" icon="conflicts">
            <div className="table-wrap"><table className="data-table"><thead><tr><th>Entity</th><th>Field</th><th>Versions</th><th>Status</th><th>Resolution</th><th>Actor</th></tr></thead><tbody>{conflicts.map((conflict) => <tr key={String(conflict.conflict_id)}><td><strong>{textValue(conflict.entity_type)} · {textValue(conflict.entity_id).slice(0, 10)}…</strong></td><td>{textValue(conflict.field)}</td><td>base {numberValue(conflict.base_version)} → local {numberValue(conflict.local_version)} / server {numberValue(conflict.server_version)}</td><td><Badge tone={toneFor(conflict.status)}>{textValue(conflict.status)}</Badge></td><td>{textValue(conflict.resolution)}</td><td>{textValue(conflict.actor_id)}</td></tr>)}</tbody></table>{conflicts.length === 0 ? <div className="empty-state"><h3>No conflicts</h3><p>The current scope has no version conflicts.</p></div> : null}</div>
          </Panel>
          <Panel title="Selected conflict" icon="conflicts" className="drawer conflict-drawer">{selected ? <ConflictDetail conflict={selected} /> : <div className="empty-state"><h3>Select a conflict</h3><p>Resolved conflicts remain available in the audit trail.</p></div>}</Panel>
        </div>
      </>
    );
  } catch (error) {
    return <><div className="page-heading"><div><h1>Conflicts</h1><p>Compare versions, understand scope and resolve concurrent changes with an explicit decision.</p></div></div><PageError error={error} /></>;
  }
}

function ConflictDetail({ conflict }: { conflict: Record<string, unknown> }) {
  const refs = Array.isArray(conflict.source_refs) ? conflict.source_refs : [];
  const isOpen = String(conflict.status) === 'open';
  return <div className="side-detail"><div className="selected-session-header"><div className="selected-session-icon"><Icon name="conflicts" /></div><div><h2>{textValue(conflict.entity_type)} · {textValue(conflict.field)}</h2><small>{textValue(conflict.entity_id)}</small></div><Badge tone={toneFor(conflict.status)}>{textValue(conflict.status)}</Badge></div><div className="drawer-badges"><Badge tone="yellow">v{numberValue(conflict.local_version)} vs v{numberValue(conflict.server_version)}</Badge><Badge tone="neutral">{textValue(conflict.actor_id)}</Badge></div><div className="diff-box"><div><span>Local value</span><pre>{JSON.stringify(conflict.local_value ?? null, null, 2)}</pre></div><div><span>Server value</span><pre>{JSON.stringify(conflict.server_value ?? null, null, 2)}</pre></div></div><hr /><h3 className="detail-section-title">Decision record</h3><div className="source-line"><span>Base version</span><strong>{numberValue(conflict.base_version)}</strong></div><div className="source-line"><span>Resolution</span><strong>{textValue(conflict.resolution, 'pending human decision')}</strong></div><div className="source-line"><span>Trace</span><strong>{textValue(conflict.trace_id)}</strong></div><div className="source-tags">{refs.length ? refs.map((ref, index) => <Badge key={String(ref) + '-' + index} tone="cyan">{typeof ref === 'object' && ref ? textValue((ref as Record<string, unknown>).type) : String(ref)}</Badge>) : <Badge tone="neutral">No source refs</Badge>}</div>{isOpen ? <div className="confirmation-box"><span className="check-box" /><div><strong>Human confirmation required</strong><small>Choose the version to write back into the scoped projection.</small></div></div> : null}<div className="heading-actions detail-actions"><button className="primary-button" disabled={!isOpen}><Icon name="check" /> Resolve with server</button><button className="secondary-button" disabled={!isOpen}>Keep local</button></div><div className="drawer-tabs"><span className="active">Diff</span><span>Source refs</span><span>Audit trail</span></div></div>;
}
function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { return <section className="panel status-card"><small>{label}</small><strong className={'text-' + tone}>{value}</strong><div className="muted">live from PostgreSQL</div></section>; }
