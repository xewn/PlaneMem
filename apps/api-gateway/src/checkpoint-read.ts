import {
  ContractError,
  parseCheckpointReadQuery,
  parseCheckpointReadEnvelope,
  CHECKPOINT_DETAIL_RESPONSE_BYTES,
  CHECKPOINT_READ_METADATA_BYTES,
  CheckpointReadLimitError,
  assertCheckpointReadBytes,
} from '@planemem/contracts';
import type { CommandRouter } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { visibleSessionProject } from './session-project-access.js';

export function registerCheckpointRead(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('session.checkpoint.read', async (request) => {
    const { tenant_id, workspace_id, project_id, trace_id } = request.context;
    let query;
    try {
      query = parseCheckpointReadQuery(request.input);
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Supply only session_id and checkpoint_id as ULIDs',
        { trace_id },
      );
    }
    if (!db) throw unavailable(trace_id);
    try {
      const maximum = CHECKPOINT_DETAIL_RESPONSE_BYTES - CHECKPOINT_READ_METADATA_BYTES;
      const [result] = await db<Record<string, unknown>[]>`
        SELECT c.checkpoint_id,
          COALESCE(octet_length(c.payload::text) > ${maximum}, false) AS oversized,
          CASE WHEN octet_length(c.payload::text) <= ${maximum} THEN c.payload ELSE NULL END AS payload
        FROM wcp_sessions s LEFT JOIN LATERAL (
          SELECT c.checkpoint_id, jsonb_build_object(
            'checkpoint_id', c.checkpoint_id, 'session_id', c.session_id,
            'revision', c.revision::text, 'created_at', c.created_at,
            'completed', c.completed, 'in_progress', c.in_progress, 'next_actions', c.next_actions,
            'decisions', c.decisions, 'risks', c.risks, 'open_questions', c.open_questions,
            'state_hash', c.state_hash, 'context_pack_id', c.context_pack_id,
            'context_pack_hash', c.context_pack_hash, 'memory_ref', c.memory_ref,
            'trace_id', c.trace_id, 'source_refs', c.source_refs) AS payload
          FROM wcp_session_checkpoints c WHERE c.session_id = s.session_id
            AND c.checkpoint_id = ${query.checkpoint_id} AND c.tenant_id = s.tenant_id
            AND c.workspace_id = s.workspace_id AND c.project_id = s.project_id
        ) c ON true
        WHERE s.session_id = ${query.session_id} AND s.tenant_id = ${tenant_id}
          AND s.workspace_id = ${workspace_id} AND s.project_id = ${project_id}
          AND ${visibleSessionProject(db, request.context, request.context.capability.includes('data.restricted.read'))}`;
      if (!result)
        throw new ContractError('SESSION_NOT_FOUND', 'Session is unavailable in this project', {
          trace_id,
        });
      if (result.checkpoint_id == null)
        throw new ContractError(
          'CHECKPOINT_NOT_FOUND',
          'Checkpoint does not exist in this session',
          { trace_id },
        );
      if (result.oversized === true) throw new CheckpointReadLimitError();
      if (result.oversized !== false) throw new TypeError();
      const payload = json(result.payload);
      assertCheckpointReadBytes(payload, maximum);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError();
      const row = payload as Record<string, unknown>;
      if (
        typeof row.revision !== 'string' ||
        !/^[1-9][0-9]*$/.test(row.revision) ||
        !Number.isSafeInteger(Number(row.revision))
      )
        throw new TypeError();
      return parseCheckpointReadEnvelope(
        {
          schema_version: 1,
          trace_id,
          source_refs: [{ type: 'checkpoint', id: query.checkpoint_id }],
          data: {
            created_at:
              row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
            context_pack_state: 'not-checked',
            checkpoint: {
              schema_version: 1,
              tenant_id,
              workspace_id,
              project_id,
              checkpoint_id: row.checkpoint_id,
              session_id: row.session_id,
              revision: Number(row.revision),
              state_hash: row.state_hash,
              completed: json(row.completed),
              in_progress: json(row.in_progress),
              next_actions: json(row.next_actions),
              decisions: json(row.decisions),
              risks: json(row.risks),
              open_questions: json(row.open_questions),
              trace_id: row.trace_id,
              source_refs: json(row.source_refs),
              ...(row.context_pack_id == null ? {} : { context_pack_id: row.context_pack_id }),
              ...(row.context_pack_hash == null
                ? {}
                : { context_pack_hash: row.context_pack_hash }),
              ...(row.memory_ref == null ? {} : { memory_ref: json(row.memory_ref) }),
            },
          },
        },
        query,
        request.context,
        trace_id,
      );
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof CheckpointReadLimitError)
        throw new ContractError(
          'CHECKPOINT_READ_TOO_LARGE',
          'Checkpoint content exceeds the complete read limit; no partial content was returned',
          { trace_id },
        );
      if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError)
        throw new ContractError('SESSION_ACTIVITY_INVALID', 'Stored checkpoint detail is invalid', {
          trace_id,
        });
      throw unavailable(trace_id);
    }
  });
}
function json(value: unknown): unknown {
  if (
    typeof value === 'string' &&
    new TextEncoder().encode(value).byteLength > CHECKPOINT_DETAIL_RESPONSE_BYTES
  )
    throw new CheckpointReadLimitError();
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function unavailable(trace_id: string) {
  return new ContractError(
    'SESSION_STORAGE_UNAVAILABLE',
    'Checkpoint detail storage is unavailable',
    { trace_id, retryable: true },
  );
}
