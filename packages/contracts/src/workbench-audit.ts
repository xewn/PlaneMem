import { isUlid } from './ids.js';
import { validateSourceRef, type Classification, type SourceRef } from './metadata.js';

export const WORKBENCH_AUDIT_LIMIT = 200;
export const WORKBENCH_AUDIT_METADATA_BYTES = 16 * 1024;
export const WORKBENCH_AUDIT_DETAILS_BYTES = 32 * 1024;
export const WORKBENCH_AUDIT_SOURCES_BYTES = 16 * 1024;
export const WORKBENCH_AUDIT_RESPONSE_BYTES = 16 * 1024 * 1024;
export const WORKBENCH_AUDIT_ERROR_BYTES = 16 * 1024;
const AUDIT_RECORD_BYTES =
  WORKBENCH_AUDIT_METADATA_BYTES +
  WORKBENCH_AUDIT_DETAILS_BYTES +
  WORKBENCH_AUDIT_SOURCES_BYTES +
  4096;
export interface WorkbenchAuditQuery {
  resource?: string;
  trace_id?: string;
  action?: string;
  audit_id?: string;
  session_id?: string;
  cursor?: string;
}
export interface WorkbenchAuditScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}
export interface WorkbenchAuditRecord {
  audit_id: string;
  actor_id: string;
  client_id: string;
  session_id: string | null;
  action: string;
  resource: string;
  result: 'allowed' | 'denied' | 'error';
  classification: Classification;
  details: unknown;
  details_state: 'available' | 'too-large';
  details_bytes: number;
  trace_id: string;
  source_refs: SourceRef[];
  source_refs_state: 'available' | 'too-large';
  source_refs_bytes: number;
  occurred_at: string;
}
export interface WorkbenchAuditEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: Array<{ type: string; id: string }>;
  scope: WorkbenchAuditScope;
  data: WorkbenchAuditRecord[];
  has_more: boolean;
  next_cursor?: string;
}

export interface WorkbenchAuditPosition {
  occurred_at: string;
  audit_id: string;
}

/** Keep PostgreSQL microseconds intact when ordering and resuming a page. */
export function parseWorkbenchAuditPosition(value: unknown): WorkbenchAuditPosition {
  const row = object(value);
  const time = text(row.occurred_at);
  if (
    !isUlid(row.audit_id) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/.test(time)
  )
    throw new TypeError('Invalid audit position');
  const milliseconds = time.slice(0, 23) + 'Z';
  if (time.startsWith('0000') || new Date(milliseconds).toISOString() !== milliseconds)
    throw new TypeError('Invalid audit timestamp');
  return {
    occurred_at: time.length === 24 ? time.slice(0, 23) + '000Z' : time,
    audit_id: row.audit_id,
  };
}

export function compareWorkbenchAuditPositions(
  left: WorkbenchAuditPosition,
  right: WorkbenchAuditPosition,
): number {
  if (left.occurred_at !== right.occurred_at) return left.occurred_at < right.occurred_at ? -1 : 1;
  return left.audit_id === right.audit_id ? 0 : left.audit_id < right.audit_id ? -1 : 1;
}

/** The key binds query context; this encoding is not a signature or access credential. */
export function encodeWorkbenchAuditCursor(key: string, value: WorkbenchAuditPosition): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new TypeError('Invalid audit cursor key');
  const position = parseWorkbenchAuditPosition(value);
  // All cursor fields are validated ASCII; no Unicode/base64 conversion is needed.
  return btoa(JSON.stringify([1, key, position.occurred_at, position.audit_id]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function parseWorkbenchAuditCursor(
  value: unknown,
): WorkbenchAuditPosition & { key: string } {
  try {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(value))
      throw new TypeError('Invalid audit cursor');
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const parsed: unknown = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 4 ||
      parsed[0] !== 1 ||
      typeof parsed[1] !== 'string'
    )
      throw new TypeError('Invalid audit cursor');
    const key = parsed[1];
    const position = parseWorkbenchAuditPosition({ occurred_at: parsed[2], audit_id: parsed[3] });
    if (encodeWorkbenchAuditCursor(key, position) !== value)
      throw new TypeError('Noncanonical audit cursor');
    return { ...position, key };
  } catch {
    throw new TypeError('Invalid audit cursor. Restart from the newest matching records.');
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid audit object');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length) throw new TypeError('Invalid audit text');
  return value;
}

function jsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Invalid audit JSON');
  return new TextEncoder().encode(serialized).byteLength;
}

function byteCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new TypeError('Invalid audit field size');
  return value;
}

/** Exact matches only; query trace_id is distinct from the request envelope trace. */
export function parseWorkbenchAuditQuery(value: unknown): WorkbenchAuditQuery {
  const input = object(value);
  const limits = {
    resource: 2048,
    trace_id: 512,
    action: 256,
    audit_id: 26,
    session_id: 26,
    cursor: 1024,
  } as const;
  if (Object.keys(input).some((key) => !Object.hasOwn(limits, key)))
    throw new TypeError('Unsupported audit filter');
  const result: WorkbenchAuditQuery = {};
  for (const key of Object.keys(limits) as Array<keyof typeof limits>) {
    if (input[key] === undefined) continue;
    const field = text(input[key]);
    if (field.length > limits[key] || /[\u0000-\u001f\u007f]/.test(field))
      throw new TypeError('Invalid audit filter');
    if (key === 'audit_id' && !isUlid(field)) throw new TypeError('Invalid audit ID');
    if (key === 'session_id' && !isUlid(field)) throw new TypeError('Invalid audit session ID');
    if (key === 'cursor') parseWorkbenchAuditCursor(field);
    result[key] = field;
  }
  if (result.audit_id !== undefined && result.cursor !== undefined)
    throw new TypeError('An exact audit ID lookup cannot have a page cursor');
  return result;
}

export function parseWorkbenchAuditRecord(value: unknown): WorkbenchAuditRecord {
  const row = object(value);
  if (jsonBytes(row) > AUDIT_RECORD_BYTES) throw new TypeError('Audit record is too large');
  const position = parseWorkbenchAuditPosition(row);
  const details_bytes = byteCount(row.details_bytes);
  const source_refs_bytes = byteCount(row.source_refs_bytes);
  if (
    !isUlid(row.audit_id) ||
    !['allowed', 'denied', 'error'].includes(text(row.result)) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(text(row.classification)) ||
    !Array.isArray(row.source_refs) ||
    !Object.hasOwn(row, 'details') ||
    row.details === undefined ||
    !['available', 'too-large'].includes(text(row.details_state)) ||
    !['available', 'too-large'].includes(text(row.source_refs_state))
  )
    throw new TypeError('Invalid audit record');
  if (
    (row.details_state === 'available'
      ? details_bytes > WORKBENCH_AUDIT_DETAILS_BYTES ||
        jsonBytes(row.details) > WORKBENCH_AUDIT_DETAILS_BYTES
      : details_bytes <= WORKBENCH_AUDIT_DETAILS_BYTES || row.details !== null) ||
    (row.source_refs_state === 'available'
      ? source_refs_bytes > WORKBENCH_AUDIT_SOURCES_BYTES ||
        jsonBytes(row.source_refs) > WORKBENCH_AUDIT_SOURCES_BYTES
      : source_refs_bytes <= WORKBENCH_AUDIT_SOURCES_BYTES || row.source_refs.length !== 0)
  )
    throw new TypeError('Invalid audit field availability');
  const metadata = {
    audit_id: row.audit_id,
    actor_id: row.actor_id,
    client_id: row.client_id,
    session_id: row.session_id,
    action: row.action,
    resource: row.resource,
    result: row.result,
    classification: row.classification,
    trace_id: row.trace_id,
    occurred_at: position.occurred_at,
  };
  if (jsonBytes(metadata) > WORKBENCH_AUDIT_METADATA_BYTES)
    throw new TypeError('Audit metadata is too large');
  const source_refs = row.source_refs.map((value) => {
    const ref = validateSourceRef(value);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
  return {
    audit_id: row.audit_id,
    actor_id: text(row.actor_id),
    client_id: text(row.client_id),
    session_id: row.session_id === null ? null : text(row.session_id),
    action: text(row.action),
    resource: text(row.resource),
    result: row.result as WorkbenchAuditRecord['result'],
    classification: row.classification as Classification,
    details: row.details,
    details_state: row.details_state as WorkbenchAuditRecord['details_state'],
    details_bytes,
    trace_id: text(row.trace_id),
    source_refs,
    source_refs_state: row.source_refs_state as WorkbenchAuditRecord['source_refs_state'],
    source_refs_bytes,
    occurred_at: position.occurred_at,
  };
}

export function parseWorkbenchAuditEnvelope(
  value: unknown,
  query: WorkbenchAuditQuery,
  scope: WorkbenchAuditScope,
  trace: string,
): WorkbenchAuditEnvelope {
  const input = object(value);
  if (jsonBytes(input) > WORKBENCH_AUDIT_RESPONSE_BYTES)
    throw new TypeError('Audit response is too large');
  const returnedScope = object(input.scope);
  const filters = parseWorkbenchAuditQuery(query);
  const { cursor, ...exactFilters } = filters;
  const before = cursor === undefined ? undefined : parseWorkbenchAuditCursor(cursor);
  if (
    input.schema_version !== 1 ||
    input.trace_id !== trace ||
    returnedScope.tenant_id !== scope.tenant_id ||
    returnedScope.workspace_id !== scope.workspace_id ||
    returnedScope.project_id !== scope.project_id ||
    !Array.isArray(input.source_refs) ||
    input.source_refs.length !== 1 ||
    object(input.source_refs[0]).type !== 'postgres' ||
    object(input.source_refs[0]).id !== 'wcp_audit_records' ||
    !Array.isArray(input.data) ||
    input.data.length > WORKBENCH_AUDIT_LIMIT ||
    typeof input.has_more !== 'boolean'
  )
    throw new TypeError('Invalid audit response');
  const data = input.data.map(parseWorkbenchAuditRecord);
  if (
    new Set(data.map((row) => row.audit_id)).size !== data.length ||
    (input.has_more && data.length !== WORKBENCH_AUDIT_LIMIT) ||
    (filters.audit_id !== undefined && data.length > 1) ||
    data.some((row) =>
      Object.entries(exactFilters).some(
        ([key, value]) => row[key as keyof typeof exactFilters] !== value,
      ),
    ) ||
    data.some((row, index) => {
      const previous = data[index - 1];
      return (
        (before !== undefined && compareWorkbenchAuditPositions(row, before) >= 0) ||
        (previous !== undefined && compareWorkbenchAuditPositions(row, previous) >= 0)
      );
    })
  )
    throw new TypeError('Audit results do not match the query');
  let next_cursor: string | undefined;
  if (input.has_more) {
    const next = parseWorkbenchAuditCursor(input.next_cursor);
    const last = data[data.length - 1];
    if (
      !last ||
      compareWorkbenchAuditPositions(next, last) !== 0 ||
      (before !== undefined && next.key !== before.key) ||
      input.next_cursor === cursor
    )
      throw new TypeError('Invalid audit continuation');
    next_cursor = input.next_cursor as string;
  } else if (input.next_cursor !== undefined) {
    throw new TypeError('Unexpected audit continuation');
  }
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [{ type: 'postgres', id: 'wcp_audit_records' }],
    scope: {
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
    },
    data,
    has_more: input.has_more,
    ...(next_cursor === undefined ? {} : { next_cursor }),
  };
}
