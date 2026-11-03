import {
  ContractError,
  parseConflictReadQuery,
  parseConflictReadEnvelope,
  CONFLICT_READ_RESPONSE_BYTES,
  CONFLICT_READ_METADATA_BYTES,
  ConflictReadLimitError,
  assertConflictReadBytes,
} from '@planemem/contracts';
import type { CommandRouter } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { visibleConflicts } from './workbench/repository.js';

export function registerConflictRead(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('conflict.read', async ({ input, context }) => {
    const { tenant_id, workspace_id, project_id, trace_id } = context;
    let query;
    try {
      if (context.idempotency_key !== undefined || context.expected_version !== undefined)
        throw new TypeError();
      query = parseConflictReadQuery(input);
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Supply only a conflict identifier, without write conditions',
        { trace_id },
      );
    }
    if (!db) throw unavailable(trace_id);
    try {
      const maximum = CONFLICT_READ_RESPONSE_BYTES - CONFLICT_READ_METADATA_BYTES;
      const [row] = await db<Record<string, unknown>[]>`
        WITH detail AS MATERIALIZED (
          SELECT jsonb_build_object(
            'conflict_id', c.conflict_id, 'entity_type', c.entity_type, 'entity_id', c.entity_id, 'field', c.field,
            'base_version', c.base_version::text, 'local_version', c.local_version::text,
            'server_version', c.server_version::text, 'version', c.version::text,
            'local_value_json', c.local_value::text, 'local_value_state', CASE WHEN c.local_value IS NULL THEN 'not-recorded' ELSE 'recorded' END,
            'server_value_json', c.server_value::text, 'server_value_state', CASE WHEN c.server_value IS NULL THEN 'not-recorded' ELSE 'recorded' END,
            'status', c.status, 'decision_state', CASE WHEN c.status = 'open' THEN 'none' WHEN c.resolution_event_id IS NULL THEN 'legacy' ELSE 'recorded' END,
            'resolution', c.resolution, 'resolved_value_json', c.resolved_value::text,
            'resolved_value_state', CASE WHEN c.resolved_value IS NULL THEN 'not-recorded' ELSE 'recorded' END,
            'actor_id', c.actor_id, 'resolved_at', c.resolved_at, 'resolved_by_client', c.resolved_by_client,
            'resolution_event_id', c.resolution_event_id, 'trace_id', c.trace_id, 'source_refs', c.source_refs
          ) AS payload FROM wcp_conflicts c
          WHERE c.conflict_id = ${query.conflict_id} AND c.tenant_id = ${tenant_id}
            AND c.workspace_id = ${workspace_id} AND c.project_id = ${project_id}
            AND EXISTS (SELECT 1 FROM wcp_projects p WHERE p.tenant_id = c.tenant_id AND p.workspace_id = c.workspace_id
              AND p.id = c.project_id AND p.deleted_at IS NULL AND p.classification IN ('public', 'internal', 'confidential', 'restricted')
              AND (p.classification <> 'restricted' OR ${context.capability.includes('data.restricted.read')}))
            ${db.unsafe(visibleConflicts({ ...context, read_restricted: context.capability.includes('data.restricted.read') }))}
        ) SELECT octet_length(payload::text) > ${maximum} AS oversized,
            CASE WHEN octet_length(payload::text) <= ${maximum} THEN payload ELSE NULL END AS payload FROM detail`;
      if (!row)
        throw new ContractError('CONFLICT_NOT_FOUND', 'Conflict is unavailable in this project', {
          trace_id,
        });
      if (row.oversized === true) throw new ConflictReadLimitError();
      if (row.oversized !== false) throw new TypeError();
      if (
        typeof row.payload === 'string' &&
        new TextEncoder().encode(row.payload).byteLength > maximum
      )
        throw new ConflictReadLimitError();
      const data: unknown = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      assertConflictReadBytes(data, maximum);
      const scope = { tenant_id, workspace_id, project_id };
      return parseConflictReadEnvelope(
        {
          schema_version: 1,
          scope,
          trace_id,
          source_refs: [{ type: 'conflict', id: query.conflict_id }],
          data,
        },
        query,
        scope,
        trace_id,
      );
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof ConflictReadLimitError)
        throw new ContractError(
          'CONFLICT_READ_TOO_LARGE',
          'Complete conflict detail exceeds the read limit; no partial values were returned',
          { trace_id },
        );
      if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError)
        throw new ContractError(
          'CONFLICT_READ_INVALID',
          'Stored conflict detail could not be validated',
          { trace_id },
        );
      throw unavailable(trace_id);
    }
  });
}
function unavailable(trace_id: string) {
  return new ContractError(
    'CONFLICT_STORAGE_UNAVAILABLE',
    'Conflict detail storage is unavailable',
    { trace_id, retryable: true },
  );
}
