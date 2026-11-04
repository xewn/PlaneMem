import { createHash } from 'node:crypto';
import {
  ContractError,
  encodeContextItemDirectoryCursor,
  parseContextItemDirectoryCursor,
  type ContextItemListQuery,
} from '@planemem/contracts';
import type { WorkbenchScope } from './repository.js';

export interface ContextPosition {
  rank: number;
  updated: string;
  id: string;
}

export function contextQueryKey(scope: WorkbenchScope, filters: ContextItemListQuery): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'context-list-v2',
        scope.tenant_id,
        scope.workspace_id,
        scope.project_id,
        scope.read_restricted === true,
        filters.query ?? '',
        filters.layer ?? '',
        filters.classification ?? '',
        filters.status ?? '',
        filters.item_type ?? '',
        filters.archived === true,
        filters.limit ?? 25,
      ]),
    )
    .digest('hex');
}

export function encodeContextCursor(position: ContextPosition, queryKey: string): string {
  return encodeContextItemDirectoryCursor(queryKey, position);
}

export function decodeContextCursor(
  cursor: string | undefined,
  queryKey: string,
  trace_id: string,
): ContextPosition | undefined {
  if (cursor === undefined) return undefined;
  try {
    const { key, ...position } = parseContextItemDirectoryCursor(cursor);
    if (key !== queryKey) throw new Error();
    return position;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid context cursor. Restart from the first page with the current filters.',
      { trace_id },
    );
  }
}
