import {
  parseWorkItemListQuery,
  parseWorkItemProjectionQuery,
  type WorkItemListQuery,
} from '@planemem/contracts';
import { parseProjectSearchReturn } from '../search/navigation';

export type WorkItemSearchParams = Record<string, string | string[] | undefined>;
export interface WorkItemBrowseState {
  filters: WorkItemListQuery;
  view: 'board' | 'list';
  item?: string;
}
export interface WorkItemDetailNavigation {
  item_id: string;
  browse: WorkItemBrowseState;
  return_href: string;
}

const fields = [
  'q',
  'sort',
  'status',
  'priority',
  'owner',
  'assignment',
  'due',
  'due_from',
  'due_before',
  'cursor',
  'view',
  'item',
];
const MAX_RETURN_LENGTH = 16 * 1024;

/** List entry and detail return paths use exactly the same query interpretation. */
export function parseWorkItemBrowseParams(params: WorkItemSearchParams): WorkItemBrowseState {
  if (
    Object.keys(params).some((key) => !fields.includes(key)) ||
    Object.values(params).some((value) => Array.isArray(value)) ||
    (params.view !== undefined && params.view !== 'board' && params.view !== 'list')
  )
    throw new Error('Use one value per work item filter and select the board or list view.');
  const filters = parseWorkItemListQuery({
    query: params.q ?? '',
    sort: params.sort ?? '',
    status: params.status ?? '',
    priority: params.priority ?? '',
    owner: params.owner ?? '',
    assignment: params.assignment ?? '',
    due: params.due ?? '',
    due_from: params.due_from ?? '',
    due_before: params.due_before ?? '',
    limit: 25,
    ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
  });
  const item =
    params.item === undefined
      ? undefined
      : parseWorkItemProjectionQuery({ item_id: params.item }).item_id;
  return {
    filters,
    view: params.view === 'list' ? 'list' : 'board',
    ...(item === undefined ? {} : { item }),
  };
}

/** The path is fixed; all caller-controlled values are encoded query fields. */
export function workItemBrowseHref(state: WorkItemBrowseState): string {
  const filters = parseWorkItemListQuery(state.filters);
  if (
    (filters.limit !== undefined && filters.limit !== 25) ||
    !['board', 'list'].includes(state.view)
  )
    throw new Error('Use the work item browser page size and view.');
  const search = new URLSearchParams();
  if (filters.query) search.set('q', filters.query);
  if (filters.sort) search.set('sort', filters.sort);
  if (filters.status) search.set('status', filters.status);
  if (filters.priority) search.set('priority', filters.priority);
  if (filters.owner) search.set('owner', filters.owner);
  if (filters.assignment) search.set('assignment', filters.assignment);
  if (filters.due) search.set('due', filters.due);
  if (filters.due_from) search.set('due_from', filters.due_from);
  if (filters.due_before) search.set('due_before', filters.due_before);
  if (filters.cursor) search.set('cursor', filters.cursor);
  if (state.view === 'list') search.set('view', 'list');
  if (state.item !== undefined)
    search.set('item', parseWorkItemProjectionQuery({ item_id: state.item }).item_id);
  return '/work-items' + (search.size ? '?' + search.toString() : '');
}

export function workItemDetailHref(itemId: string, browse: WorkItemBrowseState): string {
  const { item_id } = parseWorkItemProjectionQuery({ item_id: itemId });
  const returnHref = workItemBrowseHref({ ...browse, item: item_id });
  if (returnHref.length > MAX_RETURN_LENGTH)
    throw new Error('The work item return query is too long.');
  return (
    '/work-items/detail?' + new URLSearchParams({ item: item_id, return_to: returnHref }).toString()
  );
}

/** return_to is navigation data, never an authorization claim or an arbitrary redirect target. */
export function parseWorkItemDetailParams(params: WorkItemSearchParams): WorkItemDetailNavigation {
  if (
    Object.keys(params).some((key) => !['item', 'return_to'].includes(key)) ||
    Object.values(params).some((value) => Array.isArray(value))
  )
    throw new Error('Select one work item and at most one work item return path.');
  const { item_id } = parseWorkItemProjectionQuery({ item_id: params.item });
  const input = params.return_to;
  let browse: WorkItemBrowseState;
  if (input === undefined) {
    browse = { filters: { limit: 25 }, view: 'board', item: item_id };
  } else if (typeof input === 'string' && input.startsWith('/search?')) {
    return {
      item_id,
      browse: { filters: { limit: 25 }, view: 'board', item: item_id },
      return_href: parseProjectSearchReturn(input, { type: 'work_item', id: item_id }),
    };
  } else {
    if (
      typeof input !== 'string' ||
      input.length > MAX_RETURN_LENGTH ||
      input.includes('#') ||
      (input !== '/work-items' && !input.startsWith('/work-items?'))
    )
      throw new Error('Return to a work item results page in this application.');
    const search = new URLSearchParams(
      input === '/work-items' ? '' : input.slice('/work-items?'.length),
    );
    const values: WorkItemSearchParams = Object.create(null) as WorkItemSearchParams;
    for (const [key, value] of search) {
      if (!fields.includes(key) || Object.hasOwn(values, key))
        throw new Error('Use one value per work item return filter.');
      values[key] = value;
    }
    browse = parseWorkItemBrowseParams(values);
    if (browse.item !== undefined && browse.item !== item_id)
      throw new Error('The work item return selection must match the detail item.');
    browse = { ...browse, item: item_id };
  }
  return { item_id, browse, return_href: workItemBrowseHref(browse) };
}
