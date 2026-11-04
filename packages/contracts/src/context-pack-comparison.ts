import {
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  parseContextPackReadEnvelope,
  type ContextPackReadEnvelope,
} from './context-pack-read.js';
import { isUlid } from './ids.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import type { ContextItem, ContextPack } from './context.js';

export interface ContextPackComparisonQuery {
  from_pack_id: string;
  to_pack_id: string;
}
export type SavedPackCandidate =
  | { state: 'selected'; position: number; item: ContextItem }
  | { state: 'excluded'; position: number; exclusion: ContextPack['exclusions'][number] }
  | { state: 'absent' };

export function parseContextPackComparisonQuery(input: unknown): ContextPackComparisonQuery {
  const row = object(JSON.parse(syncJsonSnapshot(input, 4096)));
  if (
    Object.keys(row).some((key) => !['from_pack_id', 'to_pack_id'].includes(key)) ||
    !isUlid(row.from_pack_id) ||
    !isUlid(row.to_pack_id) ||
    row.from_pack_id === row.to_pack_id
  )
    throw new TypeError('Choose two different saved context pack IDs.');
  return { from_pack_id: row.from_pack_id, to_pack_id: row.to_pack_id };
}

/** Structure comparison only. Read callers must independently verify digests and authorization. */
export function compareSavedContextPacks(before: unknown, after: unknown) {
  const first = object(JSON.parse(syncJsonSnapshot(before, CONTEXT_PACK_READ_RESPONSE_BYTES)));
  const second = object(JSON.parse(syncJsonSnapshot(after, CONTEXT_PACK_READ_RESPONSE_BYTES)));
  const firstData = object(first.data);
  const secondData = object(second.data);
  const scope = object(object(firstData.pack).scope) as {
    tenant_id: string;
    workspace_id: string;
    project_id: string;
  };
  const query = parseContextPackComparisonQuery({
    from_pack_id: firstData.pack_id,
    to_pack_id: secondData.pack_id,
  });
  const from = parseContextPackReadEnvelope(
    first,
    { pack_id: query.from_pack_id, format: 'json' },
    scope,
    first.trace_id as string,
  );
  const to = parseContextPackReadEnvelope(
    second,
    { pack_id: query.to_pack_id, format: 'json' },
    scope,
    second.trace_id as string,
  );
  const left = candidates(from);
  const right = candidates(to);
  const ids = new Set([...left.keys(), ...right.keys()]);
  const rows = [...ids].map((id) => {
    const before: SavedPackCandidate = left.get(id) ?? { state: 'absent' };
    const after: SavedPackCandidate = right.get(id) ?? { state: 'absent' };
    const differences: string[] = [];
    if (before.state !== after.state) differences.push('Selection');
    if (before.state === 'selected' && after.state === 'selected') {
      if (before.position !== after.position) differences.push('Order');
      for (const [key, label] of [
        ['layer', 'Layer'],
        ['content', 'Content'],
        ['source_refs', 'Sources'],
        ['confirmed', 'Confirmation'],
        ['confidence', 'Confidence'],
        ['priority', 'Priority'],
        ['sensitivity', 'Classification'],
        ['trace_id', 'Saved trace'],
        ['revision', 'Revision'],
        ['expires_at', 'Expiry'],
        ['selection_reason', 'Selection reason'],
      ] as const)
        if (canonical(before.item[key]) !== canonical(after.item[key])) differences.push(label);
    }
    if (before.state === 'excluded' && after.state === 'excluded') {
      if (before.position !== after.position) differences.push('Order');
      if (before.exclusion.reason !== after.exclusion.reason) differences.push('Exclusion reason');
    }
    const status: 'added' | 'removed' | 'changed' | 'same' =
      before.state === 'absent'
        ? 'added'
        : after.state === 'absent'
          ? 'removed'
          : differences.length
            ? 'changed'
            : 'same';
    return { id, status, differences, before, after };
  });
  const field = (key: string, label: string, before: string | number, after: string | number) => ({
    key,
    label,
    before,
    after,
    changed: before !== after,
  });
  const fields = [
    field('pack_id', 'Saved pack', from.data.pack_id, to.data.pack_id),
    field('version', 'Saved version', from.data.version, to.data.version),
    field('created_at', 'Created', from.data.created_at, to.data.created_at),
    field('server_cursor', 'Saved cursor', from.server_cursor, to.server_cursor),
    field('pack_hash', 'Content hash', from.data.pack.pack_hash, to.data.pack.pack_hash),
    field('trace_id', 'Saved trace', from.data.pack.trace_id, to.data.pack.trace_id),
    field(
      'budget_tokens',
      'Token budget',
      from.data.pack.budget_tokens,
      to.data.pack.budget_tokens,
    ),
    field('used_tokens', 'Estimated tokens used', from.data.used_tokens, to.data.used_tokens),
    field('expires_at', 'Expires', from.data.pack.expires_at, to.data.pack.expires_at),
    field('selected', 'Selected items', from.data.pack.items.length, to.data.pack.items.length),
    field(
      'excluded',
      'Excluded items',
      from.data.pack.exclusions.length,
      to.data.pack.exclusions.length,
    ),
  ];
  const result = {
    query,
    scope: from.data.pack.scope,
    fields,
    candidates: rows,
    counts: {
      added: rows.filter((row) => row.status === 'added').length,
      removed: rows.filter((row) => row.status === 'removed').length,
      changed: rows.filter((row) => row.status === 'changed').length,
      same: rows.filter((row) => row.status === 'same').length,
    },
    sources: {
      before: from.data.pack.source_refs,
      after: to.data.pack.source_refs,
      changed: canonical(from.data.pack.source_refs) !== canonical(to.data.pack.source_refs),
    },
  };
  return JSON.parse(syncJsonSnapshot(result, 8 * 1024 * 1024)) as typeof result;
}
export type SavedContextPackComparison = ReturnType<typeof compareSavedContextPacks>;

function candidates(response: ContextPackReadEnvelope) {
  const rows = new Map<string, SavedPackCandidate>();
  response.data.pack.items.forEach((item, index) =>
    rows.set(item.id, { state: 'selected', position: index + 1, item }),
  );
  response.data.pack.exclusions.forEach((exclusion, index) =>
    rows.set(exclusion.id, { state: 'excluded', position: index + 1, exclusion }),
  );
  return rows;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Supply two complete saved context pack responses.');
  return value as Record<string, unknown>;
}
function canonical(value: unknown): string | undefined {
  const sorted = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sorted);
    if (entry && typeof entry === 'object')
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, field]) => [key, sorted(field)]),
      );
    return entry;
  };
  return JSON.stringify(sorted(value));
}
