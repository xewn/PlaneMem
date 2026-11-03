import { isUlid } from './ids.js';
import { validateSourceRef, type Classification, type SourceRef } from './metadata.js';

export interface ObservedScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}
export type ObservedReadKind = 'project' | 'work-item' | 'context';
export interface PlaneRestoreReference {
  event_id: string;
  aggregate_version: number;
}

export function parsePlaneRestoreReference(
  value: unknown,
  restoreVersion: number,
): PlaneRestoreReference {
  const ref = object(value);
  if (
    Object.keys(ref).some((key) => key !== 'event_id' && key !== 'aggregate_version') ||
    !isUlid(ref.event_id) ||
    typeof ref.aggregate_version !== 'number' ||
    !Number.isSafeInteger(ref.aggregate_version) ||
    ref.aggregate_version < 1 ||
    !Number.isSafeInteger(restoreVersion) ||
    restoreVersion < 2 ||
    ref.aggregate_version !== restoreVersion - 1
  )
    throw new TypeError('Restore must reference the immediately preceding deletion version');
  return { event_id: ref.event_id, aggregate_version: ref.aggregate_version };
}

export interface ObservedSnapshot extends ObservedScope {
  schema_version: 1 | 2;
  /** Version 2 represents a deletion observation; version 1 must omit this field. */
  deleted_at?: string;
  restored_from?: PlaneRestoreReference;
  entity_kind: 'Project' | 'WorkItem';
  external_id: string;
  aggregate_id: string;
  authority: 'plane';
  plane_version: number;
  observed_at: string;
  source_event_id: string;
  source_refs: SourceRef[];
  classification: Classification;
  status?: string;
  fields: Record<string, unknown>;
}
export interface ObservedContextHit extends ObservedScope {
  schema_version: 1;
  id: string;
  title: string;
  snippet: string;
  revision: number;
  score: number;
  rank_source: 'fts' | 'memory';
  classification: Classification;
  source_refs: SourceRef[];
}
export interface ObservedWorkItemContext {
  work_item: ObservedSnapshot;
  /** Legacy field name: a search summary, not a persisted ContextPackReceipt. */
  context_pack: {
    schema_version: 1;
    query: string;
    trace_id: string;
    degraded: boolean;
    backend: 'postgres';
    memory_used: boolean;
    vector_used: false;
    hits: ObservedContextHit[];
    source_refs: SourceRef[];
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an observed record');
  return value as Record<string, unknown>;
}
export function parseObservedRecordId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim() !== value ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Expected an external or aggregate ID of 1–255 characters');
  return value;
}
export function parseObservedReadInput(
  value: unknown,
  kind: ObservedReadKind,
  projectId: string,
): { id: string } {
  if (!['project', 'work-item', 'context'].includes(kind))
    throw new TypeError('Unknown observed read kind');
  const input = object(value);
  const field = kind === 'project' ? 'project_id' : 'work_item_id';
  if (Object.keys(input).some((key) => key !== field))
    throw new TypeError('Unknown observed read field');
  const id = parseObservedRecordId(
    input[field] === undefined && kind === 'project' ? projectId : input[field],
  );
  if (kind === 'project' && id !== projectId) throw new TypeError('Use the current project ID');
  return { id };
}
function checkScope(value: Record<string, unknown>, expected: ObservedScope): void {
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (value[field] !== parseObservedRecordId(expected[field]))
      throw new TypeError('Observed scope mismatch');
}
function sources(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) throw new TypeError('Expected observed source references');
  return value.map((raw) => {
    const ref = validateSourceRef(raw);
    return {
      type: ref.type,
      id: ref.id,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }),
      ...(ref.uri === undefined ? {} : { uri: ref.uri }),
    };
  });
}
function classification(value: unknown): Classification {
  if (!['public', 'internal', 'confidential', 'restricted'].includes(value as string))
    throw new TypeError('Invalid observed classification');
  return value as Classification;
}

export function parseObservedSnapshot(
  value: unknown,
  kind: ObservedSnapshot['entity_kind'],
  id: string,
  scope: ObservedScope,
): ObservedSnapshot {
  parseObservedRecordId(id);
  const row = object(value);
  checkScope(row, scope);
  const external_id = parseObservedRecordId(row.external_id);
  if (
    (row.schema_version !== 1 && row.schema_version !== 2) ||
    row.entity_kind !== kind ||
    row.authority !== 'plane' ||
    !isUlid(row.aggregate_id) ||
    !isUlid(row.source_event_id) ||
    (external_id !== id && row.aggregate_id !== id) ||
    (kind === 'Project' && id !== scope.project_id) ||
    typeof row.plane_version !== 'number' ||
    !Number.isSafeInteger(row.plane_version) ||
    row.plane_version < 1 ||
    typeof row.observed_at !== 'string' ||
    !Number.isFinite(Date.parse(row.observed_at)) ||
    new Date(row.observed_at).toISOString() !== row.observed_at ||
    (row.status !== undefined && typeof row.status !== 'string')
  )
    throw new TypeError('Invalid observed snapshot');
  const fields = object(row.fields);
  let restoredFrom: PlaneRestoreReference | undefined;
  if (row.restored_from !== undefined) {
    restoredFrom = parsePlaneRestoreReference(row.restored_from, row.plane_version);
    const fieldRef = parsePlaneRestoreReference(fields.restored_from, row.plane_version);
    if (
      kind !== 'WorkItem' ||
      row.schema_version !== 1 ||
      fields.external_id !== external_id ||
      restoredFrom.event_id === row.source_event_id ||
      restoredFrom.event_id !== fieldRef.event_id ||
      restoredFrom.aggregate_version !== fieldRef.aggregate_version ||
      typeof fields.title !== 'string' ||
      !fields.title.trim() ||
      fields.title.length > 2000 ||
      typeof fields.status !== 'string' ||
      !fields.status.trim() ||
      fields.status.length > 255
    )
      throw new TypeError('Invalid restored observation');
  }
  if (row.schema_version === 2) {
    if (
      kind !== 'WorkItem' ||
      typeof row.deleted_at !== 'string' ||
      row.deleted_at !== row.observed_at ||
      row.status !== undefined ||
      Object.keys(fields).length !== 1 ||
      fields.external_id !== external_id
    )
      throw new TypeError('Invalid deleted observation');
  } else if (row.deleted_at !== undefined) {
    throw new TypeError('An active observation cannot include a deletion marker');
  }
  if (
    (fields.external_id ?? row.aggregate_id) !== external_id ||
    row.status !== (typeof fields.status === 'string' ? fields.status : undefined)
  )
    throw new TypeError('Observed fields disagree with their identity or status');
  return {
    schema_version: row.schema_version,
    ...(restoredFrom ? { restored_from: restoredFrom } : {}),
    ...(row.schema_version === 2 ? { deleted_at: row.deleted_at as string } : {}),
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id,
    entity_kind: kind,
    external_id,
    aggregate_id: row.aggregate_id,
    authority: 'plane',
    plane_version: row.plane_version,
    observed_at: row.observed_at,
    source_event_id: row.source_event_id,
    source_refs: sources(row.source_refs),
    classification: classification(row.classification),
    fields: structuredClone(fields),
    ...(row.status === undefined ? {} : { status: row.status as string }),
  };
}

export function parseObservedWorkItemContext(
  value: unknown,
  id: string,
  scope: ObservedScope,
  traceId: string,
): ObservedWorkItemContext {
  const input = object(value);
  const work_item = parseObservedSnapshot(input.work_item, 'WorkItem', id, scope);
  if (work_item.schema_version !== 1)
    throw new TypeError('A deleted observation cannot be used as an active context summary');
  const pack = object(input.context_pack);
  if (
    pack.schema_version !== 1 ||
    pack.backend !== 'postgres' ||
    pack.vector_used !== false ||
    pack.trace_id !== traceId ||
    typeof traceId !== 'string' ||
    !traceId.trim() ||
    typeof pack.query !== 'string' ||
    !pack.query.trim() ||
    pack.query.length > 1000 ||
    typeof pack.degraded !== 'boolean' ||
    typeof pack.memory_used !== 'boolean' ||
    !Array.isArray(pack.hits) ||
    pack.hits.length < 1 ||
    pack.hits.length > 20
  )
    throw new TypeError('Invalid observed context summary');
  const seen = new Set<string>();
  const hits: ObservedContextHit[] = pack.hits.map((value: unknown, index: number) => {
    const hit = object(value);
    checkScope(hit, scope);
    if (
      hit.schema_version !== 1 ||
      typeof hit.id !== 'string' ||
      !hit.id ||
      typeof hit.title !== 'string' ||
      !hit.title.trim() ||
      typeof hit.snippet !== 'string' ||
      typeof hit.revision !== 'number' ||
      !Number.isSafeInteger(hit.revision) ||
      hit.revision < 0 ||
      typeof hit.score !== 'number' ||
      !Number.isFinite(hit.score) ||
      hit.score <= 0 ||
      hit.score > 1
    )
      throw new TypeError('Invalid observed context hit');
    const source_refs = sources(hit.source_refs);
    const sensitivity = classification(hit.classification);
    if (index === 0) {
      if (
        hit.id !== `plane:WorkItem:${work_item.external_id}` ||
        hit.revision !== work_item.plane_version ||
        hit.rank_source !== 'fts' ||
        hit.score !== 1 ||
        sensitivity !== work_item.classification ||
        JSON.stringify(source_refs) !== JSON.stringify(work_item.source_refs)
      )
        throw new TypeError('Local summary does not match the observed snapshot');
    } else {
      parseObservedRecordId(hit.id);
      if (
        !pack.memory_used ||
        hit.rank_source !== 'memory' ||
        sensitivity !== 'restricted' ||
        seen.has(hit.id)
      )
        throw new TypeError('Invalid external memory hit');
      seen.add(hit.id);
    }
    return {
      schema_version: 1,
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
      id: hit.id,
      title: hit.title,
      snippet: hit.snippet,
      revision: hit.revision,
      score: hit.score,
      rank_source: index === 0 ? 'fts' : 'memory',
      classification: sensitivity,
      source_refs,
    };
  });
  const source_refs = sources(pack.source_refs);
  const expectedRefs = new Map<string, SourceRef>();
  for (const ref of hits.flatMap((hit) => hit.source_refs)) {
    const key = JSON.stringify([ref.type, ref.id]);
    if (!expectedRefs.has(key)) expectedRefs.set(key, ref);
  }
  if (
    source_refs.length !== expectedRefs.size ||
    source_refs.some((ref) => {
      const key = JSON.stringify([ref.type, ref.id]);
      const expected = expectedRefs.get(key);
      expectedRefs.delete(key);
      return JSON.stringify(expected) !== JSON.stringify(ref);
    })
  )
    throw new TypeError('Context sources do not match the returned hits');
  return {
    work_item,
    context_pack: {
      schema_version: 1,
      query: pack.query,
      trace_id: traceId,
      degraded: pack.degraded,
      backend: 'postgres',
      memory_used: pack.memory_used,
      vector_used: false,
      hits,
      source_refs,
    },
  };
}
