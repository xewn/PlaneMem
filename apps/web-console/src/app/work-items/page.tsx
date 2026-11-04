import Link from 'next/link';
import { WORK_ITEM_PRIORITIES, type WorkItemProjection } from '@planemem/contracts';
import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel, Progress } from '../../components/ui';
import { listWorkbenchWorkItems } from '../../lib/server-api';
import { WorkItemOwnerFilter } from './owner-filter';
import { WorkItemDueFilter } from './due-filter';
import {
  parseWorkItemBrowseParams,
  workItemBrowseHref,
  workItemDetailHref,
  type WorkItemBrowseState,
  type WorkItemSearchParams,
} from './navigation';

type WorkItem = WorkItemProjection;
const columns = [
  ['todo', 'To Do', 'neutral'],
  ['in_progress', 'In Progress', 'cyan'],
  ['in_review', 'In Review', 'purple'],
  ['blocked', 'Blocked', 'red'],
  ['done', 'Done', 'green'],
  ['cancelled', 'Cancelled', 'neutral'],
] as const;

export default async function WorkItemsPage({
  searchParams,
}: {
  searchParams: Promise<WorkItemSearchParams>;
}) {
  let navigation: WorkItemBrowseState | undefined;
  try {
    const browse = parseWorkItemBrowseParams(await searchParams);
    navigation = browse;
    const { filters, item: requestedId } = browse;
    const query = filters.query ?? '';
    const status = filters.status ?? '';
    const priority = filters.priority ?? '';
    const owner = filters.owner ?? '';
    const assignment = filters.assignment ?? '';
    const due = filters.due ?? '';
    const dueFrom = filters.due_from ?? '';
    const dueBefore = filters.due_before ?? '';
    const hasFilters = Boolean(
      query || status || priority || owner || assignment || due || dueFrom || dueBefore,
    );
    const cursor = filters.cursor;
    const list = browse.view === 'list';
    const response = await listWorkbenchWorkItems(filters);
    const items = response.data ?? [];
    const selected =
      requestedId === undefined ? items[0] : items.find((item) => item.id === requestedId);
    const visibleColumns = columns.filter(([value]) =>
      status
        ? value === status
        : value !== 'cancelled' || items.some((item) => item.status === value),
    );
    function href(
      view: 'board' | 'list',
      item?: WorkItem,
      pageCursor: string | null = cursor ?? null,
      keepSelected = true,
    ) {
      const { cursor: _cursor, ...originalFilters } = filters;
      const selection = item?.id ?? (keepSelected ? requestedId : undefined);
      return workItemBrowseHref({
        filters: { ...originalFilters, ...(pageCursor === null ? {} : { cursor: pageCursor }) },
        view,
        ...(selection === undefined ? {} : { item: selection }),
      });
    }
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Work Items</h1>
            <p>Project work, progress and dependencies from the PlaneMem projection.</p>
          </div>
          <div className="heading-actions">
            <Link className="panel-link" href="/work-items/observed/list" prefetch={false}>
              Browse Plane observations
            </Link>
            <Link className="panel-link" href="/work-items/observed" prefetch={false}>
              Find Plane observation
            </Link>
            <Badge tone="green">{items.length} items on this page</Badge>
          </div>
        </div>
        <form
          className="filters work-item-filters"
          action="/work-items"
          method="get"
          key={JSON.stringify([
            query,
            status,
            priority,
            owner,
            assignment,
            due,
            dueFrom,
            dueBefore,
          ])}
        >
          {list && <input type="hidden" name="view" value="list" />}
          <label className="filter-input">
            <Icon name="search" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              aria-label="Search by ID, title or owner"
              placeholder="ID, title or owner"
              maxLength={500}
            />
          </label>
          <select
            className="filter-chip"
            name="status"
            aria-label="Work item status"
            defaultValue={status}
          >
            <option value="">All statuses</option>
            {columns.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="filter-chip"
            name="priority"
            aria-label="Work item priority"
            defaultValue={priority}
          >
            <option value="">All priorities</option>
            {WORK_ITEM_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <WorkItemOwnerFilter initialAssignment={assignment} initialOwner={owner} />
          <WorkItemDueFilter initialDue={due} initialFrom={dueFrom} initialBefore={dueBefore} />
          <button className="secondary-button" type="submit">
            Apply filters
          </button>
          {hasFilters && (
            <Link className="panel-link" href={list ? '/work-items?view=list' : '/work-items'}>
              Clear filters
            </Link>
          )}
          <div className="view-tabs">
            <Link
              className={!list ? 'active' : ''}
              aria-current={!list ? 'page' : undefined}
              href={href('board', selected)}
              prefetch={false}
            >
              Board
            </Link>
            <Link
              className={list ? 'active' : ''}
              aria-current={list ? 'page' : undefined}
              href={href('list', selected)}
              prefetch={false}
            >
              List
            </Link>
          </div>
        </form>
        <nav className="heading-actions" aria-label="Work item pages">
          <span className="muted">
            Newest updates first · Up to 25 per page. Column counts are for this page.
          </span>
          {cursor ? (
            <Link
              className="panel-link"
              href={href(list ? 'list' : 'board', undefined, null, false)}
              prefetch={false}
            >
              First page
            </Link>
          ) : null}
          {response.next_cursor ? (
            <Link
              className="panel-link"
              href={href(list ? 'list' : 'board', undefined, response.next_cursor, false)}
              prefetch={false}
            >
              Next page
            </Link>
          ) : null}
        </nav>
        <div className="drawer-layout">
          <Panel title={`${items.length} items on this page`} icon="work" className="board-panel">
            {items.length === 0 ? (
              <div className="empty-state">
                <h3>
                  {cursor
                    ? 'No more work items on this page'
                    : hasFilters
                      ? 'No matching work items'
                      : 'No work items in this project'}
                </h3>
                {hasFilters ? <p>Change or clear the filters to see more items.</p> : null}
              </div>
            ) : list ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Work item</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={String(item.id)}>
                        <td>
                          <Link
                            className="work-item-link"
                            href={href('list', item)}
                            scroll={false}
                            prefetch={false}
                            aria-current={selected === item ? 'true' : undefined}
                          >
                            {textValue(item.external_id)} · {textValue(item.title)}
                          </Link>
                        </td>
                        <td>
                          <Badge tone={toneFor(item.status)}>{textValue(item.status)}</Badge>
                        </td>
                        <td>{textValue(item.priority)}</td>
                        <td>{textValue(item.owner)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="board-grid work-item-board">
                {visibleColumns.map(([status, label, tone]) => (
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
                        <WorkCard
                          key={String(item.id)}
                          item={item}
                          href={href('board', item)}
                          selected={selected === item}
                        />
                      ))}
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Selected work item" icon="work" className="drawer">
            <div className="side-detail">
              {selected ? (
                <>
                  <h2>
                    {textValue(selected.external_id)} · {textValue(selected.title)}
                  </h2>
                  <Link
                    className="panel-link"
                    href={workItemDetailHref(selected.id, browse)}
                    prefetch={false}
                  >
                    Open full details and sources
                  </Link>
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
                    <div>
                      <small>Local projection version</small>
                      <strong>{textValue(selected.version)}</strong>
                    </div>
                  </div>
                  <Progress value={numberValue(selected.progress)} tone="cyan" />
                  <div className="proposal">
                    <h4>Description</h4>
                    <p>{textValue(selected.description)}</p>
                    <div className="source-tags">
                      <Badge tone="cyan">{textValue(selected.external_id)}</Badge>
                      <Badge tone="neutral">{textValue(selected.classification)}</Badge>
                    </div>
                  </div>
                  <div className="source-line">
                    <span>Trace ID</span>
                    <strong>{textValue(selected.trace_id)}</strong>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <h3>
                    {requestedId === undefined
                      ? 'No item selected'
                      : 'Selected item is outside this result'}
                  </h3>
                  {requestedId ? (
                    <>
                      <p>
                        Read the item directly to check whether it is still available in this
                        project.
                      </p>
                      <Link
                        className="panel-link"
                        href={workItemDetailHref(requestedId, browse)}
                        prefetch={false}
                      >
                        Read selected item
                      </Link>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    const retryFields = navigation
      ? new URLSearchParams(workItemBrowseHref(navigation).split('?')[1] ?? '')
      : undefined;
    const { cursor: _cursor, ...firstPageFilters } = navigation?.filters ?? {};
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Work Items</h1>
            <p>Project work, progress and dependencies from the PlaneMem projection.</p>
          </div>
        </div>
        <PageError error={error} />
        {navigation && retryFields ? (
          <div className="toolbar">
            <form action="/work-items" method="get">
              {Array.from(retryFields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <button className="primary-button" type="submit">
                Retry this page
              </button>
            </form>
            <Link
              className="panel-link"
              href={workItemBrowseHref({ filters: firstPageFilters, view: navigation.view })}
              prefetch={false}
            >
              First page with these filters
            </Link>
          </div>
        ) : null}
        <Link className="panel-link" href="/work-items" prefetch={false}>
          Restart work item browsing
        </Link>
      </>
    );
  }
}

function WorkCard({ item, href, selected }: { item: WorkItem; href: string; selected: boolean }) {
  return (
    <Link
      className="work-card work-item-link"
      href={href}
      scroll={false}
      prefetch={false}
      aria-current={selected ? 'true' : undefined}
    >
      <strong>
        {textValue(item.external_id)} {textValue(item.title)}
      </strong>
      <div className="work-card-foot">
        <Badge tone={toneFor(item.priority)}>{textValue(item.priority)}</Badge>
        <small>{textValue(item.owner)}</small>
      </div>
      <p>{textValue(item.description)}</p>
      <Progress value={numberValue(item.progress)} tone={toneFor(item.status)} />
    </Link>
  );
}
