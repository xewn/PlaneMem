import Link from 'next/link';
import { Icon } from '../../components/icons';
import { PageError, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel, Progress } from '../../components/ui';
import {
  queryAuditPreview,
  getWorkbenchOverview,
  listWorkbenchWorkItems,
} from '../../lib/server-api';

const layerNames: Record<string, string> = {
  L0: 'Project Brief',
  L1: 'Current Work',
  L2: 'Confirmed Facts',
  L3: 'Recent Activity',
  L4: 'External Docs',
};

export default async function OverviewPage() {
  try {
    const [overviewRead, workItemsRead, auditRead] = await Promise.allSettled([
      getWorkbenchOverview(),
      listWorkbenchWorkItems({ limit: 5 }),
      queryAuditPreview(),
    ]);
    if (overviewRead.status === 'rejected') throw overviewRead.reason;
    const overviewResponse = overviewRead.value;
    const auditResponse = auditRead.status === 'fulfilled' ? auditRead.value : undefined;
    const data = overviewResponse.data;
    const items = workItemsRead.status === 'fulfilled' ? workItemsRead.value.data : [];
    const sessions = data.active_session_preview;
    const audits = auditResponse?.data ?? [];
    const total = data.total_work_items;
    const completed = data.completed_work_items;
    const active = data.active_work_items;
    const blocked = data.blocked_work_items;
    const proposedContext = data.proposed_context_preview;
    const expiredContext = data.expired_context_preview;
    const openConflicts = data.open_conflict_preview;
    const goalItem = data.project_brief;
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
            <Link className="panel-link" href="/overview/observed" prefetch={false}>
              Plane observation
            </Link>
            <Badge tone="neutral">Saved records</Badge>
            <form action="/overview" method="get">
              <button className="secondary-button" type="submit">
                <Icon name="refresh" /> Refresh overview
              </button>
            </form>
          </div>
        </div>
        <p className="muted">
          Read at {data.read_at} · Trace {trace}. Counts cover visible, non-archived records in this
          project. Previews show a limited selection. Work item and audit previews are read
          separately and may reflect different update times.
        </p>

        <div className="overview-grid">
          <Metric
            label="Completed Work"
            value={`${progress}%`}
            icon="target"
            tone="cyan"
            progress={progress}
            detail={`${completed} of ${total} recorded items, including cancelled items in the total`}
            href="/work-items?view=list"
          />
          <Metric
            label="Active Work Items"
            value={active}
            icon="work"
            tone="blue"
            detail="Todo, in progress, in review and blocked"
            href="/work-items"
          />
          <Metric
            label="Blocked"
            value={blocked}
            icon="conflicts"
            tone="red"
            detail="Work items recorded as blocked"
            href="/work-items?status=blocked"
          />
          <Metric
            label="Proposed Context"
            value={data.proposed_context_items}
            icon="decision"
            tone="yellow"
            detail="Recorded proposals; review readiness is checked in details"
            href="/context?status=proposed"
          />
        </div>

        <div className="overview-columns overview-first">
          <Panel title="Recorded Project Brief" icon="target" className="goal-card">
            <h3>{textValue(goalItem?.title, 'No confirmed project brief')}</h3>
            <p>
              {contentSummary(
                goalItem?.content,
                'No brief text is available in this saved record.',
              )}
            </p>
            <div className="muted">
              Project · {textValue(data.project_name, textValue(data.external_id))}
            </div>
            <p className="muted">
              Confirmed L0 record within its recorded expiry. Source freshness is checked in context
              details.
            </p>
            <Link
              className="panel-link"
              href={{
                pathname: '/context',
                query: { layer: 'L0', ...(goalItem ? { item: goalItem.id } : {}) },
              }}
              prefetch={false}
            >
              Read project brief <Icon name="arrow" />
            </Link>
          </Panel>
          <Panel
            title="Recent Work Updates"
            icon="flag"
            action={
              <Link className="panel-link" href="/work-items?view=list">
                View details <Icon name="arrow" />
              </Link>
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
                        <Link
                          href={{ pathname: '/work-items/detail', query: { item: item.id } }}
                          prefetch={false}
                        >
                          {textValue(item.title)}
                        </Link>
                      </strong>
                      <span>
                        {status.replace('_', ' ')} · {textValue(item.due_at, 'No due date')}
                      </span>
                    </div>
                  </div>
                );
              })}
              {workItemsRead.status === 'rejected' && <PageError error={workItemsRead.reason} />}
              {workItemsRead.status === 'fulfilled' && items.length === 0 ? (
                <div className="empty-inline">No work item updates in scope.</div>
              ) : null}
            </div>
          </Panel>
          <Panel
            title="Recently Updated Work"
            icon="work"
            action={
              <Link className="panel-link" href="/work-items">
                View details <Icon name="arrow" />
              </Link>
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
                  href={'/work-items/detail?item=' + encodeURIComponent(item.id)}
                />
              ))}
              {workItemsRead.status === 'rejected' && <PageError error={workItemsRead.reason} />}
              {workItemsRead.status === 'fulfilled' && items.length === 0 ? (
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
                <Legend color="blue" label="In Progress" value={data.in_progress_work_items} />
                <Legend color="gray" label="Todo" value={data.todo_work_items} />
                <Legend color="red" label="Blocked" value={blocked} />
                <Legend color="gray" label="In Review" value={data.in_review_work_items} />
                <Legend color="gray" label="Cancelled" value={data.cancelled_work_items} />
                <Legend color="green" label="Done" value={completed} />
              </div>
            </div>
          </Panel>
          <Panel
            title="Conflicts & Expired Context"
            icon="conflicts"
            action={
              <Link className="panel-link" href="/conflicts?status=open">
                Open conflicts <Icon name="arrow" />
              </Link>
            }
          >
            <div className="risk-list">
              <p className="muted">
                {data.open_conflicts} open conflicts · {data.expired_context_items} expired context
                records
              </p>
              {openConflicts.slice(0, 3).map((conflict) => (
                <div className="risk-row" key={String(conflict.conflict_id)}>
                  <Badge tone="red">{textValue(conflict.status)}</Badge>
                  <Link
                    href={{ pathname: '/conflicts', query: { item: conflict.conflict_id } }}
                    prefetch={false}
                  >
                    {textValue(conflict.entity_type)} · {textValue(conflict.field)}
                  </Link>
                </div>
              ))}
              {expiredContext.map((item) => (
                <div className="risk-row" key={String(item.id)}>
                  <Badge tone="yellow">Expired</Badge>
                  <Link href={{ pathname: '/context', query: { item: item.id } }} prefetch={false}>
                    {item.title}
                  </Link>
                  <small>
                    {item.status === 'expired' ? 'Recorded expired' : 'Expiry date reached'}
                  </small>
                </div>
              ))}
              {data.open_conflicts === 0 && data.expired_context_items === 0 ? (
                <div className="empty-inline">
                  No open conflicts or expired context records in scope.
                </div>
              ) : null}
            </div>
          </Panel>
          <Panel
            title="Proposed Context"
            icon="decision"
            action={
              <Link className="panel-link" href="/context?status=proposed">
                View all <Icon name="arrow" />
              </Link>
            }
          >
            <div className="approval-list">
              {proposedContext.map((item) => {
                return (
                  <div className="approval-row" key={String(item.id)}>
                    <i className="approval-marker pending" />
                    <div>
                      <strong>
                        <Link
                          href={{
                            pathname: '/context',
                            query: { item: item.id, status: 'proposed' },
                          }}
                          prefetch={false}
                        >
                          {item.title}
                        </Link>
                      </strong>
                      <small>{item.item_type} · Open details to check review readiness</small>
                    </div>
                    <Badge tone="yellow">Proposed</Badge>
                  </div>
                );
              })}
              {data.proposed_context_items === 0 ? (
                <div className="empty-inline">No proposed context recorded in scope.</div>
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="overview-columns overview-bottom">
          <Panel
            title="Recent Activity"
            icon="activity"
            action={
              <Link className="panel-link" href="/audit">
                View details <Icon name="arrow" />
              </Link>
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
              {auditRead.status === 'rejected' && <PageError error={auditRead.reason} />}
              {auditRead.status === 'fulfilled' && audits.length === 0 ? (
                <div className="empty-inline">
                  {auditResponse
                    ? 'No recent activity in scope.'
                    : 'Audit access is required to view recent activity.'}
                </div>
              ) : null}
            </div>
          </Panel>
          <Panel
            title="Recorded Context Confidence"
            icon="context"
            action={
              <Link className="panel-link" href="/context">
                View context <Icon name="arrow" />
              </Link>
            }
          >
            <p className="muted">
              Average saved confidence across all visible non-archived items. This does not measure
              source freshness.
            </p>
            {data.context_layers.map((layer, index) => {
              return (
                <ContextLayer
                  key={layer.layer}
                  layer={layer.layer}
                  label={layerNames[layer.layer] ?? layer.layer}
                  value={
                    layer.average_confidence === null
                      ? null
                      : Math.round(layer.average_confidence * 100)
                  }
                  tone={['green', 'cyan', 'yellow', 'blue', 'purple'][index] ?? 'cyan'}
                  count={layer.count}
                />
              );
            })}
          </Panel>
          <Panel
            title={`Running Sessions (${data.active_sessions})`}
            icon="users"
            action={
              <Link className="panel-link" href="/sessions?status=running">
                View details <Icon name="arrow" />
              </Link>
            }
          >
            <div className="session-list">
              {sessions.slice(0, 4).map((session) => (
                <div className="session-row" key={String(session.session_id)}>
                  <i className="status-dot" />
                  <div className="session-client">
                    <strong>
                      <Link
                        href={{ pathname: '/sessions', query: { item: session.session_id } }}
                        prefetch={false}
                      >
                        {session.client_id}
                      </Link>
                    </strong>
                    <small>
                      {session.run_count} agent runs · {session.tool_call_count} tool calls
                    </small>
                  </div>
                  <Badge tone={toneFor(session.status)}>{textValue(session.status)}</Badge>
                </div>
              ))}
              {sessions.length === 0 ? (
                <div className="empty-inline">No running sessions in scope.</div>
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

function Metric({
  label,
  value,
  icon,
  tone,
  progress,
  detail,
  href,
}: {
  label: string;
  value: string | number;
  icon: string;
  tone: string;
  progress?: number;
  detail: string;
  href: string;
}) {
  return (
    <section className={`panel metric-card metric-${tone}`}>
      <div>
        <span className="metric-label">{label}</span>
        <strong>{value}</strong>
        {progress !== undefined ? <Progress value={progress} tone={tone} /> : null}
        <small>{detail}</small>
      </div>
      <div className="metric-side">
        <div className="metric-icon">
          <Icon name={icon} />
        </div>
        <Link className="panel-link" href={href}>
          View <Icon name="arrow" />
        </Link>
      </div>
    </section>
  );
}

function PlanRow({
  index,
  text,
  status,
  tone,
  priority,
  href,
}: {
  index: string;
  text: string;
  status: string;
  tone: string;
  priority: string;
  href: string;
}) {
  return (
    <div className="plan-row">
      <span className="plan-index">{index}</span>
      <Link href={href} prefetch={false}>
        {text}
      </Link>
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

function ContextLayer({
  layer,
  label,
  value,
  tone,
  count,
}: {
  layer: string;
  label: string;
  value: number | null;
  tone: string;
  count: number;
}) {
  return (
    <div className="fresh-row">
      <b>{layer}</b>
      <Link className="fresh-name" href={{ pathname: '/context', query: { layer } }}>
        {label}
      </Link>
      <Progress value={value ?? 0} tone={tone} />
      <small>
        {count} · {value === null ? '—' : `${value}%`}
      </small>
    </div>
  );
}

function contentSummary(value: unknown, fallback: string): string {
  const excerpt = (text: string) => (text.length > 1200 ? text.slice(0, 1200) + '…' : text);
  if (typeof value === 'string' && value.trim()) return excerpt(value);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const summary = record.summary ?? record.description ?? record.decision;
    if (typeof summary === 'string' && summary.trim()) return excerpt(summary);
  }
  return fallback;
}
