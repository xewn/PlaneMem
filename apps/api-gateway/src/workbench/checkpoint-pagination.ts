import { createHash } from 'node:crypto';
import {
  ContractError,
  parseCheckpointRegistryCursor,
  type CheckpointRegistryQuery,
} from '@planemem/contracts';
import type { WorkbenchScope } from './repository.js';

export function checkpointQueryKey(scope: WorkbenchScope, query: CheckpointRegistryQuery) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'checkpoint-registry-v1',
        scope.tenant_id,
        scope.workspace_id,
        scope.project_id,
        scope.read_restricted === true,
        query.query ?? '',
        query.checkpoint_id ?? '',
        query.limit ?? 25,
      ]),
    )
    .digest('hex');
}
export function decodeCheckpointCursor(cursor: string | undefined, key: string, trace_id: string) {
  if (cursor === undefined) return undefined;
  try {
    const parsed = parseCheckpointRegistryCursor(cursor);
    if (parsed.key !== key) throw new TypeError();
    return parsed;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid checkpoint cursor. Restart from the first page with the current filters.',
      { trace_id },
    );
  }
}
