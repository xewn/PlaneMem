import { isUlid } from './ids.js';
import { validateIdempotencyKey, validateSourceRef, type SourceRef } from './metadata.js';
import { parseEtag } from './versioning.js';
import { parseSessionCommandIdentity, type SessionCommandIdentity } from './session-activity.js';
import {
  parseCheckpointReceiptQuery,
  parseCheckpointReceiptLookup,
  type CheckpointReceiptQuery,
} from './checkpoint-receipts.js';

export const checkpointNoteFields = [
  'completed',
  'in_progress',
  'next_actions',
  'decisions',
  'risks',
  'open_questions',
] as const;
export type CheckpointContent = Record<(typeof checkpointNoteFields)[number], string[]>;
type Scope = { tenant_id: string; workspace_id: string; project_id: string };
export interface CheckpointMemoryReference extends Scope {
  page_ref: string;
  revision: number;
  hash: string;
  source_refs: SourceRef[];
  [field: string]: unknown;
}
export interface CheckpointSavedRecord extends Scope, CheckpointContent {
  schema_version: 1;
  checkpoint_id: string;
  session_id: string;
  revision: number;
  state_hash: string;
  context_pack_id?: string;
  context_pack_hash?: string;
  memory_ref?: CheckpointMemoryReference;
  trace_id: string;
  source_refs: SourceRef[];
}
export interface CheckpointBinding {
  session_id: string;
  identity: SessionCommandIdentity;
  query: CheckpointReceiptQuery;
}

/** Saved checkpoint structure, without claiming that it matches an original save request. */
export function parseCheckpointRecord(
  value: unknown,
  sessionId: string,
  scope: Scope,
): CheckpointSavedRecord {
  const row = object(value);
  checkScope(row, scope);
  if (
    !isUlid(sessionId) ||
    row.session_id !== sessionId ||
    row.schema_version !== 1 ||
    !isUlid(row.checkpoint_id) ||
    !positive(row.revision) ||
    !text(row.state_hash) ||
    !text(row.trace_id) ||
    (row.context_pack_hash !== undefined && !text(row.context_pack_hash)) ||
    (row.context_pack_id !== undefined &&
      (!isUlid(row.context_pack_id) ||
        typeof row.context_pack_hash !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(row.context_pack_hash)))
  )
    throw new TypeError('Invalid saved checkpoint record');
  const refs = sources(row.source_refs);
  if (
    !refs.some((ref) => ref.type === 'session' && ref.id === sessionId) ||
    (row.context_pack_id !== undefined &&
      !refs.some((ref) => ref.type === 'context-pack' && ref.id === row.context_pack_id)) ||
    refs.some(
      (ref, index) =>
        refs.findIndex((other) => other.type === ref.type && other.id === ref.id) !== index,
    )
  )
    throw new TypeError('Invalid checkpoint record sources');
  const memory = row.memory_ref === undefined ? undefined : memoryReference(row.memory_ref);
  if (memory) {
    checkScope(memory, scope);
    if (
      !memory.source_refs.every((ref) =>
        refs.some((source) => source.type === ref.type && source.id === ref.id),
      )
    )
      throw new TypeError('Checkpoint memory sources are missing');
  }
  return {
    schema_version: 1,
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id,
    session_id: sessionId,
    checkpoint_id: row.checkpoint_id,
    revision: row.revision,
    ...notes(row),
    state_hash: row.state_hash,
    trace_id: row.trace_id,
    source_refs: refs,
    ...(memory === undefined ? {} : { memory_ref: memory }),
    ...(typeof row.context_pack_id === 'string' ? { context_pack_id: row.context_pack_id } : {}),
    ...(typeof row.context_pack_hash === 'string'
      ? { context_pack_hash: row.context_pack_hash }
      : {}),
  };
}

/** Historical queries retain every original field; never trim, reorder or split note arrays. */
export function parseCheckpointBinding(
  sessionId: unknown,
  input: unknown,
  expectedIdentity: unknown,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
): CheckpointBinding {
  const query = structuredClone(parseCheckpointReceiptQuery(input));
  const identity = parseSessionCommandIdentity(expectedIdentity);
  if (!isUlid(sessionId)) throw new TypeError('session_id must be a ULID');
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (scope[field] !== identity[field]) throw new TypeError('Original checkpoint scope differs');
  if (
    (query.checkpoint.session_id !== undefined && query.checkpoint.session_id !== sessionId) ||
    (query.checkpoint.actor_id !== undefined && query.checkpoint.actor_id !== identity.actor_id) ||
    (query.checkpoint.client_id !== undefined && query.checkpoint.client_id !== identity.client_id)
  )
    throw new TypeError('Original checkpoint session or identity differs');
  return { session_id: sessionId, query, identity };
}

/** New commands accept declared fields; optional legacy references remain supported. */
export function parseCheckpointSaveCommand(value: unknown): CheckpointReceiptQuery['checkpoint'] {
  const row = object(value);
  const allowed = [
    ...checkpointNoteFields,
    'expected_version',
    'idempotency_key',
    'session_id',
    'actor_id',
    'client_id',
    'context_pack_id',
    'context_pack',
    'memory_ref',
  ];
  if (
    Object.keys(row).some((key) => !allowed.includes(key)) ||
    !positive(row.expected_version) ||
    (row.session_id !== undefined && !isUlid(row.session_id))
  )
    throw new TypeError('Supply the original session version and only declared checkpoint fields');
  notes(row);
  if (row.idempotency_key !== undefined) validateIdempotencyKey(row.idempotency_key);
  if (
    row.context_pack_id !== undefined &&
    (!isUlid(row.context_pack_id) || row.context_pack !== undefined)
  )
    throw new TypeError('Supply a saved pack ID or a legacy pack, not both');
  if (row.context_pack !== undefined) {
    const pack = object(row.context_pack);
    object(pack.scope);
    if (!text(pack.pack_hash)) throw new TypeError('Legacy pack requires its hash');
    sources(pack.source_refs);
    json(pack);
  }
  if (row.memory_ref !== undefined) memoryReference(row.memory_ref);
  return structuredClone({ ...row, expected_version: row.expected_version });
}

export function parseCheckpointSaveEnvelope(
  value: unknown,
  binding: CheckpointBinding,
  trace: string,
) {
  const { row, refs } = envelope(value, trace);
  const record = object(row.data);
  const original = binding.query.checkpoint;
  if (
    record.schema_version !== 1 ||
    record.session_id !== binding.session_id ||
    !isUlid(record.checkpoint_id) ||
    !positive(record.revision) ||
    !text(record.trace_id) ||
    !text(record.state_hash)
  )
    throw new TypeError('Invalid saved checkpoint');
  checkScope(record, binding.identity);
  const content = notes(record);
  for (const field of checkpointNoteFields)
    if (!equal(content[field], original[field]))
      throw new TypeError('Saved checkpoint notes differ');
  if (record.context_pack_id !== original.context_pack_id)
    throw new TypeError('Saved checkpoint pack binding differs');
  let packHash: string | undefined;
  if (original.context_pack_id !== undefined) {
    if (
      !isUlid(record.context_pack_id) ||
      typeof record.context_pack_hash !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(record.context_pack_hash)
    )
      throw new TypeError('Invalid saved pack hash');
    packHash = record.context_pack_hash;
  } else if (original.context_pack !== undefined) {
    const originalPack = object(original.context_pack);
    checkScope(object(originalPack.scope), binding.identity);
    if (!text(originalPack.pack_hash) || record.context_pack_hash !== originalPack.pack_hash)
      throw new TypeError('Legacy checkpoint pack hash differs');
    packHash = originalPack.pack_hash;
  } else if (record.context_pack_hash !== undefined)
    throw new TypeError('Unexpected checkpoint pack hash');
  let memory: CheckpointMemoryReference | undefined;
  if (original.memory_ref !== undefined) {
    memory = memoryReference(record.memory_ref);
    checkScope(memory, binding.identity);
    if (!equal(memory, original.memory_ref)) throw new TypeError('Saved memory reference differs');
  } else if (record.memory_ref !== undefined) throw new TypeError('Unexpected memory reference');
  const recordRefs = sources(record.source_refs);
  if (
    recordRefs.some(
      (ref, index) =>
        recordRefs.findIndex((other) => other.type === ref.type && other.id === ref.id) !== index,
    )
  )
    throw new TypeError('Checkpoint sources must be unique');
  if (!equal(refs, recordRefs)) throw new TypeError('Checkpoint envelope sources differ');
  const expectedRefs = [
    { type: 'session', id: binding.session_id },
    ...(original.context_pack_id === undefined
      ? []
      : [{ type: 'context-pack', id: original.context_pack_id }]),
    ...(memory?.source_refs ?? []),
    ...(original.context_pack === undefined
      ? []
      : sources(object(original.context_pack).source_refs)),
  ].filter(
    (ref, index, all) =>
      all.findIndex((other) => other.type === ref.type && other.id === ref.id) === index,
  );
  if (
    original.context_pack_id === undefined
      ? !equal(recordRefs, expectedRefs)
      : !expectedRefs.every((ref, index) => equal(recordRefs[index], ref))
  )
    throw new TypeError('Checkpoint sources do not match original bindings');
  if (row.etag !== undefined && parseEtag(row.etag) !== record.revision)
    throw new TypeError('Checkpoint ETag differs from revision');
  const data: CheckpointSavedRecord = {
    schema_version: 1,
    tenant_id: binding.identity.tenant_id,
    workspace_id: binding.identity.workspace_id,
    project_id: binding.identity.project_id,
    checkpoint_id: record.checkpoint_id,
    session_id: binding.session_id,
    revision: record.revision,
    ...content,
    state_hash: record.state_hash,
    trace_id: record.trace_id,
    source_refs: recordRefs,
    ...(original.context_pack_id === undefined
      ? {}
      : { context_pack_id: String(original.context_pack_id) }),
    ...(packHash === undefined ? {} : { context_pack_hash: packHash }),
    ...(memory === undefined ? {} : { memory_ref: memory }),
  };
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: refs,
    data,
    ...(typeof row.etag === 'string' ? { etag: row.etag } : {}),
  };
}

export function parseCheckpointReceiptEnvelope(
  value: unknown,
  binding: CheckpointBinding,
  trace: string,
) {
  const { row, refs } = envelope(value, trace);
  if (refs.length || row.etag !== undefined)
    throw new TypeError('Historical receipt has current resource metadata');
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    data: parseCheckpointReceiptLookup(
      row.data,
      binding.session_id,
      binding.query.checkpoint.context_pack_id,
    ),
  };
}

function envelope(value: unknown, trace: string) {
  const row = object(value);
  if (row.schema_version !== 1 || !text(trace) || row.trace_id !== trace)
    throw new TypeError('Invalid checkpoint response trace');
  return { row, refs: sources(row.source_refs) };
}
function checkScope(value: Record<string, unknown>, scope: Scope) {
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (value[field] !== scope[field]) throw new TypeError('Checkpoint reference scope differs');
}
function memoryReference(value: unknown): CheckpointMemoryReference {
  const row = object(value);
  for (const field of ['tenant_id', 'workspace_id', 'project_id', 'page_ref', 'hash'])
    if (!text(row[field])) throw new TypeError('Invalid memory reference');
  if (!positive(row.revision)) throw new TypeError('Invalid memory revision');
  sources(row.source_refs);
  json(row);
  return structuredClone(row) as CheckpointMemoryReference;
}
function notes(row: Record<string, unknown>): CheckpointContent {
  const result = {} as CheckpointContent;
  for (const field of checkpointNoteFields) {
    const value = row[field];
    if (
      !Array.isArray(value) ||
      Object.keys(value).length !== value.length ||
      Array.from(value).some((entry) => typeof entry !== 'string')
    )
      throw new TypeError('Supply all six original note arrays');
    result[field] = [...value] as string[];
  }
  return result;
}
function sources(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length)
    throw new TypeError('Invalid checkpoint sources');
  const refs = Array.from(value, (ref) => ({ ...validateSourceRef(ref) }));
  return refs;
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 4096;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected checkpoint data');
  return value as Record<string, unknown>;
}
function json(value: unknown, depth = 0): string {
  if (depth > 32) throw new TypeError('Checkpoint reference is too deeply nested');
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length)
      throw new TypeError('Sparse reference arrays are unsupported');
    return '[' + value.map((entry) => json(entry, depth + 1)).join(',') + ']';
  }
  const row = object(value);
  if (Object.getPrototypeOf(row) !== Object.prototype && Object.getPrototypeOf(row) !== null)
    throw new TypeError('Checkpoint reference must contain JSON objects');
  return (
    '{' +
    Object.keys(row)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + json(row[key], depth + 1))
      .join(',') +
    '}'
  );
}
function equal(left: unknown, right: unknown): boolean {
  return json(left) === json(right);
}
