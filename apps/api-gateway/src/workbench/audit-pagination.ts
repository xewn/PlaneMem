import { createHash } from 'node:crypto';
import {
  ContractError,
  parseWorkbenchAuditCursor,
  type WorkbenchAuditQuery,
} from '@planemem/contracts';
import type { WorkbenchScope } from './repository.js';

export function auditQueryKey(scope: WorkbenchScope, query: WorkbenchAuditQuery): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'workbench-audit-v1',
        scope.tenant_id,
        scope.workspace_id,
        scope.project_id,
        scope.read_restricted === true,
        query.resource ?? '',
        query.trace_id ?? '',
        query.action ?? '',
        query.audit_id ?? '',
        // Preserve existing keys for queries without this filter. Adding, removing or changing
        // the session changes the binding, so its cursor cannot be reused for another session.
        ...(query.session_id === undefined ? [] : ['session_id', query.session_id]),
      ]),
    )
    .digest('hex');
}

export function decodeAuditCursor(cursor: string | undefined, key: string, trace_id: string) {
  if (cursor === undefined) return undefined;
  try {
    const position = parseWorkbenchAuditCursor(cursor);
    if (position.key !== key) throw new TypeError();
    return position;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid audit cursor. Restart from the first page with the current filters and permissions.',
      { trace_id },
    );
  }
}
