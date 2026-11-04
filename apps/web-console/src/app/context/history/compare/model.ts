import {
  CONTEXT_REVISION_RESPONSE_BYTES,
  parseContextHistoryReadQuery,
  syncJsonSnapshot,
  type ContextItemRevision,
} from '@planemem/contracts';

export interface ContextComparisonQuery {
  item_id: string;
  from_version: number;
  to_version: number;
}

export function parseContextComparisonQuery(input: unknown): ContextComparisonQuery {
  const value: unknown = JSON.parse(syncJsonSnapshot(input, 4096));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Choose an item and two recorded versions.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !['item_id', 'from_version', 'to_version'].includes(key)))
    throw new TypeError('Use only the item and two recorded versions.');
  const from = parseContextHistoryReadQuery({
    kind: 'version',
    item_id: row.item_id,
    version: row.from_version,
  });
  const to = parseContextHistoryReadQuery({
    kind: 'version',
    item_id: row.item_id,
    version: row.to_version,
  });
  if (from.kind !== 'version' || to.kind !== 'version' || from.version === to.version)
    throw new TypeError('Choose two different recorded versions.');
  return { item_id: from.item_id, from_version: from.version, to_version: to.version };
}

/** Call only after both complete snapshots and their hashes passed the history reader. */
export function compareContextSnapshots(before: ContextItemRevision, after: ContextItemRevision) {
  const from = JSON.parse(
    syncJsonSnapshot(before, CONTEXT_REVISION_RESPONSE_BYTES),
  ) as ContextItemRevision;
  const to = JSON.parse(
    syncJsonSnapshot(after, CONTEXT_REVISION_RESPONSE_BYTES),
  ) as ContextItemRevision;
  if (
    from.version === to.version ||
    (['id', 'tenant_id', 'workspace_id', 'project_id'] as const).some(
      (field) => from.item[field] !== to.item[field],
    )
  )
    throw new TypeError('Compare two versions of the same context item in the same project.');
  const properties = [
    ['title', 'Title'],
    ['item_type', 'Item type'],
    ['layer', 'Layer'],
    ['classification', 'Classification'],
    ['status', 'Status'],
    ['priority', 'Priority'],
    ['confidence', 'Confidence'],
    ['expires_at', 'Expiry'],
    ['source_ref', 'Source label'],
  ] as const;
  const fields = properties.map(([key, label]) => scalar(key, label, from.item[key], to.item[key]));
  fields.push(scalar('archived_at', 'Archived at', from.archived_at, to.archived_at));
  const recorded = [
    ['operation', 'Recorded operation'],
    ['recorded_at', 'Recorded at'],
    ['actor_id', 'Actor'],
    ['client_id', 'Client'],
    ['event_id', 'Event'],
    ['snapshot_hash', 'Snapshot hash'],
  ] as const;
  const records = recorded.map(([key, label]) => scalar(key, label, from[key], to[key]));
  for (const [key, label] of [
    ['created_at', 'Item created'],
    ['updated_at', 'Item updated'],
    ['trace_id', 'Saved trace'],
  ] as const)
    records.push(scalar(key, label, from.item[key], to.item[key]));
  return {
    fields,
    records,
    changed_fields: fields.filter((field) => field.changed).length,
    content: pair(from.item.content, to.item.content),
    sources: {
      ...pair(from.item.source_refs, to.item.source_refs),
      before_count: from.item.source_refs.length,
      after_count: to.item.source_refs.length,
    },
    confirmation: pair(from.confirmation, to.confirmation),
  };
}

function scalar(
  key: string,
  label: string,
  before: string | number | null,
  after: string | number | null,
) {
  const display = (value: string | number | null) =>
    value === null ? 'Not recorded' : value === '' ? 'Empty text' : String(value);
  return { key, label, before: display(before), after: display(after), changed: before !== after };
}

/** Inputs are detached, bounded ordinary JSON. Object key order is immaterial; array order is not. */
function canonical(value: unknown): string | undefined {
  const stable = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(row)
          .sort()
          .map((key) => [key, stable(row[key])]),
      );
    }
    return item;
  };
  return JSON.stringify(stable(value));
}

function pair(before: unknown, after: unknown) {
  const display = (value: unknown) =>
    value === undefined
      ? 'Not supplied'
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  const format = (value: unknown) =>
    value === undefined
      ? 'Not supplied'
      : value === null
        ? 'Null'
        : typeof value === 'string'
          ? value === ''
            ? 'Empty text'
            : 'Text'
          : 'JSON';
  return {
    before: display(before),
    after: display(after),
    before_format: format(before),
    after_format: format(after),
    changed: canonical(before) !== canonical(after),
  };
}

export type ContextSnapshotComparison = ReturnType<typeof compareContextSnapshots>;
