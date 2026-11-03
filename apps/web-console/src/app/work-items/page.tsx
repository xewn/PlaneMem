import Link from 'next/link';
import {
  WORK_ITEM_PRIORITIES,
  parseWorkItemListQuery,
  type WorkItemProjection,
} from '@planemem/contracts';
import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel, Progress } from '../../components/ui';
import { listWorkbenchWorkItems } from '../../lib/server-api';

type WorkItem = WorkItemProjection;
const columns = [
  ['todo', 'To Do', 'neutral'],
  ['in_progress', 'In Progress', 'cyan'],
  ['in_review', 'In Review', 'purple'],
  ['blocked', 'Blocked', 'red'],
  ['done', 'Done', 'green'],
  ['cancelled', 'Cancelled', 'neutral'],
] as const;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function WorkItemsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  try {
    const params = await searchParams;
    if (
      Object.keys(params).some(
        (key) => !['q', 'status', 'priority', 'owner', 'cursor', 'view', 'item'].includes(key),
      ) ||
      Object.values(params).some((value) => Array.isArray(value)) ||
      (params.view !== undefined && params.view !== 'board' && params.view !== 'list')
    )
      throw new Error('Use one value per work item filter and select the board or list view.');
    const filters = parseWorkItemListQuery({
      query: params.q ?? '',
      status: params.status ?? '',
      priority: params.priority ?? '',
      owner: params.owner ?? '',
      limit: 25,
      ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    });
    const query = filters.query ?? '';
    const status = filters.status ?? '';
    const priority = filters.priority ?? '';
    const owner = filters.owner ?? '';
    const hasFilters = Boolean(query || status || priority || owner);
    const cursor = filters.cursor;
    const list = params.view === 'list';
    const response = await listWorkbenchWorkItems(filters);
    const items = response.data ?? [];
    const requestedId = typeof params.item === 'string' ? params.item : undefined;
    const selected =
      params.item === undefined ? items[0] : items.find((item) => item.id === requestedId);
    const visibleColumns = columns.filter(([value]) =>
      status
        ? value === status
        : value !== 'cancelled' || items.some((item) => item.status === value),
    );
    function href(
      view: string,
      item?: WorkItem,
      pageCursor: string | null = cursor ?? null,
      keepSelected = true,
    ) {
      const search = new URLSearchParams();
      if (query) search.set('q', query);
      if (status) search.set('status', status);
      if (priority) search.set('priority', priority);
      if (owner) search.set('owner', owner);
      if (view === 'list') search.set('view', view);
      if (pageCursor) search.set('cursor', pageCursor);
      if (item) search.set('item', String(item.id));
      else if (keepSelected && requestedId !== undefined) search.set('item', requestedId);
      const suffix = search.toString();
      return suffix ? '/work-items?' + suffix : '/work-items';
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
          key={JSON.stringify([query, status, priority, owner])}
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
          <label className="filter-input">
            <input
              type="text"
              name="owner"
              defaultValue={owner}
              aria-label="Exact owner, case-sensitive"
              placeholder="Exact owner"
              maxLength={255}
              aria-describedby="work-item-owner-hint"
            />
          </label>
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
            >
              Board
            </Link>
            <Link
              className={list ? 'active' : ''}
              aria-current={list ? 'page' : undefined}
              href={href('list', selected)}
            >
              List
            </Link>
          </div>
        </form>
        <p className="muted" id="work-item-owner-hint">
          Owner matches the saved name exactly, including case and spaces. Leave it blank for all
          owners.
        </p>
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
                    href={{ pathname: '/work-items/detail', query: { item: String(selected.id) } }}
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
                    {params.item === undefined
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
                        href={{ pathname: '/work-items/detail', query: { item: requestedId } }}
                        prefetch={false}
                      >
                        Read selected item
                      </Link>
                    </>
                  ) : params.item !== undefined ? (
                    <p>Select one work item from the list or board.</p>
                  ) : null}
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
