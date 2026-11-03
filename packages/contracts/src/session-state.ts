import { isUlid } from './ids.js';
import {
  parseSessionClosureState,
  parseSessionCommandIdentity,
  type SessionCommandIdentity,
} from './session-activity.js';

export function parseSessionStateQuery(value: unknown): { session_id: string } {
  const row = object(value);
  if (!isUlid(row.session_id) || Object.keys(row).some((key) => key !== 'session_id'))
    throw new TypeError('Supply only session_id as a ULID');
  return { session_id: row.session_id };
}

/** A current snapshot for review, never an original command receipt. */
export function parseSessionStateEnvelope(
  value: unknown,
  sessionId: string,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
  expectedIdentity?: SessionCommandIdentity,
) {
  const row = object(value);
  if (row.schema_version !== 1 || !trace.trim() || row.trace_id !== trace || row.etag !== undefined)
    throw new TypeError('Invalid session state envelope');
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const) {
    if (typeof scope[field] !== 'string' || !scope[field]?.trim() || row[field] !== scope[field])
      throw new TypeError('Session state scope mismatch');
  }
  if (!Array.isArray(row.source_refs) || row.source_refs.length !== 1)
    throw new TypeError('Invalid session state sources');
  const source = object(row.source_refs[0]);
  if (
    source.type !== 'session' ||
    source.id !== sessionId ||
    Object.keys(source).some((key) => !['type', 'id'].includes(key))
  )
    throw new TypeError('Session state source mismatch');
  const permissions = object(row.session_permissions);
  if (
    typeof permissions.write_sessions !== 'boolean' ||
    Object.keys(permissions).some((key) => key !== 'write_sessions')
  )
    throw new TypeError('Invalid session permissions');
  const identity =
    row.session_identity === undefined
      ? undefined
      : parseSessionCommandIdentity(row.session_identity);
  if (identity) {
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (identity[field] !== scope[field]) throw new TypeError('Session identity scope mismatch');
  } else if (permissions.write_sessions) {
    throw new TypeError('Writable session state requires a verified identity');
  }
  if (expectedIdentity !== undefined) {
    const expected = parseSessionCommandIdentity(expectedIdentity);
    for (const field of [
      'tenant_id',
      'workspace_id',
      'project_id',
      'actor_id',
      'client_id',
    ] as const)
      if (identity?.[field] !== expected[field]) throw new TypeError('Session identity changed');
  }
  return {
    schema_version: 1 as const,
    trace_id: trace,
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id!,
    source_refs: [{ type: 'session', id: sessionId }],
    session_permissions: { write_sessions: permissions.write_sessions },
    ...(identity ? { session_identity: identity } : {}),
    data: parseSessionClosureState(row.data, sessionId),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an object');
  return value as Record<string, unknown>;
}
