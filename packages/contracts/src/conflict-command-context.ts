import {
  assertConflictReceiptIdentity,
  conflictReceiptJson,
  parseConflictCommandIdentity,
  type ConflictCommandIdentity,
} from './conflict-receipt.js';

export const CONFLICT_COMMAND_CONTEXT_BYTES = 16 * 1024;
export interface ConflictCommandContextData {
  identity: ConflictCommandIdentity;
  expires_at: string;
  permissions: { resolve_conflicts: true };
}
export interface ConflictCommandContextEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: ConflictCommandContextData;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new TypeError('Invalid conflict command context fields');
  return value as Record<string, unknown>;
}
/** Caller metadata only; does not establish project visibility or a saved decision. */
export function parseConflictCommandContextEnvelope(
  value: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
  expected?: ConflictCommandIdentity,
): ConflictCommandContextEnvelope {
  conflictReceiptJson(value, CONFLICT_COMMAND_CONTEXT_BYTES);
  const row = object(value, ['schema_version', 'trace_id', 'source_refs', 'data']);
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !trace.trim() ||
    trace.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace) ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length
  )
    throw new TypeError('Invalid conflict command context envelope');
  const data = object(row.data, ['identity', 'expires_at', 'permissions']);
  const identity = parseConflictCommandIdentity(data.identity);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (identity[field] !== scope[field]) throw new TypeError('Conflict command scope changed');
  if (expected) assertConflictReceiptIdentity(expected, identity);
  const permissions = object(data.permissions, ['resolve_conflicts']);
  if (
    permissions.resolve_conflicts !== true ||
    typeof data.expires_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.expires_at) ||
    !Number.isFinite(Date.parse(data.expires_at)) ||
    new Date(data.expires_at).toISOString() !== data.expires_at
  )
    throw new TypeError('Invalid conflict command authority');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: { identity, expires_at: data.expires_at, permissions: { resolve_conflicts: true } },
  };
}
