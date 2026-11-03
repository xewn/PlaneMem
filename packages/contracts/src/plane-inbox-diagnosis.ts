import type { ObservedScope } from './observed-state.js';
import { parsePlaneInboxRecord, type PlaneInboxRecord } from './plane-inbox.js';

export type PlaneInboxVersionPosition =
  | 'baseline_unavailable'
  | 'ambiguous_stream'
  | 'already_recorded'
  | 'at_or_behind'
  | 'deleted_stream'
  | 'next_version'
  | 'gap';

interface Candidates {
  items: PlaneInboxRecord[];
  has_more: boolean;
}
interface VersionComparison {
  position: PlaneInboxVersionPosition;
  next_version: string | null;
  uncommitted_versions: { from: string; to: string } | null;
}
export interface PlaneInboxDiagnosis extends VersionComparison {
  schema_version: 1;
  record: PlaneInboxRecord;
  /** At most two readable receipts at the actual highest committed stream version. */
  baseline: PlaneInboxRecord[];
  next_version_candidates: Candidates;
  same_version_candidates: Candidates;
}

/** Version comparison only; this does not certify that a processing attempt can succeed. */
export function describePlaneInboxVersionPosition(
  record: PlaneInboxRecord,
  baseline: PlaneInboxRecord[],
): VersionComparison {
  const unavailable = { next_version: null, uncommitted_versions: null };
  if (baseline.length === 0) return { position: 'baseline_unavailable', ...unavailable };
  if (baseline.length > 1) return { position: 'ambiguous_stream', ...unavailable };
  const last = baseline[0]!;
  if (last.event_id === record.event_id) return { position: 'already_recorded', ...unavailable };
  const target = BigInt(record.aggregate_version);
  const committed = BigInt(last.aggregate_version);
  if (target <= committed) return { position: 'at_or_behind', ...unavailable };
  if (
    last.event_type === 'WorkItemDeleted' &&
    record.event_type !== 'WorkItemDeleted' &&
    record.event_type !== 'WorkItemRestored'
  )
    return { position: 'deleted_stream', ...unavailable };
  const next_version = (committed + 1n).toString();
  return target === committed + 1n
    ? { position: 'next_version', next_version, uncommitted_versions: null }
    : {
        position: 'gap',
        next_version,
        uncommitted_versions: { from: next_version, to: (target - 1n).toString() },
      };
}

export function parsePlaneInboxDiagnosis(
  value: unknown,
  expected: ObservedScope,
  eventId: string,
): PlaneInboxDiagnosis {
  const row = object(value);
  if (row.schema_version !== 1) throw new TypeError('Invalid queue diagnosis schema');
  const record = parsePlaneInboxRecord(row.record, expected, eventId);
  const readRelated = (value: unknown): PlaneInboxRecord => {
    const item = parsePlaneInboxRecord(value, expected);
    if (
      item.aggregate_type !== record.aggregate_type ||
      item.aggregate_id !== record.aggregate_id ||
      item.checked_at !== record.checked_at
    )
      throw new TypeError('Queue diagnosis contains a different stream or snapshot');
    if (item.event_id === record.event_id && JSON.stringify(item) !== JSON.stringify(record))
      throw new TypeError('Queue diagnosis contains inconsistent target metadata');
    return item;
  };
  if (!Array.isArray(row.baseline) || row.baseline.length > 2)
    throw new TypeError('Invalid committed baseline');
  const baseline = row.baseline.map(readRelated);
  for (let index = 0; index < baseline.length; index += 1) {
    const item = baseline[index]!;
    if (
      item.status !== 'applied' ||
      item.event_type === null ||
      (index > 0 &&
        (item.aggregate_version !== baseline[0]!.aggregate_version ||
          baseline[index - 1]!.event_id >= item.event_id))
    )
      throw new TypeError('Invalid committed baseline receipt');
  }
  const comparison = describePlaneInboxVersionPosition(record, baseline);
  if (row.position !== comparison.position || row.next_version !== comparison.next_version)
    throw new TypeError('Queue version comparison is inconsistent');
  if (comparison.uncommitted_versions === null) {
    if (row.uncommitted_versions !== null) throw new TypeError('Unexpected version interval');
  } else {
    const gap = object(row.uncommitted_versions);
    if (
      gap.from !== comparison.uncommitted_versions.from ||
      gap.to !== comparison.uncommitted_versions.to
    )
      throw new TypeError('Invalid uncommitted version interval');
  }
  const readCandidates = (
    value: unknown,
    version: string | null,
    excludeTarget: boolean,
  ): Candidates => {
    const group = object(value);
    if (
      !Array.isArray(group.items) ||
      group.items.length > 10 ||
      typeof group.has_more !== 'boolean' ||
      (group.has_more && group.items.length !== 10)
    )
      throw new TypeError('Invalid diagnosis candidate page');
    const items = group.items.map(readRelated);
    if (version === null && (items.length !== 0 || group.has_more))
      throw new TypeError('Unexpected next-version candidates');
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      if (
        item.aggregate_version !== version ||
        (excludeTarget && item.event_id === record.event_id) ||
        (index > 0 && items[index - 1]!.event_id >= item.event_id)
      )
        throw new TypeError('Candidate version or order mismatch');
    }
    return { items, has_more: group.has_more };
  };
  return {
    schema_version: 1,
    record,
    baseline,
    ...comparison,
    next_version_candidates: readCandidates(
      row.next_version_candidates,
      comparison.next_version,
      false,
    ),
    same_version_candidates: readCandidates(
      row.same_version_candidates,
      record.aggregate_version,
      true,
    ),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected queue diagnosis metadata');
  return value as Record<string, unknown>;
}
