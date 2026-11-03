import { createHash } from 'node:crypto';
import {
  ContractError,
  parseConflictRegistryCursor,
  foldConflictQuery,
  type ConflictRegistryQuery,
} from '@planemem/contracts';
import type { WorkbenchScope } from './repository.js';
export function conflictQueryKey(scope: WorkbenchScope, query: ConflictRegistryQuery) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'conflict-registry-v1',
        scope.tenant_id,
        scope.workspace_id,
        scope.project_id,
        scope.read_restricted === true,
        foldConflictQuery(query.query ?? ''),
        query.status ?? '',
        query.entity_type ?? '',
        query.conflict_id ?? '',
        query.limit ?? 25,
      ]),
    )
    .digest('hex');
}
export function decodeConflictCursor(cursor: string | undefined, key: string, trace_id: string) {
  if (cursor === undefined) return undefined;
  try {
    const parsed = parseConflictRegistryCursor(cursor);
    if (parsed.key !== key) throw new TypeError();
    return parsed;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid conflict cursor. Restart from the first page with the current filters.',
      { trace_id },
    );
  }
}
