import {
  ContractError,
  isUlid,
  parseResumeReceiptQuery,
  parseSessionResumeOrigin,
  type ResumeReceiptLookup,
} from '@planemem/contracts';
import type { CommandRouter } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { visibleSessionProject } from './session-project-access.js';

export function registerResumeReceipts(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('session.resume.receipt', async ({ context, input }) => {
    if (context.authenticated_client !== true)
      throw new ContractError('DENIED', 'An authenticated client is required', {
        trace_id: context.trace_id,
      });
    const parentId = input.session_id;
    if (!isUlid(parentId))
      throw new ContractError('INVALID_INPUT', 'session_id must be a ULID', {
        trace_id: context.trace_id,
      });
    let query;
    try {
      const { session_id: _parent, ...body } = input;
      query = parseResumeReceiptQuery(body);
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid resume query',
        { trace_id: context.trace_id },
      );
    }
    // Same effective ownership requirement as the original workbench resume command.
    if (context.client_id === (process.env.AUTH_SERVER_CLIENT_ID ?? 'PlaneMem_WebConsole'))
      query.require_claimed = true;
    if (!db) throw unavailable(context.trace_id);
    let row;
    try {
      [row] = await db<
        { session_id: string | null; parent_session_id: string | null; resume_origin: unknown }[]
      >`
        SELECT child.session_id, child.parent_session_id, child.resume_origin FROM wcp_sessions parent
        LEFT JOIN wcp_sessions child ON child.tenant_id = parent.tenant_id AND child.workspace_id = parent.workspace_id
          AND child.project_id = parent.project_id AND child.actor_id = ${context.actor_id}
          AND child.client_id = ${context.client_id} AND child.idempotency_key = ${query.request_key}
        WHERE parent.session_id = ${parentId} AND parent.tenant_id = ${context.tenant_id}
          AND parent.workspace_id = ${context.workspace_id} AND parent.project_id = ${context.project_id}
          AND ${visibleSessionProject(db, context, context.capability.includes('data.restricted.read'))}`;
    } catch {
      throw unavailable(context.trace_id);
    }
    if (!row)
      throw new ContractError(
        'SESSION_NOT_FOUND',
        'Parent session is unavailable in this project',
        { trace_id: context.trace_id },
      );
    const recorded = row.session_id !== null;
    const conflict = () =>
      new ContractError('IDEMPOTENCY_KEY_REUSED', 'Key belongs to another session request', {
        trace_id: context.trace_id,
      });
    if (recorded && row.parent_session_id !== parentId) throw conflict();
    let data: ResumeReceiptLookup = {
      status: 'not-observed',
      parent_session_id: parentId,
      handoff_id: query.handoff_id,
    };
    if (recorded) {
      if (row.resume_origin == null) data = { ...data, status: 'legacy-unverified' };
      else {
        let origin;
        try {
          origin = parseSessionResumeOrigin(row.resume_origin);
          if (!isUlid(row.session_id)) throw new TypeError();
        } catch {
          throw new ContractError('SESSION_RECEIPT_INVALID', 'Stored resume origin is invalid', {
            trace_id: context.trace_id,
          });
        }
        if (
          origin.handoff_id !== query.handoff_id ||
          origin.require_claimed !== query.require_claimed
        )
          throw conflict();
        data = {
          status: 'recorded',
          parent_session_id: parentId,
          session_id: row.session_id,
          handoff_id: origin.handoff_id,
          checkpoint_id: origin.checkpoint_id,
          require_claimed: origin.require_claimed,
          context_pack_state: 'not-checked',
        };
      }
    }
    return { schema_version: 1 as const, trace_id: context.trace_id, source_refs: [], data };
  });
}

function unavailable(trace_id: string) {
  return new ContractError(
    'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
    'Session receipt storage is unavailable',
    { trace_id, retryable: true },
  );
}
