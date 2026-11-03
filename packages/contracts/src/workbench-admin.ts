export const WORKBENCH_ADMIN_RESPONSE_BYTES = 16 * 1024;
export const WORKBENCH_ADMIN_CHECKS = [
  'audit_write',
  'identity_provider',
  'policy_service',
  'plane_connector',
  'telemetry',
  'release_readiness',
] as const;

export interface WorkbenchAdminScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}
export type WorkbenchAdminCount =
  | { state: 'available'; value: number }
  | { state: 'not-authorized'; value: null };
export interface WorkbenchAdminSnapshot {
  read_at: string;
  gateway_version: string;
  database: { state: 'read-succeeded'; version: string };
  counts: {
    audit_records: WorkbenchAdminCount;
    running_sessions: WorkbenchAdminCount;
    open_conflicts: WorkbenchAdminCount;
  };
  checks: Record<(typeof WORKBENCH_ADMIN_CHECKS)[number], 'not-checked'>;
}
export interface WorkbenchAdminEnvelope {
  schema_version: 1;
  trace_id: string;
  scope: WorkbenchAdminScope;
  source_refs: Array<{ type: string; id: string }>;
  data: WorkbenchAdminSnapshot;
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new TypeError('Invalid administration snapshot object');
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid administration snapshot text');
  return value;
}
function count(value: unknown): WorkbenchAdminCount {
  const row = object(value, ['state', 'value']);
  if (row.state === 'not-authorized' && row.value === null)
    return { state: 'not-authorized', value: null };
  if (
    row.state !== 'available' ||
    typeof row.value !== 'number' ||
    !Number.isSafeInteger(row.value) ||
    row.value < 0
  )
    throw new TypeError('Invalid administration snapshot count');
  return { state: 'available', value: row.value };
}

export function workbenchAdminSources(counts: WorkbenchAdminSnapshot['counts']) {
  return [
    { type: 'runtime', id: 'api-gateway' },
    { type: 'postgres', id: 'pg_settings' },
    { type: 'postgres', id: 'wcp_projects' },
    ...(counts.audit_records.state === 'available'
      ? [{ type: 'postgres', id: 'wcp_audit_records' }]
      : []),
    ...(counts.running_sessions.state === 'available'
      ? [
          { type: 'postgres', id: 'wcp_sessions' },
          { type: 'postgres', id: 'wcp_conflicts' },
        ]
      : []),
  ];
}

/** Query observations only: none of these fields attest external health or release readiness. */
export function parseWorkbenchAdminEnvelope(
  value: unknown,
  expectedScope: WorkbenchAdminScope,
  trace: string,
  expectedAccess?: { audit: boolean; context: boolean },
): WorkbenchAdminEnvelope {
  const input = object(value, ['schema_version', 'trace_id', 'scope', 'source_refs', 'data']);
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > WORKBENCH_ADMIN_RESPONSE_BYTES)
    throw new TypeError('Administration snapshot is too large');
  const scope = object(input.scope, ['tenant_id', 'workspace_id', 'project_id']);
  const parsedScope = {
    tenant_id: text(scope.tenant_id, 256),
    workspace_id: text(scope.workspace_id, 256),
    project_id: text(scope.project_id, 256),
  };
  if (
    input.schema_version !== 1 ||
    text(input.trace_id, 512) !== trace ||
    parsedScope.tenant_id !== expectedScope.tenant_id ||
    parsedScope.workspace_id !== expectedScope.workspace_id ||
    parsedScope.project_id !== expectedScope.project_id
  )
    throw new TypeError('Administration snapshot does not match the request');
  const data = object(input.data, ['read_at', 'gateway_version', 'database', 'counts', 'checks']);
  const read_at = text(data.read_at, 24);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(read_at) ||
    read_at.startsWith('0000') ||
    new Date(read_at).toISOString() !== read_at
  )
    throw new TypeError('Invalid administration snapshot time');
  const database = object(data.database, ['state', 'version']);
  if (database.state !== 'read-succeeded') throw new TypeError('Invalid database observation');
  const rawCounts = object(data.counts, ['audit_records', 'running_sessions', 'open_conflicts']);
  const counts = {
    audit_records: count(rawCounts.audit_records),
    running_sessions: count(rawCounts.running_sessions),
    open_conflicts: count(rawCounts.open_conflicts),
  };
  if (counts.running_sessions.state !== counts.open_conflicts.state)
    throw new TypeError('Inconsistent context count access');
  if (
    expectedAccess &&
    ((counts.audit_records.state === 'available') !== expectedAccess.audit ||
      (counts.running_sessions.state === 'available') !== expectedAccess.context)
  )
    throw new TypeError('Administration count access does not match the trusted session');
  const rawChecks = object(data.checks, [...WORKBENCH_ADMIN_CHECKS]);
  if (WORKBENCH_ADMIN_CHECKS.some((key) => rawChecks[key] !== 'not-checked'))
    throw new TypeError('Unsupported external health assertion');
  const checks = Object.fromEntries(
    WORKBENCH_ADMIN_CHECKS.map((key) => [key, 'not-checked']),
  ) as WorkbenchAdminSnapshot['checks'];
  const source_refs = workbenchAdminSources(counts);
  if (
    !Array.isArray(input.source_refs) ||
    input.source_refs.length !== source_refs.length ||
    input.source_refs.some((value, index) => {
      const ref = object(value, ['type', 'id']);
      return ref.type !== source_refs[index]?.type || ref.id !== source_refs[index]?.id;
    })
  )
    throw new TypeError('Invalid administration snapshot sources');
  return {
    schema_version: 1,
    trace_id: trace,
    scope: parsedScope,
    source_refs,
    data: {
      read_at,
      gateway_version: text(data.gateway_version, 128),
      database: { state: 'read-succeeded', version: text(database.version, 128) },
      counts,
      checks,
    },
  };
}
