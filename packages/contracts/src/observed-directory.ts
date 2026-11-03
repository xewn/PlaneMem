import { isUlid } from './ids.js';
import type { Classification } from './metadata.js';
import { parseObservedRecordId, type ObservedScope } from './observed-state.js';

export interface ObservedWorkItemListQuery {
  query?: string;
  state?: 'active' | 'deleted' | 'all';
  limit?: number;
  cursor?: string;
}
/** Current observation metadata, not a local work item or a history entry. */
export interface ObservedWorkItemEntry {
  external_id: string;
  aggregate_id: string;
  plane_version: number;
  source_event_id: string;
  event_type:
    | 'WorkItemCreated'
    | 'WorkItemUpdated'
    | 'WorkItemStatusConfirmed'
    | 'WorkItemDeleted'
    | 'WorkItemRestored';
  state: 'active' | 'deleted';
  title: string | null;
  status: string | null;
  classification: Classification;
  observed_at: string;
  deleted_at: string | null;
}
export interface ObservedWorkItemPage {
  schema_version: 1;
  scope: ObservedScope;
  checked_at: string;
  items: ObservedWorkItemEntry[];
  next_cursor?: string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an observed directory object');
  return value as Record<string, unknown>;
}
function cursor(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(value))
    throw new TypeError('Invalid observation cursor');
  return value;
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError('Expected a canonical observation time');
  return value;
}
export function parseObservedWorkItemListQuery(
  value: unknown,
): Required<Pick<ObservedWorkItemListQuery, 'query' | 'state' | 'limit'>> &
  Pick<ObservedWorkItemListQuery, 'cursor'> {
  const input = object(value);
  if (Object.keys(input).some((key) => !['query', 'state', 'limit', 'cursor'].includes(key)))
    throw new TypeError('Unknown observation directory field');
  const state = input.state === undefined ? 'active' : input.state;
  const limit = input.limit === undefined ? 25 : input.limit;
  const query = input.query === undefined ? '' : input.query;
  if (typeof query !== 'string' || query.length > 500 || /[\u0000-\u001f\u007f\p{Cs}]/u.test(query))
    throw new TypeError(
      'Observation query must be at most 500 characters without controls or lone surrogates',
    );
  if (!['active', 'deleted', 'all'].includes(state as string))
    throw new TypeError('Invalid observation state filter');
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError('limit must be between 1 and 100');
  return {
    query: query.trim(),
    state: state as 'active' | 'deleted' | 'all',
    limit,
    ...(input.cursor === undefined ? {} : { cursor: cursor(input.cursor) }),
  };
}

/** Deliberately matches PostgreSQL translate(A-Z, a-z), independent of locale. */
export function matchesObservedWorkItemQuery(
  item: Pick<ObservedWorkItemEntry, 'external_id' | 'aggregate_id' | 'state' | 'title'>,
  query: string,
): boolean {
  const fold = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const needle = fold(query);
  return [
    item.external_id,
    item.aggregate_id,
    ...(item.state === 'active' && item.title !== null ? [item.title] : []),
  ].some((value) => fold(value).includes(needle));
}

/** Unicode scalar ordering matches PostgreSQL UTF-8 COLLATE "C", including non-BMP IDs. */
export function compareObservedExternalIds(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const delta = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (delta) return delta;
  }
  return a.length - b.length;
}

export function parseObservedWorkItemPage(
  value: unknown,
  expected: ObservedScope,
  input: ObservedWorkItemListQuery = {},
): ObservedWorkItemPage {
  const query = parseObservedWorkItemListQuery(input);
  const row = object(value);
  const rawScope = object(row.scope);
  const scope = {
    tenant_id: expected.tenant_id,
    workspace_id: expected.workspace_id,
    project_id: expected.project_id,
  };
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (rawScope[key] !== parseObservedRecordId(scope[key]))
      throw new TypeError('Observation directory scope mismatch');
  if (row.schema_version !== 1 || !Array.isArray(row.items) || row.items.length > query.limit)
    throw new TypeError('Invalid observation directory page');
  const checked_at = timestamp(row.checked_at);
  const items = row.items.map((raw: unknown): ObservedWorkItemEntry => {
    const item = object(raw);
    const external_id = parseObservedRecordId(item.external_id);
    if (
      !isUlid(item.aggregate_id) ||
      !isUlid(item.source_event_id) ||
      typeof item.plane_version !== 'number' ||
      !Number.isSafeInteger(item.plane_version) ||
      item.plane_version < 1 ||
      (item.event_type === 'WorkItemRestored' && item.plane_version < 2) ||
      ![
        'WorkItemCreated',
        'WorkItemUpdated',
        'WorkItemStatusConfirmed',
        'WorkItemDeleted',
        'WorkItemRestored',
      ].includes(item.event_type as string) ||
      !['active', 'deleted'].includes(item.state as string) ||
      (query.state !== 'all' && query.state !== item.state) ||
      !['public', 'internal', 'confidential', 'restricted'].includes(item.classification as string)
    )
      throw new TypeError('Invalid observation directory entry');
    const observed_at = timestamp(item.observed_at);
    const deleted_at = item.deleted_at === null ? null : timestamp(item.deleted_at);
    if (item.state === 'deleted') {
      if (
        item.event_type !== 'WorkItemDeleted' ||
        deleted_at !== observed_at ||
        item.title !== null ||
        item.status !== null
      )
        throw new TypeError('Invalid deleted directory entry');
    } else if (
      item.event_type === 'WorkItemDeleted' ||
      deleted_at !== null ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      Array.from(item.title).length > 2000 ||
      (item.status !== null &&
        (typeof item.status !== 'string' || Array.from(item.status).length > 255))
    )
      throw new TypeError('Invalid active directory entry');
    return {
      external_id,
      aggregate_id: item.aggregate_id,
      source_event_id: item.source_event_id,
      plane_version: item.plane_version,
      event_type: item.event_type as ObservedWorkItemEntry['event_type'],
      state: item.state as ObservedWorkItemEntry['state'],
      title: item.title as string | null,
      status: item.status as string | null,
      classification: item.classification as Classification,
      observed_at,
      deleted_at,
    };
  });
  if (items.some((item) => !matchesObservedWorkItemQuery(item, query.query)))
    throw new TypeError('Observation directory entry does not match the requested query');
  for (let index = 1; index < items.length; index++)
    if (compareObservedExternalIds(items[index - 1]!.external_id, items[index]!.external_id) >= 0)
      throw new TypeError('Observation directory must contain distinct ordered external IDs');
  const next_cursor = row.next_cursor === undefined ? undefined : cursor(row.next_cursor);
  if (next_cursor !== undefined && (items.length !== query.limit || next_cursor === query.cursor))
    throw new TypeError('Invalid observation directory continuation');
  return {
    schema_version: 1,
    scope,
    checked_at,
    items,
    ...(next_cursor === undefined ? {} : { next_cursor }),
  };
}
