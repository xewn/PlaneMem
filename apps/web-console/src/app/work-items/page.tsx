import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel, Progress } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';

type WorkItem = Record<string, unknown>;
const columns = [
  ['todo', 'To Do', 'neutral'],
  ['in_progress', 'In Progress', 'cyan'],
  ['in_review', 'In Review', 'purple'],
  ['blocked', 'Blocked', 'red'],
  ['done', 'Done', 'green'],
] as const;

export default async function WorkItemsPage() {
  try {
    const response = await queryWorkbench<WorkItem[]>('work_items');
    const items = response.data ?? [];
    const selected = items[0];
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Work Items</h1>
            <p>Project work, progress and dependencies from the PlaneMem projection.</p>
          </div>
          <div className="heading-actions">
            <Badge tone="green">{items.length} items</Badge>
            <button className="primary-button">New work item</button>
          </div>
        </div>
        <div className="filters">
          <div className="filter-input">
            <Icon name="search" />
            Search work items
          </div>
          <button className="filter-chip">
            Filters <Icon name="chevron" />
          </button>
          <button className="filter-chip">
            Group by <Icon name="chevron" />
          </button>
          <div className="view-tabs">
            <span className="active">Board</span>
            <span>List</span>
            <span>Timeline</span>
          </div>
        </div>
        <div className="drawer-layout">
          <Panel title={`${items.length} items`} icon="work" className="board-panel">
            <div className="board-grid">
              {columns.map(([status, label, tone]) => (
                <div className="board-column" key={status}>
                  <div className="board-column-head">
                    <span>
                      <i className={`column-dot dot-${tone}`} /> {label}
                    </span>
                    <b>{items.filter((item) => String(item.status) === status).length}</b>
                  </div>
                  {items
                    .filter((item) => String(item.status) === status)
                    .map((item) => (
                      <WorkCard key={String(item.id)} item={item} />
                    ))}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Selected work item" icon="work" className="drawer">
            <div className="side-detail">
              {selected ? (
                <>
                  <h2>
                    {textValue(selected.external_id)} · {textValue(selected.title)}
                  </h2>
                  <div className="drawer-badges">
                    <Badge tone={toneFor(selected.priority)}>{textValue(selected.priority)}</Badge>
                    <Badge tone={toneFor(selected.status)}>
                      {textValue(selected.status).replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="detail-grid">
                    <div>
                      <small>Owner</small>
                      <strong>{textValue(selected.owner)}</strong>
                    </div>
                    <div>
                      <small>Due date</small>
                      <strong>{textValue(selected.due_at)}</strong>
                    </div>
                    <div>
                      <small>Progress</small>
                      <strong>{numberValue(selected.progress)}%</strong>
                    </div>
                    <div>
                      <small>Classification</small>
                      <strong>{textValue(selected.classification)}</strong>
                    </div>
                  </div>
                  <Progress value={numberValue(selected.progress)} tone="cyan" />
                  <div className="proposal">
                    <h4>AI work proposal</h4>
                    <p>{textValue(selected.description)}</p>
                    <div className="source-tags">
                      <Badge tone="cyan">{textValue(selected.external_id)}</Badge>
                      <Badge tone="neutral">{textValue(selected.classification)}</Badge>
                    </div>
                  </div>
                  <div className="confirmation-box">
                    <span className="check-box" />
                    <div>
                      <strong>Human confirmation</strong>
                      <small>Review the scoped proposal before changing status or ownership.</small>
                    </div>
                  </div>
                  <div className="source-line"><span>Trace ID</span><strong>{textValue(selected.trace_id)}</strong></div>
                  <div className="drawer-tabs">
                    <span className="active">Details</span>
                    <span>Context</span>
                    <span>Dependencies</span>
                    <span>Activity</span>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <h3>No work items</h3>
                  <p>Query returned no records in the current project scope.</p>
                </div>
              )}
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
            <h1>Work Items</h1>
            <p>Project work, progress and dependencies from the PlaneMem projection.</p>
          </div>
        </div>
        <PageError error={error} />
      </>
    );
  }
}

function WorkCard({ item }: { item: WorkItem }) {
  return (
    <article className="work-card">
      <strong>
        {textValue(item.external_id)} {textValue(item.title)}
      </strong>
      <div className="work-card-foot">
        <Badge tone={toneFor(item.priority)}>{textValue(item.priority)}</Badge>
        <small>{textValue(item.owner)}</small>
      </div>
      <p>{textValue(item.description)}</p>
      <Progress value={numberValue(item.progress)} tone={toneFor(item.status)} />
    </article>
  );
}
