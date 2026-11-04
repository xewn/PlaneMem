import { isUlid } from './ids.js';
import { isSyncIdentifier } from './sync.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import { validateSourceRef, type SourceRef } from './metadata.js';
import { parseConfirmContextItem } from './context-items.js';
import type {
  ContextItemDocument,
  ContextItemHistoryPage,
  ContextItemRevision,
  ContextItemRevisionSummary,
} from './context-items.js';

export const CONTEXT_HISTORY_RESPONSE_BYTES = 256 * 1024;
export const CONTEXT_REVISION_RESPONSE_BYTES = 2 * 1024 * 1024;
export const CONTEXT_HISTORY_ERROR_BYTES = 16 * 1024;

export type ContextHistoryReadQuery =
  | { kind: 'history'; item_id: string; limit: number; before_version?: number }
  | { kind: 'version'; item_id: string; version: number };
export interface ContextHistoryReadEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: ContextItemHistoryPage | ContextItemRevision;
}

/** Capture only a local item and positive numeric positions before any asynchronous work. */
export function parseContextHistoryReadQuery(value: unknown): ContextHistoryReadQuery {
  const row = object(JSON.parse(syncJsonSnapshot(value, 4096)));
  const item_id = identifier(row.item_id);
  if (row.kind === 'version') {
    only(row, ['kind', 'item_id', 'version']);
    return { kind: 'version', item_id, version: positive(row.version) };
  }
  only(row, ['kind', 'item_id', 'limit', 'before_version']);
  if (row.kind !== 'history') throw new TypeError('Choose a context history or version read');
  const limit = row.limit === undefined ? 25 : positive(row.limit);
  if (limit > 100) throw new TypeError('Read at most 100 history entries');
  return {
    kind: 'history',
    item_id,
    limit,
    ...(row.before_version === undefined ? {} : { before_version: positive(row.before_version) }),
  };
}

/** The directory has no scope echo; the version document must match the requested scope. */
export function parseContextHistoryReadEnvelope(
  value: unknown,
  input: ContextHistoryReadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
): ContextHistoryReadEnvelope {
  const query = parseContextHistoryReadQuery(input);
  const row = object(
    JSON.parse(
      syncJsonSnapshot(
        value,
        query.kind === 'history' ? CONTEXT_HISTORY_RESPONSE_BYTES : CONTEXT_REVISION_RESPONSE_BYTES,
      ),
    ),
  );
  only(row, ['schema_version', 'trace_id', 'source_refs', 'data']);
  if (row.schema_version !== 1 || row.trace_id !== trace || !isSyncIdentifier(trace))
    throw new TypeError('Context history response trace differs');
  const source_refs = sources(row.source_refs);
  const data =
    query.kind === 'history' ? historyPage(row.data, query) : revision(row.data, query, scope);
  const expected: SourceRef[] =
    query.kind === 'history'
      ? [{ type: 'context-item', id: query.item_id }]
      : [
          { type: 'context-item', id: query.item_id, revision: query.version },
          ...(data as ContextItemRevision).item.source_refs,
        ];
  if (JSON.stringify(source_refs) !== JSON.stringify(expected))
    throw new TypeError('Context history sources differ');
  return { schema_version: 1, trace_id: trace, source_refs, data };
}

function historyPage(
  value: unknown,
  query: Extract<ContextHistoryReadQuery, { kind: 'history' }>,
): ContextItemHistoryPage {
  const row = object(value);
  only(row, ['item_id', 'current_version', 'current_archived', 'versions', 'next_before_version']);
  const current_version = positive(row.current_version);
  if (
    row.item_id !== query.item_id ||
    typeof row.current_archived !== 'boolean' ||
    !Array.isArray(row.versions) ||
    row.versions.length > query.limit
  )
    throw new TypeError('Invalid context history page');
  let previous = query.before_version;
  const versions = row.versions.map((value: unknown) => {
    const entry = summary(value);
    if (
      entry.version > current_version ||
      (previous !== undefined && entry.version >= previous) ||
      (entry.version === current_version && entry.archived !== row.current_archived)
    )
      throw new TypeError('Context history versions must descend within the requested page');
    previous = entry.version;
    return entry;
  });
  let next_before_version: number | undefined;
  if (row.next_before_version !== undefined) {
    next_before_version = positive(row.next_before_version);
    if (
      versions.length !== query.limit ||
      next_before_version !== previous ||
      next_before_version <= 1
    )
      throw new TypeError('Invalid context history continuation');
  }
  return {
    item_id: query.item_id,
    current_version,
    current_archived: row.current_archived,
    versions,
    ...(next_before_version === undefined ? {} : { next_before_version }),
  };
}

const summaryFields = [
  'version',
  'operation',
  'title',
  'classification',
  'status',
  'archived',
  'recorded_at',
  'actor_id',
  'client_id',
  'event_id',
  'snapshot_hash',
];

function summary(value: unknown, detail = false): ContextItemRevisionSummary {
  const row = object(value);
  only(row, [...summaryFields, ...(detail ? ['item', 'archived_at', 'confirmation'] : [])]);
  const version = positive(row.version);
  if (
    !['baseline', 'create', 'update', 'archive', 'restore', 'confirm'].includes(
      row.operation as string,
    ) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(row.classification as string) ||
    !['confirmed', 'proposed', 'expired', 'excluded'].includes(row.status as string) ||
    typeof row.archived !== 'boolean' ||
    typeof row.snapshot_hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.snapshot_hash)
  )
    throw new TypeError('Invalid context history summary');
  if (row.operation === 'baseline') {
    if (row.actor_id !== null || row.client_id !== null || row.event_id !== null)
      throw new TypeError('A baseline cannot invent command attribution');
  } else if (
    !isSyncIdentifier(row.actor_id) ||
    !isSyncIdentifier(row.client_id) ||
    !isUlid(row.event_id)
  )
    throw new TypeError('Invalid historical command attribution');
  if (
    (row.operation !== 'baseline' && row.operation !== 'create' && version < 2) ||
    (row.operation === 'create' && (version !== 1 || row.status !== 'proposed' || row.archived)) ||
    (row.operation === 'update' &&
      (!['proposed', 'excluded'].includes(row.status as string) || row.archived)) ||
    (row.operation === 'archive' && (row.status !== 'excluded' || !row.archived)) ||
    (row.operation === 'restore' && (row.status !== 'excluded' || row.archived)) ||
    (row.operation === 'confirm' && (version < 2 || row.status !== 'confirmed' || row.archived))
  )
    throw new TypeError('Historical command state differs');
  return {
    version,
    operation: row.operation as ContextItemRevisionSummary['operation'],
    title: text(row.title),
    classification: row.classification as ContextItemRevisionSummary['classification'],
    status: row.status as ContextItemRevisionSummary['status'],
    archived: row.archived,
    recorded_at: date(row.recorded_at),
    actor_id: row.actor_id as string | null,
    client_id: row.client_id as string | null,
    event_id: row.event_id as string | null,
    snapshot_hash: row.snapshot_hash,
  };
}

function revision(
  value: unknown,
  query: Extract<ContextHistoryReadQuery, { kind: 'version' }>,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
): ContextItemRevision {
  const row = object(value);
  const entry = summary(row, true);
  if (entry.version !== query.version) throw new TypeError('Context history version differs');
  const item = object(row.item);
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
  ]);
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isUlid(scope[key]) || item[key] !== scope[key])
      throw new TypeError('Context snapshot scope differs');
  if (
    item.id !== query.item_id ||
    item.version !== entry.version ||
    item.title !== entry.title ||
    item.classification !== entry.classification ||
    item.status !== entry.status ||
    !Object.hasOwn(item, 'content') ||
    !['L0', 'L1', 'L2', 'L3', 'L4'].includes(item.layer as string) ||
    !['High', 'Medium', 'Low'].includes(item.priority as string) ||
    typeof item.confidence !== 'number' ||
    !Number.isFinite(item.confidence) ||
    item.confidence < 0 ||
    item.confidence > 1
  )
    throw new TypeError('Invalid context snapshot document');
  text(item.item_type);
  text(item.source_ref);
  if (!isSyncIdentifier(item.trace_id)) throw new TypeError('Invalid saved context trace');
  const refs = sources(item.source_refs);
  const created = date(item.created_at);
  const updated = date(item.updated_at);
  if (Date.parse(updated) < Date.parse(created)) throw new TypeError('Invalid snapshot timestamps');
  if (item.expires_at !== null) date(item.expires_at);
  const archived_at = row.archived_at === null ? null : date(row.archived_at);
  if ((archived_at !== null) !== entry.archived)
    throw new TypeError('Snapshot archive state differs');
  const document = { ...item, source_refs: refs } as unknown as ContextItemDocument;
  let confirmation: ContextItemRevision['confirmation'];
  if (entry.operation === 'confirm') {
    const approved = object(row.confirmation);
    only(approved, [
      'reviewed_version',
      'confirmed_version',
      'actor_id',
      'client_id',
      'event_id',
      'reason',
      'confirmed_at',
    ]);
    const reason = parseConfirmContextItem({ reason: approved.reason }).reason;
    if (
      approved.reviewed_version !== entry.version - 1 ||
      approved.confirmed_version !== entry.version ||
      approved.actor_id !== entry.actor_id ||
      approved.client_id !== entry.client_id ||
      approved.event_id !== entry.event_id ||
      approved.confirmed_at !== entry.recorded_at ||
      reason !== approved.reason
    )
      throw new TypeError('Historical confirmation differs from the recorded command');
    confirmation = {
      reviewed_version: entry.version - 1,
      confirmed_version: entry.version,
      actor_id: entry.actor_id!,
      client_id: entry.client_id!,
      event_id: entry.event_id!,
      reason,
      confirmed_at: entry.recorded_at,
    };
  } else {
    if (row.confirmation !== undefined && row.confirmation !== null)
      throw new TypeError('Unexpected historical confirmation');
    confirmation = row.confirmation as null | undefined;
  }
  return {
    ...entry,
    item: document,
    archived_at,
    ...(confirmation === undefined ? {} : { confirmation }),
  };
}

/** Hash this with SHA-256 after parsing; matches Gateway fingerprint({ item, archived_at }). */
export function contextRevisionSnapshotJson(value: ContextItemRevision): string {
  const snapshot: unknown = JSON.parse(
    syncJsonSnapshot(
      { item: value.item, archived_at: value.archived_at },
      CONTEXT_REVISION_RESPONSE_BYTES,
    ),
  );
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      const row = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(row)
          .sort()
          .map((key) => [key, stable(row[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(stable(snapshot));
}

function sources(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid context history sources');
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
    throw new TypeError('Invalid context history fields');
  return value as Record<string, unknown>;
}
function only(row: Record<string, unknown>, fields: string[]) {
  if (Object.keys(row).some((key) => !fields.includes(key)))
    throw new TypeError('Unknown context history fields');
}
function identifier(value: unknown): string {
  if (!isSyncIdentifier(value) || value === '.' || value === '..')
    throw new TypeError('Invalid context item ID');
  return value;
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new TypeError('Use positive history positions');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000\p{Cs}]/u.test(value))
    throw new TypeError('Invalid historical text');
  return value;
}
function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 27 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError('Invalid historical timestamp');
  return value;
}
