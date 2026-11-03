import { isSyncIdentifier } from './sync.js';
import { isUlid } from './ids.js';
import { validateIdempotencyKey } from './metadata.js';
import { parseConflictReadQuery, parseConflictVersion } from './conflict-read.js';

export const CONFLICT_RECEIPT_REQUEST_BYTES = 1_000_000;
export const CONFLICT_RECEIPT_RESPONSE_BYTES = 2 * 1024 * 1024;
export const CONFLICT_RECEIPT_METADATA_BYTES = 16 * 1024;
export interface ConflictCommandIdentity {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  client_id: string;
}
export interface ConflictReceiptQuery {
  identity: ConflictCommandIdentity;
  request_key: string;
  /** Preserve every original body field. Include the effective route ID and If-Match version. */
  command: Record<string, unknown> & {
    conflict_id: string;
    expected_version: number;
    resolution: 'local' | 'server' | 'merge';
  };
}
export interface ConflictRecordedReceipt {
  conflict_id: string;
  version: string;
  resolution: 'local' | 'server' | 'merge';
  event_id: string;
  server_cursor: string;
  actor_id: string;
  client_id: string;
  recorded_at: string;
  original_trace_id: string;
  source_application: 'not-checked';
}
export type ConflictReceiptView = ConflictReceiptQuery &
  ({ status: 'not-observed' } | { status: 'recorded'; receipt: ConflictRecordedReceipt });
export interface ConflictReceiptEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: { type: string; id: string }[];
  data: ConflictReceiptView;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected conflict receipt object');
  return value as Record<string, unknown>;
}
function only(row: Record<string, unknown>, keys: string[]) {
  if (Object.keys(row).some((key) => !keys.includes(key)))
    throw new TypeError('Unknown conflict receipt field');
}
function text(value: unknown, maximum = 1024): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid conflict receipt text');
  return value;
}

/** A detached JSON snapshot; rejects values JSON.stringify would silently change or omit. */
export function conflictReceiptJson(
  value: unknown,
  maximum = CONFLICT_RECEIPT_REQUEST_BYTES,
): string {
  let nodes = 0;
  const ancestors = new Set<object>();
  const copy = (item: unknown, depth: number): unknown => {
    if (++nodes > 100_000 || depth > 64)
      throw new TypeError('Conflict receipt JSON is too complex');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object' || ancestors.has(item))
      throw new TypeError('Use finite JSON values');
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null)
      throw new TypeError('Use plain JSON objects');
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError('Use JSON field names');
    const keys = Object.keys(item);
    if (
      Reflect.ownKeys(item).length !== keys.length + (Array.isArray(item) ? 1 : 0) ||
      keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(item, key)!, 'value'))
    )
      throw new TypeError('Use ordinary JSON fields');
    ancestors.add(item);
    let result: unknown;
    if (Array.isArray(item)) {
      if (keys.length !== item.length || keys.some((key, i) => key !== String(i)))
        throw new TypeError('Use dense JSON arrays');
      result = item.map((child) => copy(child, depth + 1));
    } else {
      const row = item as Record<string, unknown>;
      result = Object.fromEntries(keys.sort().map((key) => [key, copy(row[key], depth + 1)]));
    }
    ancestors.delete(item);
    return result;
  };
  const raw = JSON.stringify(copy(value, 0));
  if (new TextEncoder().encode(raw).byteLength > maximum)
    throw new TypeError('Conflict receipt JSON exceeds its limit');
  return raw;
}
export function parseConflictCommandIdentity(value: unknown): ConflictCommandIdentity {
  const row = object(value);
  only(row, ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id']);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isSyncIdentifier(row[field]) || row[field] === '.' || row[field] === '..')
      throw new TypeError('Invalid original conflict scope');
  return {
    tenant_id: row.tenant_id as string,
    workspace_id: row.workspace_id as string,
    project_id: row.project_id as string,
    actor_id: text(row.actor_id),
    client_id: text(row.client_id),
  };
}
export function assertConflictReceiptIdentity(
  original: ConflictCommandIdentity,
  actual: {
    tenant_id: string;
    workspace_id: string;
    project_id?: string;
    actor_id?: string;
    client_id?: string;
  },
) {
  const identity = parseConflictCommandIdentity(original);
  for (const field of ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id'] as const)
    if (identity[field] !== actual[field])
      throw new TypeError('Original conflict identity differs from the current caller');
}
export function parseConflictReceiptQuery(value: unknown): ConflictReceiptQuery {
  const row = object(JSON.parse(conflictReceiptJson(value)));
  only(row, ['identity', 'request_key', 'command']);
  const identity = parseConflictCommandIdentity(row.identity);
  const request_key = validateIdempotencyKey(text(row.request_key, 255));
  const command = object(row.command);
  const conflict_id = parseConflictReadQuery({ conflict_id: command.conflict_id }).conflict_id;
  if (
    typeof command.expected_version !== 'number' ||
    !Number.isSafeInteger(command.expected_version) ||
    command.expected_version < 1 ||
    !Number.isSafeInteger(command.expected_version + 1) ||
    !['local', 'server', 'merge'].includes(command.resolution as string) ||
    (command.resolution === 'merge') !== Object.hasOwn(command, 'merged_value') ||
    (command.idempotency_key !== undefined && command.idempotency_key !== request_key)
  )
    throw new TypeError('Keep the original decision, version and key');
  for (const field of ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id'] as const)
    if (command[field] !== undefined && command[field] !== identity[field])
      throw new TypeError('Original command identity differs');
  if (command.from_client !== undefined && command.from_client !== identity.client_id)
    throw new TypeError('Original client differs');
  return {
    identity,
    request_key,
    command: {
      ...command,
      conflict_id,
      expected_version: command.expected_version,
      resolution: command.resolution as ConflictReceiptQuery['command']['resolution'],
    },
  };
}
export function parseConflictReceiptEnvelope(
  value: unknown,
  original: ConflictReceiptQuery,
  trace: string,
): ConflictReceiptEnvelope {
  conflictReceiptJson(value, CONFLICT_RECEIPT_RESPONSE_BYTES);
  const query = parseConflictReceiptQuery(original);
  const row = object(value);
  only(row, ['schema_version', 'trace_id', 'source_refs', 'data']);
  if (
    row.schema_version !== 1 ||
    text(row.trace_id) !== text(trace) ||
    !Array.isArray(row.source_refs) ||
    Object.keys(row.source_refs).length !== row.source_refs.length
  )
    throw new TypeError('Invalid conflict receipt envelope');
  const data = object(row.data);
  const returned = parseConflictReceiptQuery({
    identity: data.identity,
    request_key: data.request_key,
    command: data.command,
  });
  if (conflictReceiptJson(returned) !== conflictReceiptJson(query))
    throw new TypeError('Conflict receipt differs from original request');
  if (data.status === 'not-observed') {
    only(data, ['status', 'identity', 'request_key', 'command']);
    if (row.source_refs.length) throw new TypeError('Unobserved receipt cannot identify a result');
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: [],
      data: { ...returned, status: 'not-observed' },
    };
  }
  only(data, ['status', 'identity', 'request_key', 'command', 'receipt']);
  if (data.status !== 'recorded') throw new TypeError('Invalid conflict receipt status');
  const saved = object(data.receipt);
  only(saved, [
    'conflict_id',
    'version',
    'resolution',
    'event_id',
    'server_cursor',
    'actor_id',
    'client_id',
    'recorded_at',
    'original_trace_id',
    'source_application',
  ]);
  if (
    saved.conflict_id !== query.command.conflict_id ||
    saved.resolution !== query.command.resolution ||
    parseConflictVersion(saved.version, true) !== String(query.command.expected_version + 1) ||
    !isUlid(saved.event_id) ||
    saved.actor_id !== query.identity.actor_id ||
    saved.client_id !== query.identity.client_id ||
    saved.source_application !== 'not-checked' ||
    typeof saved.recorded_at !== 'string' ||
    saved.recorded_at.length > 128 ||
    !Number.isFinite(Date.parse(saved.recorded_at))
  )
    throw new TypeError('Stored conflict receipt does not match original decision');
  if (row.source_refs.length !== 1) throw new TypeError('Invalid conflict receipt source');
  const source = object(row.source_refs[0]);
  only(source, ['type', 'id']);
  if (source.type !== 'event' || source.id !== saved.event_id)
    throw new TypeError('Conflict receipt event differs');
  const receipt: ConflictRecordedReceipt = {
    conflict_id: query.command.conflict_id,
    version: saved.version as string,
    resolution: query.command.resolution,
    event_id: saved.event_id,
    server_cursor: parseConflictVersion(saved.server_cursor, true),
    actor_id: query.identity.actor_id,
    client_id: query.identity.client_id,
    recorded_at: saved.recorded_at,
    original_trace_id: text(saved.original_trace_id),
    source_application: 'not-checked',
  };
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: [{ type: 'event', id: receipt.event_id }],
    data: { ...returned, status: 'recorded', receipt },
  };
}
