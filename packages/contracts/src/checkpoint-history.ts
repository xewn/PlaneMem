import { isUlid } from './ids.js';
import { parseSessionCommandIdentity } from './session-activity.js';
import {
  assertCheckpointReadBytes,
  CHECKPOINT_HISTORY_RESPONSE_BYTES,
} from './checkpoint-read-limits.js';
import { checkpointNoteFields, type CheckpointContent } from './checkpoint-clients.js';

export const CHECKPOINT_HISTORY_PAGE_SIZE = 10;
export interface CheckpointHistoryQuery {
  session_id: string;
  before_revision?: number;
}
export interface CheckpointHistoryEntry extends CheckpointContent {
  checkpoint_id: string;
  session_id: string;
  revision: number;
  created_at: string;
  trace_id: string;
  context_pack_id?: string;
  context_pack_hash?: string;
}

export function parseCheckpointHistoryQuery(value: unknown): CheckpointHistoryQuery {
  const row = object(value);
  if (
    !isUlid(row.session_id) ||
    Object.keys(row).some((key) => !['session_id', 'before_revision'].includes(key)) ||
    (row.before_revision !== undefined && !positive(row.before_revision))
  )
    throw new TypeError('Supply a session ULID and an optional positive revision cursor');
  return {
    session_id: row.session_id,
    ...(row.before_revision === undefined
      ? {}
      : { before_revision: row.before_revision as number }),
  };
}

/** A historical projection, never a save receipt or evidence of current pack validity. */
export function parseCheckpointHistoryEntry(
  value: unknown,
  sessionId: string,
): CheckpointHistoryEntry {
  const row = object(value);
  if (
    !isUlid(sessionId) ||
    row.session_id !== sessionId ||
    !isUlid(row.checkpoint_id) ||
    !positive(row.revision) ||
    !text(row.trace_id) ||
    typeof row.created_at !== 'string' ||
    row.created_at.length > 128 ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    (row.context_pack_hash !== undefined && !text(row.context_pack_hash)) ||
    (row.context_pack_id !== undefined &&
      (!isUlid(row.context_pack_id) ||
        typeof row.context_pack_hash !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(row.context_pack_hash)))
  )
    throw new TypeError('Invalid checkpoint history entry');
  const notes = {} as CheckpointContent;
  for (const field of checkpointNoteFields) {
    const values = row[field];
    if (
      !Array.isArray(values) ||
      Object.keys(values).length !== values.length ||
      Array.from(values).some((note) => typeof note !== 'string')
    )
      throw new TypeError('Invalid historical checkpoint notes');
    notes[field] = [...values] as string[];
  }
  return {
    checkpoint_id: row.checkpoint_id,
    session_id: sessionId,
    revision: row.revision as number,
    created_at: new Date(row.created_at).toISOString(),
    trace_id: row.trace_id as string,
    ...notes,
    ...(typeof row.context_pack_id === 'string' ? { context_pack_id: row.context_pack_id } : {}),
    ...(typeof row.context_pack_hash === 'string'
      ? { context_pack_hash: row.context_pack_hash }
      : {}),
  };
}

export function parseCheckpointHistoryPage(
  value: unknown,
  query: CheckpointHistoryQuery,
  trace: string,
) {
  query = parseCheckpointHistoryQuery(query);
  assertCheckpointReadBytes(value, CHECKPOINT_HISTORY_RESPONSE_BYTES);
  const row = object(value);
  if (
    row.schema_version !== 1 ||
    !trace.trim() ||
    row.trace_id !== trace ||
    row.etag !== undefined ||
    row.session_id !== query.session_id ||
    !Array.isArray(row.data) ||
    row.data.length > CHECKPOINT_HISTORY_PAGE_SIZE ||
    Object.keys(row.data).length !== row.data.length ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== 1
  )
    throw new TypeError('Invalid checkpoint history page');
  const source = object(row.source_refs[0]);
  if (
    source.type !== 'postgres' ||
    source.id !== 'wcp_session_checkpoints' ||
    Object.keys(source).some((key) => !['type', 'id'].includes(key))
  )
    throw new TypeError('Invalid checkpoint history source');
  const seen = new Set<string>();
  let upper = query.before_revision;
  const data = Array.from(row.data, (entry: unknown) => {
    const checkpoint = parseCheckpointHistoryEntry(entry, query.session_id);
    if (seen.has(checkpoint.checkpoint_id) || (upper !== undefined && checkpoint.revision >= upper))
      throw new TypeError('Checkpoint history order or cursor differs');
    seen.add(checkpoint.checkpoint_id);
    upper = checkpoint.revision;
    return checkpoint;
  });
  const next = row.next_before_revision;
  if (
    next !== undefined &&
    (!positive(next) ||
      data.length !== CHECKPOINT_HISTORY_PAGE_SIZE ||
      next !== data.at(-1)?.revision ||
      (next as number) <= 1)
  )
    throw new TypeError('Invalid next checkpoint history cursor');
  return {
    schema_version: 1 as const,
    session_id: query.session_id,
    data,
    trace_id: trace,
    source_refs: [{ type: 'postgres', id: 'wcp_session_checkpoints' }],
    ...(next === undefined ? {} : { next_before_revision: next as number }),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected checkpoint history object');
  return value as Record<string, unknown>;
}

/** Public session history also binds the response to the requested project scope. */
export function parseCheckpointHistoryEnvelope(
  value: unknown,
  query: CheckpointHistoryQuery,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
) {
  const row = object(value);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!text(scope[field]) || row[field] !== scope[field])
      throw new TypeError('Checkpoint history scope differs');
  return {
    ...parseCheckpointHistoryPage(value, query, trace),
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id!,
  };
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Keep workbench permission hints while validating every historical note and cursor. */
export function parseCheckpointHistoryWorkbenchEnvelope(
  value: unknown,
  query: CheckpointHistoryQuery,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
) {
  const page = parseCheckpointHistoryPage(value, query, trace);
  const row = object(value);
  const permissions = object(row.session_permissions);
  const identity =
    row.session_identity === undefined
      ? undefined
      : parseSessionCommandIdentity(row.session_identity);
  if (
    Object.keys(permissions).some((key) => key !== 'write_sessions') ||
    typeof permissions.write_sessions !== 'boolean' ||
    (permissions.write_sessions && !identity)
  )
    throw new TypeError('Invalid checkpoint history permissions');
  if (identity)
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (!text(scope[field]) || identity[field] !== scope[field])
        throw new TypeError('Checkpoint history reader scope differs');
  return {
    ...page,
    session_permissions: { write_sessions: permissions.write_sessions },
    ...(identity === undefined ? {} : { session_identity: identity }),
  };
}
function text(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim();
}
