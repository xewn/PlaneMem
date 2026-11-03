import { isUlid } from './ids.js';
import { validateIdempotencyKey, type Classification } from './metadata.js';
import type { ObservedScope } from './observed-state.js';

export type PlaneInboxStatus = 'pending' | 'applied' | 'rejected';
export type PlaneInboxPendingState = 'all' | 'due' | 'delayed' | 'version_gap';
export interface PlaneInboxListQuery {
  status?: PlaneInboxStatus | 'all';
  pending_state?: PlaneInboxPendingState;
  aggregate_id?: string;
  limit?: number;
  cursor?: string;
}
/** Processing metadata only. This does not certify current projection visibility. */
export interface PlaneInboxRecord extends ObservedScope {
  schema_version: 1;
  event_id: string;
  event_type: string | null;
  aggregate_type: 'project' | 'work_item';
  aggregate_id: string;
  aggregate_version: string;
  status: PlaneInboxStatus;
  attempts: string;
  /** Queue mutation revision, independent of the observed aggregate version. */
  revision: string;
  classification: Classification;
  received_at: string;
  updated_at: string;
  next_attempt_at: string | null;
  applied_at: string | null;
  last_error_code: string | null;
  checked_at: string;
}
export interface PlaneInboxPage {
  scope: ObservedScope;
  items: PlaneInboxRecord[];
  next_cursor?: string;
}

/** One database snapshot of currently visible events, independent of list filters and pagination. */
export interface PlaneInboxSummary {
  schema_version: 1;
  scope: ObservedScope;
  checked_at: string;
  counts: {
    total: string;
    pending: string;
    applied: string;
    rejected: string;
    due: string;
    delayed: string;
    version_gap: string;
  };
  oldest_pending_received_at: string | null;
  oldest_due_received_at: string | null;
  earliest_pending_attempt_at: string | null;
  latest_received_at: string | null;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an inbox record');
  return value as Record<string, unknown>;
}
function only(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new TypeError('Unknown inbox query field');
}
function cursor(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(value))
    throw new TypeError('Invalid inbox cursor');
  return value;
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError('Expected a canonical UTC time');
  return value;
}
function integer(value: unknown, positive: boolean): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
    BigInt(value) > (positive ? BigInt(Number.MAX_SAFE_INTEGER) : 9223372036854775807n) ||
    (positive && value === '0')
  )
    throw new TypeError('Invalid inbox version or attempt count');
  return value;
}
function scopeOf(value: unknown, expected: ObservedScope): ObservedScope {
  const row = object(value);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isUlid(row[field]) || row[field] !== expected[field])
      throw new TypeError('Inbox scope mismatch');
  return {
    tenant_id: expected.tenant_id,
    workspace_id: expected.workspace_id,
    project_id: expected.project_id,
  };
}
export function parsePlaneInboxListQuery(
  value: unknown,
): Required<Pick<PlaneInboxListQuery, 'status' | 'pending_state' | 'limit'>> &
  Pick<PlaneInboxListQuery, 'aggregate_id' | 'cursor'> {
  const input = object(value);
  only(input, ['status', 'pending_state', 'aggregate_id', 'limit', 'cursor']);
  const status = input.status === undefined ? 'all' : input.status;
  const pendingState = input.pending_state === undefined ? 'all' : input.pending_state;
  const limit = input.limit === undefined ? 25 : input.limit;
  if (!['all', 'pending', 'applied', 'rejected'].includes(status as string))
    throw new TypeError('Invalid inbox status filter');
  if (!['all', 'due', 'delayed', 'version_gap'].includes(pendingState as string))
    throw new TypeError('Invalid pending state filter');
  if (pendingState !== 'all' && status !== 'all' && status !== 'pending')
    throw new TypeError('Pending state filters require all or pending status');
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError('limit must be between 1 and 100');
  if (input.aggregate_id !== undefined && !isUlid(input.aggregate_id))
    throw new TypeError('aggregate_id must be a ULID');
  return {
    status: status as PlaneInboxStatus | 'all',
    pending_state: pendingState as PlaneInboxPendingState,
    limit,
    ...(input.aggregate_id === undefined ? {} : { aggregate_id: input.aggregate_id as string }),
    ...(input.cursor === undefined ? {} : { cursor: cursor(input.cursor) }),
  };
}
export function parsePlaneInboxRecordQuery(value: unknown): { event_id: string } {
  const input = object(value);
  only(input, ['event_id']);
  if (!isUlid(input.event_id)) throw new TypeError('event_id must be a ULID');
  return { event_id: input.event_id };
}

export function parsePlaneInboxSummaryQuery(value: unknown): Record<string, never> {
  only(object(value), []);
  return {};
}

export function parsePlaneInboxSummary(value: unknown, expected: ObservedScope): PlaneInboxSummary {
  const row = object(value);
  if (row.schema_version !== 1) throw new TypeError('Invalid inbox summary schema');
  const scope = scopeOf(row.scope, expected);
  const checked_at = timestamp(row.checked_at);
  const raw = object(row.counts);
  const counts = {
    total: integer(raw.total, false),
    pending: integer(raw.pending, false),
    applied: integer(raw.applied, false),
    rejected: integer(raw.rejected, false),
    due: integer(raw.due, false),
    delayed: integer(raw.delayed, false),
    version_gap: integer(raw.version_gap, false),
  };
  if (
    BigInt(counts.total) !==
      BigInt(counts.pending) + BigInt(counts.applied) + BigInt(counts.rejected) ||
    BigInt(counts.pending) !== BigInt(counts.due) + BigInt(counts.delayed) ||
    BigInt(counts.version_gap) > BigInt(counts.pending)
  )
    throw new TypeError('Inbox summary counts are inconsistent');
  const optionalTime = (value: unknown) => (value === null ? null : timestamp(value));
  const oldest_pending_received_at = optionalTime(row.oldest_pending_received_at);
  const oldest_due_received_at = optionalTime(row.oldest_due_received_at);
  const earliest_pending_attempt_at = optionalTime(row.earliest_pending_attempt_at);
  const latest_received_at = optionalTime(row.latest_received_at);
  if (
    (counts.pending === '0') !== (oldest_pending_received_at === null) ||
    (counts.pending === '0') !== (earliest_pending_attempt_at === null) ||
    (counts.due === '0') !== (oldest_due_received_at === null) ||
    (counts.total === '0') !== (latest_received_at === null) ||
    (oldest_pending_received_at !== null &&
      latest_received_at !== null &&
      Date.parse(oldest_pending_received_at) > Date.parse(latest_received_at)) ||
    (oldest_due_received_at !== null &&
      oldest_pending_received_at !== null &&
      Date.parse(oldest_due_received_at) < Date.parse(oldest_pending_received_at)) ||
    (oldest_due_received_at !== null &&
      latest_received_at !== null &&
      Date.parse(oldest_due_received_at) > Date.parse(latest_received_at)) ||
    // Database timestamps may have sub-millisecond precision; equal normalized times are valid.
    (earliest_pending_attempt_at !== null &&
      (counts.due === '0'
        ? Date.parse(earliest_pending_attempt_at) < Date.parse(checked_at)
        : Date.parse(earliest_pending_attempt_at) > Date.parse(checked_at)))
  )
    throw new TypeError('Inbox summary timestamps are inconsistent');
  return {
    schema_version: 1,
    scope,
    checked_at,
    counts,
    oldest_pending_received_at,
    oldest_due_received_at,
    earliest_pending_attempt_at,
    latest_received_at,
  };
}
export function parsePlaneInboxRecord(
  value: unknown,
  expected: ObservedScope,
  eventId?: string,
): PlaneInboxRecord {
  const row = object(value);
  const scope = scopeOf(row, expected);
  const { event_id } = parsePlaneInboxRecordQuery({ event_id: row.event_id });
  const type = row.aggregate_type;
  if (
    row.schema_version !== 1 ||
    (eventId !== undefined && event_id !== eventId) ||
    !isUlid(row.aggregate_id) ||
    !['project', 'work_item'].includes(type as string) ||
    !['pending', 'applied', 'rejected'].includes(row.status as string) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(row.classification as string)
  )
    throw new TypeError('Invalid inbox metadata');
  const types =
    type === 'project'
      ? ['ProjectCreated', 'ProjectUpdated']
      : [
          'WorkItemCreated',
          'WorkItemUpdated',
          'WorkItemStatusConfirmed',
          'WorkItemDeleted',
          'WorkItemRestored',
        ];
  if (row.event_type !== null && !types.includes(row.event_type as string))
    throw new TypeError('Unexpected observed event type');
  if (
    row.last_error_code !== null &&
    (typeof row.last_error_code !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,127}$/.test(row.last_error_code))
  )
    throw new TypeError('Invalid inbox error code');
  const attempts = integer(row.attempts, false);
  const revision = queueRevision(row.revision);
  const next_attempt_at = row.next_attempt_at === null ? null : timestamp(row.next_attempt_at);
  const applied_at = row.applied_at === null ? null : timestamp(row.applied_at);
  if (
    (row.status === 'pending') !== (next_attempt_at !== null) ||
    (row.status === 'applied') !== (applied_at !== null) ||
    (row.status === 'applied' && row.last_error_code !== null) ||
    (row.status === 'rejected' && row.last_error_code === null) ||
    (row.status !== 'pending' && attempts === '0')
  )
    throw new TypeError('Inbox processing status is inconsistent');
  return {
    ...scope,
    schema_version: 1,
    event_id,
    event_type: row.event_type as string | null,
    aggregate_type: type as PlaneInboxRecord['aggregate_type'],
    aggregate_id: row.aggregate_id,
    aggregate_version: integer(row.aggregate_version, true),
    attempts,
    revision,
    status: row.status as PlaneInboxStatus,
    classification: row.classification as Classification,
    received_at: timestamp(row.received_at),
    updated_at: timestamp(row.updated_at),
    checked_at: timestamp(row.checked_at),
    next_attempt_at,
    applied_at,
    last_error_code: row.last_error_code as string | null,
  };
}

export interface PlaneInboxIdentity extends ObservedScope {
  actor_id: string;
  client_id: string;
}
export interface PlaneInboxRetryInput {
  event_id: string;
  expected_revision: string;
  reason: string;
}
export interface PlaneInboxRetryReceipt {
  operation: 'plane.inbox.retry';
  identity: PlaneInboxIdentity;
  request_key: string;
  command: PlaneInboxRetryInput;
  previous_status: 'pending' | 'rejected';
  previous_error_code: string | null;
  previous_attempts: string;
  record: PlaneInboxRecord;
}
export type PlaneInboxRetryLookup = {
  identity: PlaneInboxIdentity;
  request_key: string;
  command: PlaneInboxRetryInput;
} & ({ status: 'recorded'; receipt: PlaneInboxRetryReceipt } | { status: 'not-observed' });

function queueRevision(value: unknown): string {
  const parsed = integer(value, false);
  if (parsed === '0') throw new TypeError('Queue revision must be positive');
  return parsed;
}
export function parsePlaneInboxIdentity(value: unknown): PlaneInboxIdentity {
  const input = object(value);
  only(input, ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id']);
  const scope = scopeOf(input, input as unknown as ObservedScope);
  for (const field of ['actor_id', 'client_id'])
    if (
      typeof input[field] !== 'string' ||
      !(input[field] as string).trim() ||
      (input[field] as string).length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(input[field] as string)
    )
      throw new TypeError('Invalid retry identity');
  return { ...scope, actor_id: input.actor_id as string, client_id: input.client_id as string };
}
export function parsePlaneInboxRetryInput(value: unknown): PlaneInboxRetryInput {
  const input = object(value);
  only(input, ['event_id', 'expected_revision', 'reason']);
  const { event_id } = parsePlaneInboxRecordQuery({ event_id: input.event_id });
  const expected_revision = queueRevision(input.expected_revision);
  if (expected_revision === '9223372036854775807')
    throw new TypeError('Queue revision cannot be incremented');
  if (
    typeof input.reason !== 'string' ||
    !input.reason.trim() ||
    input.reason.length > 2000 ||
    /[\u0000\p{Cs}]/u.test(input.reason)
  )
    throw new TypeError('Provide a reason of 1–2000 characters');
  return { event_id, expected_revision, reason: input.reason.trim() };
}
export function parsePlaneInboxRetryQuery(
  value: unknown,
): PlaneInboxRetryInput & { request_key: string } {
  const input = object(value);
  const { request_key, ...command } = input;
  return {
    ...parsePlaneInboxRetryInput(command),
    request_key: retryKey(request_key),
  };
}
function retryKey(value: unknown): string {
  const key = validateIdempotencyKey(value);
  if (/[\u0000-\u001f\u007f\p{Cs}]/u.test(key)) throw new TypeError('Invalid retry request key');
  return key;
}
export function parsePlaneInboxRetryReceipt(
  value: unknown,
  input: PlaneInboxRetryInput,
  identity: PlaneInboxIdentity,
  key: string,
): PlaneInboxRetryReceipt {
  const receipt = object(value);
  const expected = parsePlaneInboxRetryInput(input);
  const returnedIdentity = parsePlaneInboxIdentity(receipt.identity);
  const command = parsePlaneInboxRetryInput(receipt.command);
  if (
    receipt.operation !== 'plane.inbox.retry' ||
    receipt.request_key !== retryKey(key) ||
    JSON.stringify(returnedIdentity) !== JSON.stringify(parsePlaneInboxIdentity(identity)) ||
    JSON.stringify(command) !== JSON.stringify(expected) ||
    !['pending', 'rejected'].includes(receipt.previous_status as string) ||
    (receipt.previous_error_code !== null &&
      (typeof receipt.previous_error_code !== 'string' ||
        !/^[A-Z][A-Z0-9_]{0,127}$/.test(receipt.previous_error_code))) ||
    (receipt.previous_status === 'rejected' && receipt.previous_error_code === null)
  )
    throw new TypeError('Retry receipt does not match the original command');
  const previous_attempts = integer(receipt.previous_attempts, false);
  const record = parsePlaneInboxRecord(receipt.record, identity, expected.event_id);
  if (
    record.revision !== String(BigInt(expected.expected_revision) + 1n) ||
    record.status !== 'pending' ||
    record.last_error_code !== null ||
    record.attempts !== previous_attempts ||
    record.updated_at !== record.next_attempt_at ||
    (receipt.previous_status === 'rejected' && previous_attempts === '0')
  )
    throw new TypeError('Invalid retry scheduling receipt');
  return {
    operation: 'plane.inbox.retry',
    identity: returnedIdentity,
    request_key: key,
    command,
    previous_status: receipt.previous_status as 'pending' | 'rejected',
    previous_error_code: receipt.previous_error_code as string | null,
    previous_attempts,
    record,
  };
}
export function parsePlaneInboxRetryLookup(
  value: unknown,
  input: PlaneInboxRetryInput,
  identity: PlaneInboxIdentity,
  key: string,
): PlaneInboxRetryLookup {
  const row = object(value);
  const command = parsePlaneInboxRetryInput(row.command);
  const returnedIdentity = parsePlaneInboxIdentity(row.identity);
  if (
    row.request_key !== retryKey(key) ||
    JSON.stringify(command) !== JSON.stringify(parsePlaneInboxRetryInput(input)) ||
    JSON.stringify(returnedIdentity) !== JSON.stringify(parsePlaneInboxIdentity(identity))
  )
    throw new TypeError('Retry lookup identity mismatch');
  const result = { identity: returnedIdentity, request_key: key, command };
  if (row.status === 'recorded')
    return {
      ...result,
      status: 'recorded',
      receipt: parsePlaneInboxRetryReceipt(row.receipt, input, identity, key),
    };
  if (row.status === 'not-observed' && row.receipt === undefined)
    return { ...result, status: 'not-observed' };
  throw new TypeError('Invalid retry lookup status');
}
export function parsePlaneInboxPage(
  value: unknown,
  expected: ObservedScope,
  input: PlaneInboxListQuery = {},
): PlaneInboxPage {
  const page = object(value);
  const scope = scopeOf(page.scope, expected);
  const query = parsePlaneInboxListQuery(input);
  if (!Array.isArray(page.items) || page.items.length > query.limit)
    throw new TypeError('Invalid inbox page size');
  const items: PlaneInboxRecord[] = page.items.map((value) => parsePlaneInboxRecord(value, scope));
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (query.pending_state !== 'all') {
      if (item.status !== 'pending' || item.next_attempt_at === null)
        throw new TypeError('Expected a pending event for this queue filter');
      // SQL compares microseconds; normalized UTC times can coincide within a millisecond.
      const scheduled = Date.parse(item.next_attempt_at);
      const checked = Date.parse(item.checked_at);
      if (
        (query.pending_state === 'due' && scheduled > checked) ||
        (query.pending_state === 'delayed' && scheduled < checked) ||
        (query.pending_state === 'version_gap' && item.last_error_code !== 'AGGREGATE_VERSION_GAP')
      )
        throw new TypeError('Inbox event does not match its pending state filter');
    }
    if (
      (query.status !== 'all' && item.status !== query.status) ||
      (query.aggregate_id !== undefined && item.aggregate_id !== query.aggregate_id) ||
      (index > 0 && items[index - 1]!.event_id <= item.event_id)
    )
      throw new TypeError('Inbox page does not match its filters or order');
  }
  if (
    page.next_cursor !== undefined &&
    (cursor(page.next_cursor) === query.cursor || items.length !== query.limit)
  )
    throw new TypeError('Invalid inbox continuation');
  return {
    scope,
    items,
    ...(page.next_cursor === undefined ? {} : { next_cursor: page.next_cursor as string }),
  };
}
