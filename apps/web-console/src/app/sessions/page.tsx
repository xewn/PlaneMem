import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';

export default async function SessionsPage() {
  try {
    const response = await queryWorkbench<Record<string, unknown>[]>('sessions');
    const sessions = response.data ?? [];
    const active = sessions.filter((session) => ['running', 'active'].includes(String(session.status))).length;
    const ended = sessions.filter((session) => ['ended', 'completed'].includes(String(session.status))).length;
    const failed = sessions.filter((session) => ['failed', 'error'].includes(String(session.status))).length;
    const totalRuns = sessions.reduce((sum, item) => sum + numberValue(item.run_count), 0);
    const totalTools = sessions.reduce((sum, item) => sum + numberValue(item.tool_call_count), 0);
    const selected = sessions[0];

    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Sessions</h1>
            <p>Cross-client runs, tool calls, checkpoints and parent-child session lineage.</p>
          </div>
          <div className="heading-actions">
            <Badge tone="green">{active} live</Badge>
            <button className="primary-button"><Icon name="sessions" /> Start session</button>
          </div>
        </div>
        <div className="status-card-grid">
          <Status label="Live sessions" value={active} tone="green" hint="currently running" />
          <Status label="Active runs" value={totalRuns} tone="cyan" hint="agent runs in scope" />
          <Status label="Tool calls" value={totalTools} tone="purple" hint="recorded in scope" />
          <Status label="Ended / failed" value={ended + failed} tone={failed ? 'red' : 'blue'} hint={ended + ' ended · ' + failed + ' failed'} />
        </div>
        <Panel title="Session registry" icon="sessions" className="session-toolbar-panel">
          <div className="filters session-filters">
            <div className="filter-input"><Icon name="search" /> Search client, actor or trace</div>
            <button className="filter-chip">All clients <Icon name="chevron" /></button>
            <div className="view-tabs"><span className="active">All {sessions.length}</span><span>Active {active}</span><span>Ended {ended}</span><span>Failed {failed}</span></div>
          </div>
        </Panel>
        <div className="drawer-layout sessions-layout">
          <Panel title="Session registry" icon="database">
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Client</th><th>Status</th><th>Actor</th><th>Runs</th><th>Tools</th><th>Started</th><th>Trace</th></tr></thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={String(session.session_id)}>
                      <td><div className="table-title"><Icon name="sessions" /><div><strong>{textValue(session.client_id)}</strong><small>{textValue(session.session_id).slice(0, 18)}…</small></div></div></td>
                      <td><Badge tone={toneFor(session.status)}>{textValue(session.status)}</Badge></td>
                      <td>{textValue(session.actor_id)}</td>
                      <td>{numberValue(session.run_count)}</td>
                      <td>{numberValue(session.tool_call_count)}</td>
                      <td>{textValue(session.started_at)}</td>
                      <td className="muted">{textValue(session.trace_id).slice(0, 15)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sessions.length === 0 ? <div className="empty-state"><h3>No sessions in scope</h3><p>Sessions are read from the real <code>wcp_sessions</code> projection.</p></div> : null}
            </div>
          </Panel>
          <Panel title="Selected session" icon="clock" className="drawer session-drawer">
            {selected ? <SessionDetail session={selected} /> : <div className="empty-state"><h3>Select a session</h3><p>No scoped session exists yet.</p></div>}
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    return <><div className="page-heading"><div><h1>Sessions</h1><p>Cross-client runs, tool calls, checkpoints and parent-child session lineage.</p></div></div><PageError error={error} /></>;
  }
}

function SessionDetail({ session }: { session: Record<string, unknown> }) {
  const runs = numberValue(session.run_count);
  const tools = numberValue(session.tool_call_count);
  return (
    <div className="session-detail side-detail">
      <div className="selected-session-header"><div className="selected-session-icon"><Icon name="sessions" /></div><div><h2>{textValue(session.client_id)} session</h2><small>{textValue(session.session_id)}</small></div><Badge tone={toneFor(session.status)}>{textValue(session.status)}</Badge></div>
      <div className="drawer-badges"><Badge tone="cyan">{textValue(session.actor_id)}</Badge><Badge tone="neutral">{textValue(session.trace_id).slice(0, 18)}…</Badge></div>
      <div className="detail-grid"><div><small>Parent session</small><strong>{textValue(session.parent_session_id, 'Root session')}</strong></div><div><small>Started</small><strong>{textValue(session.started_at)}</strong></div><div><small>Agent runs</small><strong>{runs}</strong></div><div><small>Tool calls</small><strong>{tools}</strong></div></div>
      <hr />
      <h3 className="detail-section-title">Agent run timeline</h3>
      <div className="run-timeline">
        <div className="run-event"><i className="timeline-dot done" /><div><strong>Session created</strong><small>{textValue(session.started_at)} · actor scope established</small></div><Badge tone="green">ok</Badge></div>
        <div className="run-event"><i className="timeline-dot current" /><div><strong>{runs ? runs + ' agent run' + (runs === 1 ? '' : 's') + ' observed' : 'Awaiting agent run'}</strong><small>Run records joined from <code>wcp_agent_runs</code></small></div><Badge tone="cyan">{runs}</Badge></div>
        <div className="run-event"><i className="timeline-dot" /><div><strong>{tools ? tools + ' tool call' + (tools === 1 ? '' : 's') + ' recorded' : 'No tool calls recorded'}</strong><small>Tool activity is scoped to this session</small></div><Badge tone={tools ? 'purple' : 'neutral'}>{tools}</Badge></div>
      </div>
      <div className="drawer-tabs"><span className="active">Run detail</span><span>Event replay</span><span>Source refs</span></div>
      <div className="source-line"><span>Trace ID</span><strong>{textValue(session.trace_id)}</strong></div>
      <div className="heading-actions detail-actions"><button className="primary-button"><Icon name="arrow" /> Replay session</button><button className="secondary-button">Open audit</button></div>
    </div>
  );
}

function Status({ label, value, tone, hint }: { label: string; value: number; tone: string; hint: string }) {
  return <section className="panel status-card"><small>{label}</small><strong className={'text-' + tone}>{value}</strong><div className="muted">{hint} · live from PostgreSQL</div></section>;
}
