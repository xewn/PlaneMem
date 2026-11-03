import { createHash } from 'node:crypto';
import {
  ContractError,
  parseHandoffRegistryCursor,
  type HandoffRegistryQuery,
} from '@planemem/contracts';
import type { WorkbenchScope } from './repository.js';

export function handoffQueryKey(scope: WorkbenchScope, query: HandoffRegistryQuery) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'handoff-registry-v1',
        scope.tenant_id,
        scope.workspace_id,
        scope.project_id,
        scope.read_restricted === true,
        query.query ?? '',
        query.status ?? '',
        query.origin ?? '',
        query.session_id ?? '',
        query.limit ?? 25,
      ]),
    )
    .digest('hex');
}
export function decodeHandoffCursor(cursor: string | undefined, key: string, trace_id: string) {
  if (cursor === undefined) return undefined;
  try {
    const parsed = parseHandoffRegistryCursor(cursor);
    if (parsed.key !== key) throw new TypeError();
    return parsed;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid handoff cursor. Restart from the first page with the current filters.',
      { trace_id },
    );
  }
}
