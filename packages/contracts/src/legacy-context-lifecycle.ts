import { validateIdempotencyKey, type Classification } from './metadata.js';
import { parseWorkItemProjectionQuery } from './work-item-projection.js';

export type LegacyContextAction = 'delete' | 'restore';
export interface LegacyContextIdentity {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  client_id: string;
}
export interface LegacyContextListQuery {
  query?: string;
  state?: 'all' | 'active' | 'expired' | 'deleted';
  managed_by?: 'all' | 'manual' | 'plane';
  limit?: number;
  cursor?: string;
}
export interface LegacyContextListPage {
  scope: Pick<LegacyContextIdentity, 'tenant_id' | 'workspace_id' | 'project_id'>;
  items: LegacyContextStatus[];
  next_cursor?: string;
}
export interface LegacyContextMutation {
  id: string;
  expected_revision: number;
  reason: string;
}
export interface LegacyContextStatus {
  id: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  revision: number;
  classification: Classification;
  expires_at: string | null;
  deleted_at: string | null;
  updated_at: string;
  checked_at: string;
  state: 'active' | 'expired' | 'deleted';
  managed_by: 'manual' | 'plane';
}
/** Historical outcome. Read status separately to learn the current state. */
export interface LegacyContextMutationReceipt {
  operation: LegacyContextAction;
  request_key: string;
  expected_revision: number;
  reason: string;
  record: LegacyContextStatus;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an object');
  return value as Record<string, unknown>;
}
function only(input: Record<string, unknown>, fields: string[]) {
  if (Object.keys(input).some((field) => !fields.includes(field)))
    throw new TypeError('Unknown legacy context field');
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('revision must be a non-negative safe integer');
  return value;
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError('Expected a canonical UTC timestamp');
  return value;
}
export function parseLegacyContextIdentity(value: unknown): LegacyContextIdentity {
  const input = record(value);
  const fields = ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id'];
  only(input, fields);
  for (const field of fields)
    if (
      typeof input[field] !== 'string' ||
      !input[field].trim() ||
      (input[field] as string).length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(input[field] as string)
    )
      throw new TypeError('Invalid context index identity');
  return {
    tenant_id: input.tenant_id as string,
    workspace_id: input.workspace_id as string,
    project_id: input.project_id as string,
    actor_id: input.actor_id as string,
    client_id: input.client_id as string,
  };
}
export function parseLegacyContextListQuery(
  value: unknown,
): Required<Omit<LegacyContextListQuery, 'cursor'>> & { cursor?: string } {
  const input = record(value);
  only(input, ['query', 'state', 'managed_by', 'limit', 'cursor']);
  const query = input.query === undefined ? '' : input.query;
  const state = input.state === undefined ? 'all' : input.state;
  const managed_by = input.managed_by === undefined ? 'all' : input.managed_by;
  const limit = input.limit === undefined ? 25 : input.limit;
  if (typeof query !== 'string' || query.length > 500 || /[\u0000\p{Cs}]/u.test(query))
    throw new TypeError('query must be text of at most 500 characters');
  if (
    !['all', 'active', 'expired', 'deleted'].includes(state as string) ||
    !['all', 'manual', 'plane'].includes(managed_by as string)
  )
    throw new TypeError('Invalid index filters');
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError('limit must be between 1 and 100');
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(input.cursor))
  )
    throw new TypeError('Invalid index cursor');
  return {
    query: query.trim(),
    state: state as Required<LegacyContextListQuery>['state'],
    managed_by: managed_by as Required<LegacyContextListQuery>['managed_by'],
    limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor as string }),
  };
}
export function parseLegacyContextListPage(
  value: unknown,
  input: LegacyContextListQuery = {},
): LegacyContextListPage {
  const query = parseLegacyContextListQuery(input);
  const page = record(value);
  const scope = record(page.scope);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'])
    if (typeof scope[field] !== 'string' || !scope[field].trim())
      throw new TypeError('Invalid index scope');
  if (!Array.isArray(page.items) || page.items.length > query.limit)
    throw new TypeError('Invalid index page size');
  const ids = new Set<string>();
  const items = page.items.map((value: unknown) => {
    const id = parseLegacyContextStatusQuery({ id: record(value).id }).id;
    if (ids.has(id)) throw new TypeError('Duplicate index ID');
    ids.add(id);
    const item = parseLegacyContextStatus(value, id);
    if (
      item.tenant_id !== scope.tenant_id ||
      item.workspace_id !== scope.workspace_id ||
      item.project_id !== scope.project_id ||
      (query.state !== 'all' && item.state !== query.state) ||
      (query.managed_by !== 'all' && item.managed_by !== query.managed_by)
    )
      throw new TypeError('Index record does not match the requested page');
    return item;
  });
  if (
    page.next_cursor !== undefined &&
    (typeof page.next_cursor !== 'string' ||
      !/^[A-Za-z0-9_-]{1,2048}$/.test(page.next_cursor) ||
      items.length !== query.limit ||
      page.next_cursor === query.cursor)
  )
    throw new TypeError('Invalid index continuation');
  return {
    scope: {
      tenant_id: scope.tenant_id as string,
      workspace_id: scope.workspace_id as string,
      project_id: scope.project_id as string,
    },
    items,
    ...(page.next_cursor === undefined ? {} : { next_cursor: page.next_cursor as string }),
  };
}
export function parseLegacyContextStatusQuery(value: unknown): { id: string } {
  const input = record(value);
  only(input, ['id']);
  const id = parseWorkItemProjectionQuery({ item_id: input.id }).item_id;
  if (id === '.' || id === '..') throw new TypeError('Index ID cannot be a relative path segment');
  return { id };
}
export function parseLegacyContextMutation(value: unknown): LegacyContextMutation {
  const input = record(value);
  only(input, ['id', 'expected_revision', 'reason']);
  const { id } = parseLegacyContextStatusQuery({ id: input.id });
  if (id.startsWith('plane:')) throw new TypeError('Plane index records are managed by events');
  const expected_revision = revision(input.expected_revision);
  if (expected_revision === Number.MAX_SAFE_INTEGER)
    throw new TypeError('The index revision cannot be incremented safely');
  if (
    typeof input.reason !== 'string' ||
    !input.reason.trim() ||
    input.reason.length > 2000 ||
    /[\u0000\p{Cs}]/u.test(input.reason)
  )
    throw new TypeError('reason must be non-empty text of at most 2000 characters');
  return { id, expected_revision, reason: input.reason.trim() };
}
export function parseLegacyContextStatus(value: unknown, id: string): LegacyContextStatus {
  const input = record(value);
  only(input, [
    'id',
    'tenant_id',
    'workspace_id',
    'project_id',
    'revision',
    'classification',
    'expires_at',
    'deleted_at',
    'updated_at',
    'checked_at',
    'state',
    'managed_by',
  ]);
  if (parseLegacyContextStatusQuery({ id: input.id }).id !== id)
    throw new TypeError('Unexpected context index ID');
  for (const field of ['tenant_id', 'workspace_id', 'project_id'])
    if (typeof input[field] !== 'string' || !input[field].trim())
      throw new TypeError('Invalid index scope');
  if (
    !['public', 'internal', 'confidential', 'restricted'].includes(input.classification as string)
  )
    throw new TypeError('Invalid index classification');
  const expires_at = input.expires_at === null ? null : timestamp(input.expires_at);
  const deleted_at = input.deleted_at === null ? null : timestamp(input.deleted_at);
  const updated_at = timestamp(input.updated_at);
  const checked_at = timestamp(input.checked_at);
  const state =
    deleted_at !== null
      ? 'deleted'
      : expires_at !== null && Date.parse(expires_at) <= Date.parse(checked_at)
        ? 'expired'
        : 'active';
  const managed_by = id.startsWith('plane:') ? 'plane' : 'manual';
  if (
    input.state !== state ||
    input.managed_by !== managed_by ||
    updated_at > checked_at ||
    (deleted_at !== null && deleted_at > checked_at)
  )
    throw new TypeError('Inconsistent index status');
  return {
    id,
    tenant_id: input.tenant_id as string,
    workspace_id: input.workspace_id as string,
    project_id: input.project_id as string,
    revision: revision(input.revision),
    classification: input.classification as Classification,
    expires_at,
    deleted_at,
    updated_at,
    checked_at,
    state,
    managed_by,
  };
}
export function parseLegacyContextMutationReceipt(
  value: unknown,
  input: LegacyContextMutation,
  operation: LegacyContextAction,
  requestKey: string,
): LegacyContextMutationReceipt {
  if (operation !== 'delete' && operation !== 'restore')
    throw new TypeError('Invalid index action');
  const expected = parseLegacyContextMutation(input);
  const receipt = record(value);
  only(receipt, ['operation', 'request_key', 'expected_revision', 'reason', 'record']);
  if (
    receipt.operation !== operation ||
    receipt.request_key !== validateIdempotencyKey(requestKey) ||
    receipt.expected_revision !== expected.expected_revision ||
    receipt.reason !== expected.reason
  )
    throw new TypeError('Index receipt does not match the original command');
  const status = parseLegacyContextStatus(receipt.record, expected.id);
  if (
    status.revision !== expected.expected_revision + 1 ||
    (status.deleted_at !== null) !== (operation === 'delete')
  )
    throw new TypeError('Inconsistent index mutation receipt');
  return {
    operation,
    request_key: requestKey,
    expected_revision: expected.expected_revision,
    reason: expected.reason,
    record: status,
  };
}
