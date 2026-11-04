import { validateSourceRef, type Classification, type SourceRef } from './metadata.js';

export const WORK_ITEM_STATUSES = [
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
] as const;

export const WORK_ITEM_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export const WORK_ITEM_ASSIGNMENTS = ['assigned', 'unassigned'] as const;
export const WORK_ITEM_DUE_FILTERS = ['scheduled', 'unscheduled'] as const;

export interface WorkItemListQuery {
  query?: string;
  status?: WorkItemProjection['status'];
  priority?: WorkItemProjection['priority'];
  /** Exact stored owner text; no case folding, trimming or account-ID inference. */
  owner?: string;
  /** Based only on whether the saved owner is exactly empty; no whitespace normalization. */
  assignment?: (typeof WORK_ITEM_ASSIGNMENTS)[number];
  /** Whether the saved due_at is non-null or null; does not imply workflow status. */
  due?: (typeof WORK_ITEM_DUE_FILTERS)[number];
  /** Inclusive UTC midnight of a real YYYY-MM-DD date (years 0001..9999). */
  due_from?: string;
  /** Exclusive UTC midnight of a real YYYY-MM-DD date (years 0001..9999). */
  due_before?: string;
  cursor?: string;
  limit?: number;
}

export function parseWorkItemListQuery(value: unknown): WorkItemListQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a work item list query');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        ![
          'query',
          'status',
          'priority',
          'owner',
          'assignment',
          'due',
          'due_from',
          'due_before',
          'cursor',
          'limit',
        ].includes(key),
    )
  )
    throw new TypeError('Unknown work item list query field');
  const query: WorkItemListQuery = {};
  if (input.query !== undefined) {
    if (
      typeof input.query !== 'string' ||
      input.query.length > 500 ||
      /[\u0000\p{Cs}]/u.test(input.query)
    )
      throw new TypeError('query must be text of at most 500 characters');
    if (input.query.trim()) query.query = input.query.trim();
  }
  if (input.status !== undefined && input.status !== '') {
    if (!WORK_ITEM_STATUSES.includes(input.status as WorkItemProjection['status']))
      throw new TypeError('Invalid work item status');
    query.status = input.status as WorkItemProjection['status'];
  }
  if (input.priority !== undefined && input.priority !== '') {
    if (!WORK_ITEM_PRIORITIES.includes(input.priority as WorkItemProjection['priority']))
      throw new TypeError('Invalid work item priority');
    query.priority = input.priority as WorkItemProjection['priority'];
  }
  if (input.owner !== undefined && input.owner !== '') {
    if (
      typeof input.owner !== 'string' ||
      !input.owner.trim() ||
      input.owner.length > 255 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(input.owner)
    )
      throw new TypeError('owner must be exact non-blank text of at most 255 characters');
    query.owner = input.owner;
  }
  if (input.assignment !== undefined && input.assignment !== '') {
    if (
      !WORK_ITEM_ASSIGNMENTS.includes(
        input.assignment as NonNullable<WorkItemListQuery['assignment']>,
      )
    )
      throw new TypeError('assignment must be assigned or unassigned');
    query.assignment = input.assignment as NonNullable<WorkItemListQuery['assignment']>;
  }
  if (query.assignment === 'unassigned' && query.owner !== undefined)
    throw new TypeError('Unassigned work items cannot be filtered by an exact owner');
  if (input.due !== undefined && input.due !== '') {
    if (!WORK_ITEM_DUE_FILTERS.includes(input.due as NonNullable<WorkItemListQuery['due']>))
      throw new TypeError('due must be scheduled or unscheduled');
    query.due = input.due as NonNullable<WorkItemListQuery['due']>;
  }
  for (const field of ['due_from', 'due_before'] as const) {
    const date = input[field];
    if (date === undefined || date === '') continue;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000'))
      throw new TypeError(`${field} must be a real YYYY-MM-DD date`);
    const midnight = date + 'T00:00:00.000Z';
    const time = Date.parse(midnight);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== midnight)
      throw new TypeError(`${field} must be a real YYYY-MM-DD date`);
    query[field] = date;
  }
  if (
    query.due === 'unscheduled' &&
    (query.due_from !== undefined || query.due_before !== undefined)
  )
    throw new TypeError('Work items without a due date cannot use a due date range');
  if (
    query.due_from !== undefined &&
    query.due_before !== undefined &&
    query.due_from >= query.due_before
  )
    throw new TypeError('due_from must be before the exclusive due_before date');
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(input.cursor))
      throw new TypeError('cursor must be an opaque work item list cursor');
    query.cursor = input.cursor;
  }
  if (input.limit !== undefined) {
    if (
      typeof input.limit !== 'number' ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      throw new TypeError('limit must be an integer between 1 and 100');
    query.limit = input.limit;
  }
  return query;
}

/** Compare a validated saved timestamp to an already parsed query, without using the current clock. */
export function matchesWorkItemDueFilter(
  dueAt: WorkItemProjection['due_at'],
  query: Pick<WorkItemListQuery, 'due' | 'due_from' | 'due_before'>,
): boolean {
  if (dueAt === null)
    return (
      query.due !== 'scheduled' && query.due_from === undefined && query.due_before === undefined
    );
  if (query.due === 'unscheduled') return false;
  // Ranges must not interpret a timezone-free saved timestamp using the reader's local timezone.
  if (
    (query.due_from !== undefined || query.due_before !== undefined) &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(dueAt)
  )
    return false;
  const time = Date.parse(dueAt);
  return (
    Number.isFinite(time) &&
    (query.due_from === undefined || time >= Date.parse(query.due_from + 'T00:00:00.000Z')) &&
    (query.due_before === undefined || time < Date.parse(query.due_before + 'T00:00:00.000Z'))
  );
}

/** Parses the list payload and its envelope-level continuation. */
export function parseWorkItemProjectionList(
  value: unknown,
  input: WorkItemListQuery = {},
): {
  data: WorkItemProjection[];
  next_cursor?: string;
} {
  const query = parseWorkItemListQuery(input);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a work item page');
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.data) || page.data.length > (query.limit ?? 25))
    throw new TypeError('Invalid work item page size');
  const ids = new Set<string>();
  const data = page.data.map((value: unknown) => {
    const id =
      value && typeof value === 'object' ? (value as Record<string, unknown>).id : undefined;
    if (typeof id !== 'string' || ids.has(id)) throw new TypeError('Invalid work item page ID');
    ids.add(id);
    const item = parseWorkItemProjection(value, id);
    if (query.status && item.status !== query.status)
      throw new TypeError('Work item does not match status');
    if (query.priority && item.priority !== query.priority)
      throw new TypeError('Work item does not match priority');
    if (query.owner !== undefined && item.owner !== query.owner)
      throw new TypeError('Work item does not match owner');
    if (
      (query.assignment === 'unassigned' && item.owner !== '') ||
      (query.assignment === 'assigned' && item.owner === '')
    )
      throw new TypeError('Work item does not match assignment');
    if (!matchesWorkItemDueFilter(item.due_at, query))
      throw new TypeError('Work item does not match the saved due date filters');
    return item;
  });
  if (page.next_cursor === undefined) return { data };
  if (
    typeof page.next_cursor !== 'string' ||
    !/^[A-Za-z0-9_-]{1,2048}$/.test(page.next_cursor) ||
    data.length !== (query.limit ?? 25) ||
    page.next_cursor === query.cursor
  )
    throw new TypeError('Invalid work item continuation');
  return { data, next_cursor: page.next_cursor };
}

/** Local workbench snapshot; its version is not a Plane revision or write precondition. */
export interface WorkItemProjection {
  id: string;
  external_id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done' | 'cancelled';
  priority: (typeof WORK_ITEM_PRIORITIES)[number];
  owner: string;
  progress: number;
  description: string;
  due_at: string | null;
  classification: Classification;
  version: string;
  source_refs: SourceRef[];
  trace_id: string;
  created_at: string;
  updated_at: string;
}

export function parseWorkItemProjectionQuery(value: unknown): { item_id: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a work item query');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => key !== 'item_id') ||
    typeof input.item_id !== 'string' ||
    !input.item_id.trim() ||
    input.item_id.length > 255 ||
    input.item_id !== input.item_id.trim() ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(input.item_id)
  )
    throw new TypeError('item_id must be a non-empty local work item ID of at most 255 characters');
  return { item_id: input.item_id };
}

export function parseWorkItemProjection(value: unknown, itemId: string): WorkItemProjection {
  parseWorkItemProjectionQuery({ item_id: itemId });
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a work item projection');
  const item = value as Record<string, unknown>;
  for (const field of ['external_id', 'title', 'owner', 'description', 'trace_id'])
    if (typeof item[field] !== 'string') throw new TypeError(`Invalid work item ${field}`);
  if (
    item.id !== itemId ||
    !['todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'].includes(
      item.status as string,
    ) ||
    !WORK_ITEM_PRIORITIES.includes(item.priority as WorkItemProjection['priority']) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(item.classification as string) ||
    typeof item.progress !== 'number' ||
    !Number.isInteger(item.progress) ||
    item.progress < 0 ||
    item.progress > 100 ||
    typeof item.version !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(item.version) ||
    BigInt(item.version) > 9223372036854775807n ||
    !Array.isArray(item.source_refs)
  )
    throw new TypeError('Invalid work item projection');
  for (const field of ['created_at', 'updated_at', 'due_at']) {
    const timestamp = item[field];
    if (field === 'due_at' && timestamp === null) continue;
    if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)))
      throw new TypeError(`Invalid work item ${field}`);
  }
  const source_refs = item.source_refs.map((value) => {
    const ref = validateSourceRef(value);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
  return {
    id: itemId,
    external_id: item.external_id as string,
    title: item.title as string,
    status: item.status as WorkItemProjection['status'],
    priority: item.priority as WorkItemProjection['priority'],
    owner: item.owner as string,
    progress: item.progress,
    description: item.description as string,
    due_at: item.due_at as string | null,
    classification: item.classification as Classification,
    version: item.version,
    source_refs,
    trace_id: item.trace_id as string,
    created_at: item.created_at as string,
    updated_at: item.updated_at as string,
  };
}
