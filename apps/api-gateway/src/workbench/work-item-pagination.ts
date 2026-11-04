import { createHash } from 'node:crypto';
import {
  ContractError,
  parseWorkItemListQuery,
  parseWorkItemProjectionQuery,
  type WorkItemListQuery,
} from '@planemem/contracts';
import type { WorkbenchScope } from './repository.js';

interface WorkItemPosition {
  updated: string;
  id: string;
}
interface WorkItemDuePosition {
  due: string | null;
  id: string;
}

export function workItemQueryKey(scope: WorkbenchScope, query: WorkItemListQuery): string {
  const filters = parseWorkItemListQuery(query);
  const dueSort = filters.sort === 'due_asc';
  const withDue =
    filters.due !== undefined || filters.due_from !== undefined || filters.due_before !== undefined;
  const withAssignment = filters.assignment !== undefined;
  const extended =
    filters.priority !== undefined ||
    filters.owner !== undefined ||
    withAssignment ||
    withDue ||
    dueSort;
  return createHash('sha256')
    .update(
      JSON.stringify([
        dueSort
          ? 'work-item-list-v5'
          : withDue
            ? 'work-item-list-v4'
            : withAssignment
              ? 'work-item-list-v3'
              : extended
                ? 'work-item-list-v2'
                : 'work-item-list-v1',
        scope.tenant_id,
        scope.workspace_id,
        scope.project_id,
        scope.read_restricted === true,
        filters.query ?? '',
        filters.status ?? '',
        // Default sorting preserves existing v1-v4 bindings, including an explicit default.
        ...(extended ? [filters.priority ?? '', filters.owner ?? ''] : []),
        ...(withAssignment || withDue || dueSort ? [filters.assignment ?? ''] : []),
        ...(withDue || dueSort
          ? [filters.due ?? '', filters.due_from ?? '', filters.due_before ?? '']
          : []),
        ...(dueSort ? ['due_asc'] : []),
      ]),
    )
    .digest('hex');
}

export function encodeWorkItemCursor(position: WorkItemPosition, key: string): string {
  return Buffer.from(JSON.stringify([1, key, position.updated, position.id])).toString('base64url');
}

export function encodeWorkItemDueCursor(position: WorkItemDuePosition, key: string): string {
  const parsed = parseDuePosition(position.due, position.id);
  return Buffer.from(JSON.stringify([2, key, 'due_asc', parsed.due, parsed.id])).toString(
    'base64url',
  );
}

function parseDuePosition(due: unknown, id: unknown): WorkItemDuePosition {
  if (due !== null) {
    if (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(due))
      throw new TypeError();
    const milliseconds = due.slice(0, 23) + 'Z';
    if (due.startsWith('0000') || new Date(milliseconds).toISOString() !== milliseconds)
      throw new TypeError();
  }
  return { due, id: parseWorkItemProjectionQuery({ item_id: id }).item_id };
}

/** The null tail is a distinct keyset region; it must never restart at dated records. */
export function decodeWorkItemDueCursor(
  cursor: string | undefined,
  key: string,
  trace_id: string,
): WorkItemDuePosition | undefined {
  if (cursor === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new TypeError();
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 5) throw new TypeError();
    const [version, queryKey, sort, due, id] = value;
    if (version !== 2 || queryKey !== key || sort !== 'due_asc') throw new TypeError();
    const position = parseDuePosition(due, id);
    if (encodeWorkItemDueCursor(position, key) !== cursor) throw new TypeError();
    return position;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid deadline cursor. Restart from the first page with the current filters and sort.',
      { trace_id },
    );
  }
}

export function decodeWorkItemCursor(
  cursor: string | undefined,
  key: string,
  trace_id: string,
): WorkItemPosition | undefined {
  if (cursor === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 4) throw new Error();
    const [version, queryKey, updated, id] = value;
    if (
      version !== 1 ||
      queryKey !== key ||
      typeof updated !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(updated)
    )
      throw new Error();
    const milliseconds = updated.slice(0, 23) + 'Z';
    if (updated.startsWith('0000') || new Date(milliseconds).toISOString() !== milliseconds)
      throw new Error();
    const { item_id } = parseWorkItemProjectionQuery({ item_id: id });
    const position = { updated, id: item_id };
    if (encodeWorkItemCursor(position, key) !== cursor) throw new Error();
    return position;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid work item cursor. Restart from the first page with the current filters.',
      { trace_id },
    );
  }
}
