import { isUlid } from './ids.js';
import {
  assertCheckpointReadBytes,
  CHECKPOINT_DETAIL_RESPONSE_BYTES,
} from './checkpoint-read-limits.js';
import { parseCheckpointRecord } from './checkpoint-clients.js';

export interface CheckpointReadQuery {
  session_id: string;
  checkpoint_id: string;
}
export function parseCheckpointReadQuery(value: unknown): CheckpointReadQuery {
  const row = object(value);
  if (
    !isUlid(row.session_id) ||
    !isUlid(row.checkpoint_id) ||
    Object.keys(row).some((key) => !['session_id', 'checkpoint_id'].includes(key))
  )
    throw new TypeError('Supply only session_id and checkpoint_id as ULIDs');
  return { session_id: row.session_id, checkpoint_id: row.checkpoint_id };
}

/** Historical content read, not a receipt for a request key or evidence of current pack validity. */
export function parseCheckpointReadEnvelope(
  value: unknown,
  query: CheckpointReadQuery,
  scope: { tenant_id: string; workspace_id: string; project_id?: string },
  trace: string,
) {
  query = parseCheckpointReadQuery(query);
  assertCheckpointReadBytes(value, CHECKPOINT_DETAIL_RESPONSE_BYTES);
  const row = object(value);
  if (
    row.schema_version !== 1 ||
    !trace.trim() ||
    row.trace_id !== trace ||
    row.etag !== undefined ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== 1 ||
    !scope.project_id
  )
    throw new TypeError('Invalid checkpoint detail envelope');
  const source = object(row.source_refs[0]);
  if (
    source.type !== 'checkpoint' ||
    source.id !== query.checkpoint_id ||
    Object.keys(source).some((field) => !['type', 'id'].includes(field))
  )
    throw new TypeError('Checkpoint detail source differs');
  const data = object(row.data);
  if (
    Object.keys(data).some(
      (field) => !['checkpoint', 'created_at', 'context_pack_state'].includes(field),
    ) ||
    data.context_pack_state !== 'not-checked' ||
    typeof data.created_at !== 'string' ||
    data.created_at.length > 128 ||
    !Number.isFinite(Date.parse(data.created_at))
  )
    throw new TypeError('Invalid checkpoint detail metadata');
  const checkpoint = parseCheckpointRecord(data.checkpoint, query.session_id, {
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id,
  });
  if (checkpoint.checkpoint_id !== query.checkpoint_id)
    throw new TypeError('Checkpoint detail target differs');
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [{ type: 'checkpoint', id: query.checkpoint_id }],
    data: {
      checkpoint,
      created_at: new Date(data.created_at).toISOString(),
      context_pack_state: 'not-checked' as const,
    },
  };
}
export type CheckpointReadDetail = ReturnType<typeof parseCheckpointReadEnvelope>['data'];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected checkpoint detail data');
  return value as Record<string, unknown>;
}
