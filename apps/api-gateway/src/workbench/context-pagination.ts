import { createHash } from 'node:crypto';
import { ContractError, type ContextItemListQuery } from '@planemem/contracts';
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
        'context-list-v1',
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
      ]),
    )
    .digest('hex');
}

export function encodeContextCursor(position: ContextPosition, queryKey: string): string {
  return Buffer.from(
    JSON.stringify([1, queryKey, position.rank, position.updated, position.id]),
  ).toString('base64url');
}

export function decodeContextCursor(
  cursor: string | undefined,
  queryKey: string,
  trace_id: string,
): ContextPosition | undefined {
  if (cursor === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new Error();
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(decoded) || decoded.length !== 5) throw new Error();
    const [version, key, rank, updated, id] = decoded;
    if (
      version !== 1 ||
      key !== queryKey ||
      ![0, 1, 2].includes(rank) ||
      typeof updated !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(updated) ||
      typeof id !== 'string' ||
      !id ||
      id.length > 255 ||
      /[\u0000\p{Cs}]/u.test(id)
    )
      throw new Error();
    // Validate the calendar without reducing the database's microsecond precision.
    const milliseconds = updated.slice(0, 23) + 'Z';
    if (new Date(milliseconds).toISOString() !== milliseconds || updated.startsWith('0000'))
      throw new Error();
    const position = { rank: rank as number, updated, id };
    if (encodeContextCursor(position, queryKey) !== cursor) throw new Error();
    return position;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid context cursor. Restart from the first page with the current filters.',
      { trace_id },
    );
  }
}
