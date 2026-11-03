import { createHash } from 'node:crypto';
import {
  ContractError,
  parseSessionRegistryCursor,
  type SessionRegistryQuery,
} from '@planemem/contracts';
import type { WorkbenchScope } from './repository.js';

export function sessionQueryKey(scope: WorkbenchScope, query: SessionRegistryQuery): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'session-registry-v1',
        scope.tenant_id,
        scope.workspace_id,
        scope.project_id,
        scope.read_restricted === true,
        query.query ?? '',
        query.status ?? '',
        query.client_id ?? '',
        query.limit ?? 25,
      ]),
    )
    .digest('hex');
}

export function decodeSessionCursor(cursor: string | undefined, key: string, trace_id: string) {
  if (cursor === undefined) return undefined;
  try {
    const position = parseSessionRegistryCursor(cursor);
    if (position.key !== key) throw new TypeError();
    return position;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid session cursor. Restart from the first page with the current filters.',
      { trace_id },
    );
  }
}
