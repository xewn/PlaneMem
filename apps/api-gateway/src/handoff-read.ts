import {
  ContractError,
  parseHandoffReadQuery,
  parseHandoffReadEnvelope,
  parseSessionCommandIdentity,
} from '@planemem/contracts';
import type { CommandRouter } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { visibleSessionProject } from './session-project-access.js';

export function registerHandoffRead(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('session.handoff.read', async (request) => {
    const { context } = request;
    const { tenant_id, workspace_id, project_id, trace_id } = context;
    let handoffId: string;
    try {
      handoffId = parseHandoffReadQuery(request.input).handoff_id;
    } catch {
      throw new ContractError('INVALID_INPUT', 'Supply only handoff_id as a ULID', { trace_id });
    }
    if (!db) throw unavailable(trace_id);
    try {
      const [row] = await db<Record<string, unknown>[]>`
        SELECT h.handoff_id, c.session_id, h.checkpoint_id, h.from_client, h.target_client,
          h.status, h.claimed_by, h.claimed_by_actor, h.version, h.created_at, h.updated_at,
          h.trace_id, h.source_refs
        FROM wcp_session_handoffs h
        JOIN wcp_session_checkpoints c ON c.checkpoint_id = h.checkpoint_id
          AND c.tenant_id = h.tenant_id AND c.workspace_id = h.workspace_id AND c.project_id = h.project_id
        JOIN wcp_sessions s ON s.session_id = c.session_id
          AND s.tenant_id = c.tenant_id AND s.workspace_id = c.workspace_id AND s.project_id = c.project_id
        WHERE h.handoff_id = ${handoffId} AND h.tenant_id = ${tenant_id}
          AND h.workspace_id = ${workspace_id} AND h.project_id = ${project_id}
          AND ${visibleSessionProject(db, context, context.capability.includes('data.restricted.read'))}`;
      if (!row)
        throw new ContractError('HANDOFF_NOT_FOUND', 'Handoff is unavailable in this project', {
          trace_id,
        });
      const identity =
        context.authenticated_client === true
          ? parseSessionCommandIdentity({
              tenant_id,
              workspace_id,
              project_id,
              actor_id: context.actor_id,
              client_id: context.client_id,
            })
          : undefined;
      const write =
        !!identity &&
        (context.roles?.includes('admin') === true || context.capability.includes('session.write'));
      return parseHandoffReadEnvelope(
        {
          schema_version: 1,
          trace_id,
          source_refs: [{ type: 'handoff', id: handoffId }],
          ...(identity ? { session_identity: identity } : {}),
          handoff_permissions: {
            write_sessions: write,
            claim: write || (!!identity && context.capability.includes('handoff.claim')),
          },
          data: {
            schema_version: 1,
            tenant_id,
            workspace_id,
            project_id,
            handoff_id: row.handoff_id,
            session_id: row.session_id,
            checkpoint_id: row.checkpoint_id,
            from_client: row.from_client,
            status: row.status,
            version: Number(row.version),
            created_at: timestamp(row.created_at),
            updated_at: timestamp(row.updated_at),
            trace_id: row.trace_id,
            source_refs:
              typeof row.source_refs === 'string' ? JSON.parse(row.source_refs) : row.source_refs,
            ...(row.target_client == null ? {} : { target_client: row.target_client }),
            ...(row.claimed_by == null ? {} : { claimed_by: row.claimed_by }),
            ...(row.claimed_by_actor == null ? {} : { claimed_by_actor: row.claimed_by_actor }),
          },
        },
        handoffId,
        context,
        trace_id,
      );
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError)
        throw new ContractError('SESSION_ACTIVITY_INVALID', 'Stored handoff detail is invalid', {
          trace_id,
        });
      throw unavailable(trace_id);
    }
  });
}
function timestamp(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}
function unavailable(trace_id: string) {
  return new ContractError('SESSION_STORAGE_UNAVAILABLE', 'Handoff detail storage is unavailable', {
    trace_id,
    retryable: true,
  });
}
