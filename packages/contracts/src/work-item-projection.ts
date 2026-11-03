import { validateSourceRef, type Classification, type SourceRef } from './metadata.js';

export const WORK_ITEM_STATUSES = [
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
] as const;

export interface WorkItemListQuery {
  query?: string;
  status?: WorkItemProjection['status'];
  cursor?: string;
  limit?: number;
}

export function parseWorkItemListQuery(value: unknown): WorkItemListQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a work item list query');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['query', 'status', 'cursor', 'limit'].includes(key)))
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
  priority: 'P0' | 'P1' | 'P2' | 'P3';
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
    !['P0', 'P1', 'P2', 'P3'].includes(item.priority as string) ||
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
