import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, MiniBars, Panel, Progress } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';

type Row = Record<string, unknown>;

const layerNames: Record<string, string> = {
  L0: 'Project Brief',
  L1: 'Current Work',
  L2: 'Confirmed Facts',
  L3: 'Recent Activity',
  L4: 'External Docs',
};

export async function OverviewPage() {
  try {
    const [
      overviewResponse,
      workItemsResponse,
      contextResponse,
      sessionsResponse,
      conflictsResponse,
      auditResponse,
    ] = await Promise.all([
      queryWorkbench<Row>('overview'),
      queryWorkbench<Row[]>('work_items'),
      queryWorkbench<Row[]>('context'),
      queryWorkbench<Row[]>('sessions'),
      queryWorkbench<Row[]>('conflicts'),
      queryWorkbench<Row[]>('audit'),
    ]);
    const data = overviewResponse.data;
    const items = workItemsResponse.data ?? [];
    const context = contextResponse.data ?? [];
    const sessions = sessionsResponse.data ?? [];
    const conflicts = conflictsResponse.data ?? [];
    const audits = auditResponse.data ?? [];
    const total = items.length;
    const completed = items.filter((item) => item.status === 'done').length;
    const active = items.filter((item) => !['done', 'cancelled'].includes(String(item.status)));
    const blocked = items.filter((item) => item.status === 'blocked');
    const decisions = context.filter(
      (item) => item.item_type === 'Decision' || item.status === 'proposed',
    );
    const proposedDecisions = decisions.filter((item) => item.status === 'proposed');
    const openConflicts = conflicts.filter((item) => item.status === 'open');
    const goalItem = context.find((item) => item.layer === 'L0');
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    const trace = overviewResponse.trace_id;

    return (
      <>
        <div className="page-heading overview-heading">
          <div>
            <h1>Project Overview</h1>
            <p>PlaneMem / Work Continuity Platform</p>
          </div>
          <div className="heading-actions">
            <Badge tone="green">LIVE · {trace}</Badge>
          </div>
        </div>

        <div className="overview-grid">
          <Metric
            label="Progress"
            value={`${progress}%`}
            icon="target"
            tone="cyan"
            progress={progress}
          />
          <Metric
            label="Active Work Items"
            value={active.length}
            icon="work"
            tone="blue"
            bars={barsFor(active.length, total)}
          />
          <Metric
            label="Blocked"
            value={blocked.length}
            icon="conflicts"
            tone="red"
            bars={barsFor(blocked.length, total)}
          />
          <Metric
            label="Decisions Awaiting"
            value={proposedDecisions.length}
            icon="decision"
            tone="yellow"
            bars={barsFor(proposedDecisions.length, decisions.length)}
          />
        </div>

        <div className="overview-columns overview-first">
          <Panel title="Project Goal" icon="target" className="goal-card">
            <h3>{textValue(goalItem?.title, 'Project goal not published')}</h3>
            <p>
              {contentSummary(
                goalItem?.content,
                'No goal context is currently available in this scope.',
              )}
            </p>
            <div className="muted">
              Project · {textValue(data.project_name, textValue(data.external_id))}
            </div>
          </Panel>
          <Panel
            title="Milestones"
            icon="flag"
            action={
              <span className="panel-link">
                View details <Icon name="arrow" />
              </span>
            }
          >
            <div className="timeline">
              {items.slice(0, 4).map((item, index) => {
                const status = String(item.status);
                const state = status === 'done' ? 'done' : index === 0 ? 'current' : '';
                return (
                  <div className={`timeline-row ${state}`} key={String(item.id)}>
                    <i className="timeline-dot" />
                    <div>
                      <strong>
                        M{index + 1} {textValue(item.title)}
                      </strong>
                      <span>
                        {status.replace('_', ' ')} · {textValue(item.due_at, 'No due date')}
                      </span>
                    </div>
                  </div>
                );
              })}
              {items.length === 0 ? (
                <div className="empty-inline">No milestone data in scope.</div>
              ) : null}
            </div>
          </Panel>
          <Panel
            title="Current Plan"
            icon="work"
            action={
              <span className="panel-link">
                View details <Icon name="arrow" />
              </span>
            }
          >
            <div className="plan-list">
              {items.slice(0, 5).map((item, index) => (
                <PlanRow
                  key={String(item.id)}
                  index={String(index + 1)}
                  text={textValue(item.title)}
                  status={String(item.status).replace('_', ' ')}
                  tone={toneFor(item.status)}
                  priority={textValue(item.priority)}
                />
              ))}
              {items.length === 0 ? (
                <div className="empty-inline">No work items in scope.</div>
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="overview-columns overview-second">
          <Panel title="Work Items" icon="work">
            <div className="work-summary">
              <div className="ring">
                <span>
                  <strong>{total}</strong>
                  <small>Total</small>
                </span>
              </div>
              <div className="legend">
                <Legend
                  color="blue"
                  label="In Progress"
                  value={active.filter((item) => item.status === 'in_progress').length}
                />
                <Legend
                  color="gray"
                  label="Todo"
                  value={items.filter((item) => item.status === 'todo').length}
                />
                <Legend color="red" label="Blocked" value={blocked.length} />
                <Legend color="green" label="Done" value={completed} />
              </div>
            </div>
          </Panel>
          <Panel
            title="Risks & Decisions"
            icon="conflicts"
            action={
              <span className="panel-link">
                View details <Icon name="arrow" />
              </span>
            }
          >
            <div className="risk-list">
              {openConflicts.slice(0, 3).map((conflict) => (
                <div className="risk-row" key={String(conflict.conflict_id)}>
                  <Badge tone="red">{textValue(conflict.status)}</Badge>
                  <span>
                    {textValue(conflict.entity_type)} · {textValue(conflict.field)}
                  </span>
                  <small>{textValue(conflict.trace_id)}</small>
                </div>
              ))}
              {context
                .filter((item) => item.status === 'expired')
                .slice(0, 2)
                .map((item) => (
                  <div className="risk-row" key={String(item.id)}>
                    <Badge tone={toneFor(item.priority)}>{textValue(item.priority)}</Badge>
                    <span>{textValue(item.title)}</span>
                    <small>{textValue(item.status)}</small>
                  </div>
                ))}
              {openConflicts.length === 0 &&
              context.filter((item) => item.status === 'expired').length === 0 ? (
                <div className="empty-inline">No open risks in the current scope.</div>
              ) : null}
            </div>
          </Panel>
          <Panel title="Decision Approvals" icon="decision">
            <div className="approval-list">
              {decisions.slice(0, 3).map((item) => {
                const pending = item.status === 'proposed';
                return (
                  <div className="approval-row" key={String(item.id)}>
                    <i className={`approval-marker ${pending ? 'pending' : ''}`} />
                    <div>
                      <strong>{textValue(item.title)}</strong>
                      <small>
                        {pending ? 'Human confirmation required' : textValue(item.status)}
                      </small>
                    </div>
                    <Badge tone={pending ? 'yellow' : 'green'}>
                      {pending ? 'Review' : 'Confirmed'}
                    </Badge>
                  </div>
                );
              })}
              {decisions.length === 0 ? (
                <div className="empty-inline">No decisions recorded in scope.</div>
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="overview-columns overview-bottom">
          <Panel
            title="Recent Activity"
            icon="activity"
            action={
              <span className="panel-link">
                View details <Icon name="arrow" />
              </span>
            }
          >
            <div className="activity-list">
              {audits.slice(0, 5).map((audit, index) => (
                <div className="activity-row" key={String(audit.audit_id)}>
                  <i className={`activity-dot activity-${index % 4}`} />
                  <span>
                    {textValue(audit.action)} · {textValue(audit.resource)}
                  </span>
                  <small>{textValue(audit.client_id)}</small>
                </div>
              ))}
              {audits.length === 0 ? (
                <div className="empty-inline">No recent activity in scope.</div>
              ) : null}
            </div>
          </Panel>
          <Panel
            title="Context Freshness"
            icon="context"
            action={
              <button className="secondary-button">
                <Icon name="refresh" />
                Refresh
              </button>
            }
          >
            {['L0', 'L1', 'L2', 'L3', 'L4'].map((layer, index) => {
              const layerItems = context.filter((item) => item.layer === layer);
              const count = layerItems.length;
              const freshness =
                count === 0
                  ? 0
                  : Math.round(
                      (layerItems.reduce((sum, item) => sum + numberValue(item.confidence), 0) /
                        count) *
                        100,
                    );
              return (
                <Fresh
                  key={layer}
                  label={layerNames[layer] ?? layer}
                  value={freshness}
                  tone={['green', 'cyan', 'yellow', 'blue', 'purple'][index] ?? 'cyan'}
                  count={count}
                />
              );
            })}
          </Panel>
          <Panel
            title="Active Sessions"
            icon="users"
            action={
              <span className="panel-link">
                View details <Icon name="arrow" />
              </span>
            }
          >
            <div className="session-list">
              {sessions.slice(0, 4).map((session) => (
                <div className="session-row" key={String(session.session_id)}>
                  <i className="status-dot" />
                  <div className="session-client">
                    <strong>{textValue(session.client_id)}</strong>
                    <small>
                      {numberValue(session.run_count)} agent runs ·{' '}
                      {numberValue(session.tool_call_count)} tool calls
                    </small>
                  </div>
                  <Badge tone={toneFor(session.status)}>{textValue(session.status)}</Badge>
                </div>
              ))}
              {sessions.length === 0 ? (
                <div className="empty-inline">No sessions in scope.</div>
              ) : null}
            </div>
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Project Overview</h1>
            <p>PlaneMem / Work Continuity Platform</p>
          </div>
        </div>
        <PageError error={error} />
      </>
    );
  }
}

export default OverviewPage;

function Metric({
  label,
  value,
  icon,
  tone,
  progress,
  bars,
}: {
  label: string;
  value: string | number;
  icon: string;
  tone: string;
  progress?: number;
  bars?: number[];
}) {
  return (
    <section className={`panel metric-card metric-${tone}`}>
      <div>
        <span className="metric-label">{label}</span>
        <strong>{value}</strong>
        {progress !== undefined ? <Progress value={progress} tone={tone} /> : null}
      </div>
      <div className="metric-side">
        <div className="metric-icon">
          <Icon name={icon} />
        </div>
        {bars ? <MiniBars values={bars} tone={tone} /> : <span className="delta">live data</span>}
      </div>
    </section>
  );
}

function barsFor(value: number, total: number): number[] {
  if (!total) return [0, 0, 0, 0, 0, 0];
  const ratio = Math.max(8, Math.round((value / total) * 100));
  return [ratio * 0.45, ratio * 0.7, ratio * 0.55, ratio * 0.85, ratio * 0.65, ratio].map((item) =>
    Math.round(item),
  );
}

function PlanRow({
  index,
  text,
  status,
  tone,
  priority,
}: {
  index: string;
  text: string;
  status: string;
  tone: string;
  priority: string;
}) {
  return (
    <div className="plan-row">
      <span className="plan-index">{index}</span>
      <span>{text}</span>
      <Badge tone={tone}>{status}</Badge>
      <span className="plan-priority">{priority}</span>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div>
      <i className={color === 'blue' ? '' : color} />
      {label}
      <b>{value}</b>
    </div>
  );
}

function Fresh({
  label,
  value,
  tone,
  count,
}: {
  label: string;
  value: number;
  tone: string;
  count: number;
}) {
  return (
    <div className="fresh-row">
      <b>{label.slice(0, 2)}</b>
      <span className="fresh-name">{label}</span>
      <Progress value={value} tone={tone} />
      <small>
        {count} · {value}%
      </small>
    </div>
  );
}

function contentSummary(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const summary = record.summary ?? record.description ?? record.decision;
    if (typeof summary === 'string' && summary.trim()) return summary;
  }
  return fallback;
}
