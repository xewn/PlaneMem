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

export function workItemQueryKey(scope: WorkbenchScope, query: WorkItemListQuery): string {
  const filters = parseWorkItemListQuery(query);
  const extended = filters.priority !== undefined || filters.owner !== undefined;
  return createHash('sha256')
    .update(
      JSON.stringify([
        extended ? 'work-item-list-v2' : 'work-item-list-v1',
        scope.tenant_id,
        scope.workspace_id,
        scope.project_id,
        scope.read_restricted === true,
        filters.query ?? '',
        filters.status ?? '',
        // Keep the original v1 key for queries without the new filters.
        ...(extended ? [filters.priority ?? '', filters.owner ?? ''] : []),
      ]),
    )
    .digest('hex');
}

export function encodeWorkItemCursor(position: WorkItemPosition, key: string): string {
  return Buffer.from(JSON.stringify([1, key, position.updated, position.id])).toString('base64url');
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
