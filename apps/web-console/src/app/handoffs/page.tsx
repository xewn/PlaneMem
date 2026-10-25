import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';

export default async function HandoffsPage() {
  try {
    const [handoffResponse, conflictResponse, contextResponse, auditResponse] = await Promise.all([
      queryWorkbench<Record<string, unknown>[]>('handoffs'),
      queryWorkbench<Record<string, unknown>[]>('conflicts'),
      queryWorkbench<Record<string, unknown>[]>('context'),
      queryWorkbench<Record<string, unknown>[]>('audit'),
    ]);
    const handoffs = handoffResponse.data ?? [];
    const conflicts = conflictResponse.data ?? [];
    const openConflicts = conflicts.filter((item) => String(item.status) === 'open').length;
    const pending = handoffs.filter((item) => ['offered', 'pending'].includes(String(item.status))).length;
    const selected = handoffs[0];
    return (
      <>
        <div className="page-heading"><div><h1>Handoffs</h1><p>Continue work across AI clients with explicit ownership and resumable context.</p></div><div className="heading-actions"><Badge tone="cyan">{handoffs.length} handoffs</Badge><button className="primary-button"><Icon name="handoffs" /> Create handoff</button></div></div>
        <div className="status-card-grid"><Metric label="Pending handoffs" value={pending} tone="yellow" /><Metric label="Open conflicts" value={openConflicts} tone={openConflicts ? 'red' : 'green'} /><Metric label="Context items" value={contextResponse.data?.length ?? 0} tone="cyan" /><Metric label="Audit events" value={auditResponse.data?.length ?? 0} tone="purple" /></div>
        <div className="filters handoff-filters"><div className="filter-input"><Icon name="search" /> Search checkpoint or recipient</div><button className="filter-chip">Status <Icon name="chevron" /></button><button className="filter-chip">Offered to <Icon name="chevron" /></button><div className="view-tabs"><span className="active">Queue</span><span>History</span></div></div>
        <div className="drawer-layout handoff-layout">
          <Panel title="Handoff queue" icon="handoffs">
            <div className="table-wrap"><table className="data-table"><thead><tr><th>Checkpoint</th><th>Status</th><th>Offered to</th><th>Summary</th><th>Updated</th></tr></thead><tbody>{handoffs.map((handoff) => <tr key={String(handoff.handoff_id)}><td><div className="table-title"><Icon name="context" /><div><strong>{textValue(handoff.handoff_id).slice(0, 12)}…</strong><small>{textValue(handoff.checkpoint_id, 'checkpoint pending')}</small></div></div></td><td><Badge tone={toneFor(handoff.status)}>{textValue(handoff.status)}</Badge></td><td>{textValue(handoff.offered_to)}</td><td>{textValue(handoff.summary)}</td><td>{textValue(handoff.updated_at)}</td></tr>)}</tbody></table>{handoffs.length === 0 ? <div className="empty-state"><h3>No handoffs</h3><p>New handoffs appear when a session publishes a checkpoint.</p></div> : null}</div>
          </Panel>
          <Panel title="Checkpoint detail" icon="context" className="drawer handoff-drawer">{selected ? <HandoffDetail handoff={selected} /> : <Protocol />}</Panel>
        </div>
      </>
    );
  } catch (error) {
    return <><div className="page-heading"><div><h1>Handoffs</h1><p>Continue work across AI clients with explicit ownership and resumable context.</p></div></div><PageError error={error} /></>;
  }
}

function HandoffDetail({ handoff }: { handoff: Record<string, unknown> }) {
  return <div className="side-detail"><div className="selected-session-header"><div className="selected-session-icon"><Icon name="handoffs" /></div><div><h2>{textValue(handoff.handoff_id).slice(0, 16)}…</h2><small>{textValue(handoff.checkpoint_id, 'checkpoint not supplied')}</small></div><Badge tone={toneFor(handoff.status)}>{textValue(handoff.status)}</Badge></div><div className="drawer-badges"><Badge tone="cyan">to {textValue(handoff.offered_to)}</Badge><Badge tone="neutral">{textValue(handoff.session_id).slice(0, 14)}…</Badge></div><div className="proposal"><h4>Checkpoint summary</h4><p>{textValue(handoff.summary)}</p></div><div className="detail-grid"><div><small>Created</small><strong>{textValue(handoff.created_at)}</strong></div><div><small>Updated</small><strong>{textValue(handoff.updated_at)}</strong></div><div><small>Session</small><strong>{textValue(handoff.session_id).slice(0, 14)}…</strong></div><div><small>Checkpoint</small><strong>{textValue(handoff.checkpoint_id, '—')}</strong></div></div><hr /><h3 className="detail-section-title">Human confirmation</h3><div className="confirmation-box"><span className="check-box" /><div><strong>Claim ownership before resume</strong><small>The target client must accept this checkpoint before continuing scoped work.</small></div></div><div className="heading-actions detail-actions"><button className="primary-button"><Icon name="check" /> Claim handoff</button><button className="secondary-button">View audit</button></div><div className="drawer-tabs"><span className="active">Checkpoint</span><span>Source refs</span><span>Audit trail</span></div></div>;
}

function Protocol() {
  return <div className="side-detail"><h2>Handoff protocol</h2><Step number="01" title="Capture" text="Write checkpoint and source references from the current session." /><Step number="02" title="Claim" text="A target client claims ownership with a scoped token." /><Step number="03" title="Resume" text="Restore verified context and continue from the next action." /><hr /><button className="primary-button" style={{ width: '100%' }}>Create handoff</button></div>;
}
function Step({ number, title, text }: { number: string; title: string; text: string }) { return <div className="step-row"><b>{number}</b><div><strong>{title}</strong><p>{text}</p></div></div>; }
function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { return <section className="panel status-card"><small>{label}</small><strong className={'text-' + tone}>{value}</strong><div className="muted">live from PostgreSQL</div></section>; }
