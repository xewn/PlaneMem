import { parseSessionCommandIdentity, type SessionCommandIdentity } from './session-activity.js';

export const SESSION_COMMAND_CONTEXT_BYTES = 16 * 1024;
export interface SessionCommandContextPermissions {
  read_sessions: boolean;
  write_sessions: boolean;
  claim_handoffs: boolean;
}
export interface SessionCommandContextData {
  identity: SessionCommandIdentity;
  expires_at: string;
  permissions: SessionCommandContextPermissions;
}
export interface SessionCommandContextEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  data: SessionCommandContextData;
}

/** Interpret only already-verified claims. These flags never authorize a future command. */
export function sessionCommandContextPermissions(authority: {
  roles?: readonly string[];
  capability: readonly string[];
}): SessionCommandContextPermissions {
  const admin = authority.roles?.includes('admin') === true;
  const write_sessions = admin || authority.capability.includes('session.write');
  return {
    read_sessions: admin || authority.capability.includes('context.read'),
    write_sessions,
    claim_handoffs: write_sessions || authority.capability.includes('handoff.claim'),
  };
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !fields.includes(field))
  )
    throw new TypeError('Invalid session command context fields');
  return value as Record<string, unknown>;
}

/** This describes the caller only, not project existence, record visibility or a command receipt. */
export function parseSessionCommandContextEnvelope(
  value: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
  expected?: SessionCommandContextData,
): SessionCommandContextEnvelope {
  const row = object(value, ['schema_version', 'trace_id', 'source_refs', 'data']);
  if (
    new TextEncoder().encode(JSON.stringify(row)).byteLength > SESSION_COMMAND_CONTEXT_BYTES ||
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !trace.trim() ||
    trace.length > 512 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace) ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length ||
    Object.keys(row.source_refs).length
  )
    throw new TypeError('Invalid session command context envelope');
  const data = object(row.data, ['identity', 'expires_at', 'permissions']);
  const identity = parseSessionCommandIdentity(data.identity);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (identity[field] !== scope[field]) throw new TypeError('Session command scope changed');
  const flags = object(data.permissions, ['read_sessions', 'write_sessions', 'claim_handoffs']);
  if (
    typeof flags.read_sessions !== 'boolean' ||
    typeof flags.write_sessions !== 'boolean' ||
    typeof flags.claim_handoffs !== 'boolean' ||
    (flags.write_sessions && !flags.claim_handoffs) ||
    (!flags.read_sessions && !flags.write_sessions && !flags.claim_handoffs)
  )
    throw new TypeError('Invalid session command permissions');
  if (
    typeof data.expires_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.expires_at) ||
    data.expires_at.startsWith('0000') ||
    new Date(data.expires_at).toISOString() !== data.expires_at
  )
    throw new TypeError('Invalid session command expiry');
  const permissions = {
    read_sessions: flags.read_sessions,
    write_sessions: flags.write_sessions,
    claim_handoffs: flags.claim_handoffs,
  };
  if (expected) {
    const expectedIdentity = parseSessionCommandIdentity(expected.identity);
    for (const field of [
      'tenant_id',
      'workspace_id',
      'project_id',
      'actor_id',
      'client_id',
    ] as const)
      if (identity[field] !== expectedIdentity[field])
        throw new TypeError('Session command identity changed');
    if (
      data.expires_at !== expected.expires_at ||
      permissions.read_sessions !== expected.permissions.read_sessions ||
      permissions.write_sessions !== expected.permissions.write_sessions ||
      permissions.claim_handoffs !== expected.permissions.claim_handoffs
    )
      throw new TypeError('Session command authority changed');
  }
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [],
    data: { identity, expires_at: data.expires_at, permissions },
  };
}
