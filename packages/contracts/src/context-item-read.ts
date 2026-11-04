import { isUlid } from './ids.js';
import { isSyncIdentifier } from './sync.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import { buildEtag } from './versioning.js';
import { validateSourceRef, type SourceRef } from './metadata.js';
import { parseConfirmContextItem } from './context-items.js';
import type {
  ArchivedContextItemDocument,
  ContextItemReadDocument,
  ContextSourceCheck,
} from './context-items.js';

export const CONTEXT_ITEM_READ_RESPONSE_BYTES = 2 * 1024 * 1024;
export const CONTEXT_ITEM_READ_ERROR_BYTES = 16 * 1024;

export interface ContextItemReadQuery {
  kind: 'current' | 'archived';
  item_id: string;
}
export interface ContextItemReadEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  revision: number;
  etag: string;
  data: ContextItemReadDocument | ArchivedContextItemDocument;
}

/** Capture the explicit active/archived selection before waiting for a session or network. */
export function parseContextItemReadQuery(value: unknown): ContextItemReadQuery {
  const row = object(JSON.parse(syncJsonSnapshot(value, 4096)));
  only(row, ['kind', 'item_id']);
  if (
    (row.kind !== 'current' && row.kind !== 'archived') ||
    !isSyncIdentifier(row.item_id) ||
    row.item_id === '.' ||
    row.item_id === '..'
  )
    throw new TypeError('Choose a current or archived context item');
  return { kind: row.kind, item_id: row.item_id };
}

/** Complete structure and request matching; live hints are observations, never write authority. */
export function parseContextItemReadEnvelope(
  value: unknown,
  input: ContextItemReadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
): ContextItemReadEnvelope {
  const query = parseContextItemReadQuery(input);
  const row = object(JSON.parse(syncJsonSnapshot(value, CONTEXT_ITEM_READ_RESPONSE_BYTES)));
  only(row, ['schema_version', 'trace_id', 'source_refs', 'revision', 'etag', 'data']);
  if (row.schema_version !== 1 || !isSyncIdentifier(trace) || row.trace_id !== trace)
    throw new TypeError('Context detail trace differs');
  const item = object(row.data);
  only(item, [
    'id',
    'tenant_id',
    'workspace_id',
    'project_id',
    'title',
    'content',
    'source_refs',
    'source_ref',
    'item_type',
    'layer',
    'classification',
    'status',
    'priority',
    'confidence',
    'expires_at',
    'version',
    'trace_id',
    'created_at',
    'updated_at',
    ...(query.kind === 'archived'
      ? ['archived_at']
      : [
          'confirm_allowed',
          'confirmation',
          'sources_current',
          'source_check',
          'source_checks',
          'confirmation_readiness',
        ]),
  ]);
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isUlid(scope[key]) || item[key] !== scope[key])
      throw new TypeError('Context scope differs');
  const version = positive(item.version);
  if (
    item.id !== query.item_id ||
    row.revision !== version ||
    row.etag !== buildEtag(version) ||
    !Object.hasOwn(item, 'content') ||
    !isSyncIdentifier(item.trace_id) ||
    !['L0', 'L1', 'L2', 'L3', 'L4'].includes(item.layer as string) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(item.classification as string) ||
    !['confirmed', 'proposed', 'expired', 'excluded'].includes(item.status as string) ||
    !['High', 'Medium', 'Low'].includes(item.priority as string) ||
    typeof item.confidence !== 'number' ||
    !Number.isFinite(item.confidence) ||
    item.confidence < 0 ||
    item.confidence > 1
  )
    throw new TypeError('Invalid context detail');
  for (const key of ['title', 'source_ref', 'item_type']) text(item[key]);
  const created = date(item.created_at);
  const updated = date(item.updated_at);
  if (Date.parse(updated) < Date.parse(created)) throw new TypeError('Invalid context timestamps');
  if (item.expires_at !== null) date(item.expires_at);
  const refs = sources(item.source_refs);
  const source_refs = sources(row.source_refs);
  if (
    JSON.stringify(source_refs) !==
    JSON.stringify([{ type: 'context-item', id: query.item_id, revision: version }, ...refs])
  )
    throw new TypeError('Context detail sources differ');

  if (query.kind === 'archived') {
    date(item.archived_at);
    if (item.status !== 'excluded') throw new TypeError('Invalid archived context state');
  } else {
    const check = sourceCheck(item.source_check, item.sources_current);
    if (typeof item.confirm_allowed !== 'boolean') throw new TypeError('Invalid review hint');
    if (item.source_checks !== undefined)
      referenceChecks(item.source_checks, refs, item.sources_current === true);
    if (
      item.sources_current === true &&
      (['expired', 'excluded'].includes(item.status as string) ||
        (item.expires_at !== null &&
          Date.parse(item.expires_at as string) <= Date.parse(check.checked_at)))
    )
      throw new TypeError('Current sources contradict the saved item state');
    confirmation(item.confirmation, item.status, version);
    let ready: Record<string, unknown> | undefined;
    if (item.confirmation_readiness !== undefined) {
      ready = object(item.confirmation_readiness);
      only(ready, ['sources_current', 'source_check', 'source_checks', 'effective_expires_at']);
      if (item.status !== 'proposed') throw new TypeError('Unexpected review readiness');
      const strict = sourceCheck(ready.source_check, ready.sources_current);
      if (strict.checked_at !== check.checked_at) throw new TypeError('Review observation differs');
      if (ready.source_checks !== undefined)
        referenceChecks(ready.source_checks, refs, ready.sources_current === true);
      if (ready.effective_expires_at !== null) date(ready.effective_expires_at);
      if (
        ready.sources_current === true &&
        ready.effective_expires_at !== null &&
        Date.parse(ready.effective_expires_at as string) <= Date.parse(strict.checked_at)
      )
        throw new TypeError('Review readiness was already expired');
      if (
        ready.sources_current === true &&
        (item.sources_current !== true ||
          refs.length === 0 ||
          (item.expires_at !== null &&
            (ready.effective_expires_at === null ||
              Date.parse(ready.effective_expires_at as string) >
                Date.parse(item.expires_at as string))))
      )
        throw new TypeError('Review readiness contradicts the current item');
    }
    if (item.confirm_allowed && (item.status !== 'proposed' || ready?.sources_current !== true))
      throw new TypeError('Review hint lacks current confirmation readiness');
  }
  return {
    schema_version: 1,
    trace_id: trace,
    revision: version,
    etag: buildEtag(version),
    source_refs,
    data: { ...item, source_refs: refs } as unknown as ContextItemReadEnvelope['data'],
  };
}

const states = [
  'current',
  'stale',
  'unavailable',
  'expired',
  'excluded',
  'cycle',
  'limit',
  'invalid',
];
function sourceCheck(value: unknown, current: unknown): ContextSourceCheck {
  const row = object(value);
  only(row, ['state', 'checked_at', 'scope']);
  if (
    !states.includes(row.state as string) ||
    row.scope !== 'local-context-items' ||
    typeof current !== 'boolean' ||
    current !== (row.state === 'current')
  )
    throw new TypeError('Invalid context source observation');
  date(row.checked_at);
  return row as unknown as ContextSourceCheck;
}

function referenceChecks(value: unknown, refs: SourceRef[], current: boolean) {
  if (!Array.isArray(value)) throw new TypeError('Invalid source diagnostics');
  const seen = new Set<number>();
  for (const raw of value) {
    const row = object(raw);
    only(row, ['source_index', 'state', 'issue', 'current_revision']);
    const index = row.source_index;
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= refs.length ||
      seen.has(index) ||
      refs[index]!.type !== 'context-item' ||
      ![...states, 'not-checked'].includes(row.state as string)
    )
      throw new TypeError('Invalid source diagnostic position or state');
    seen.add(index);
    if (
      row.issue !== undefined &&
      !['reference', 'revision', 'confirmation', 'classification', 'dependency'].includes(
        row.issue as string,
      )
    )
      throw new TypeError('Invalid source diagnostic issue');
    if (row.current_revision !== undefined) positive(row.current_revision);
    if (
      row.state === 'current' &&
      (row.issue !== undefined ||
        row.current_revision !== refs[index]!.revision ||
        typeof row.current_revision !== 'number' ||
        row.current_revision < 1)
    )
      throw new TypeError('Current source diagnostic differs from its pinned revision');
    if (current && row.state !== 'current')
      throw new TypeError('Source diagnostics contradict the aggregate observation');
  }
  if (current && seen.size !== refs.filter((ref) => ref.type === 'context-item').length)
    throw new TypeError('Current source diagnostics omit local references');
}

function confirmation(value: unknown, status: unknown, version: number) {
  // Older confirmed items can legitimately have no recorded human confirmation.
  if (value === null) return;
  const row = object(value);
  only(row, [
    'reviewed_version',
    'confirmed_version',
    'actor_id',
    'client_id',
    'event_id',
    'reason',
    'confirmed_at',
  ]);
  if (
    status !== 'confirmed' ||
    version < 2 ||
    row.reviewed_version !== version - 1 ||
    row.confirmed_version !== version ||
    !isSyncIdentifier(row.actor_id) ||
    !isSyncIdentifier(row.client_id) ||
    !isUlid(row.event_id) ||
    parseConfirmContextItem({ reason: row.reason }).reason !== row.reason
  )
    throw new TypeError('Invalid recorded context confirmation');
  date(row.confirmed_at);
}

function sources(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid context sources');
  return value.map((raw: unknown) => {
    const row = object(raw);
    only(row, ['type', 'id', 'revision', 'uri']);
    const ref = validateSourceRef(row);
    text(ref.type);
    text(ref.id);
    if (ref.uri !== undefined) text(ref.uri);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid context fields');
  return value as Record<string, unknown>;
}
function only(row: Record<string, unknown>, fields: string[]) {
  if (Object.keys(row).some((key) => !fields.includes(key)))
    throw new TypeError('Unknown context fields');
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new TypeError('Invalid context version');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000\p{Cs}]/u.test(value))
    throw new TypeError('Invalid context text');
  return value;
}
function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 27 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError('Invalid context timestamp');
  return value;
}
