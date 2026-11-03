import {
  ContractError,
  isUlid,
  parseHandoffCreateReceiptQuery,
  parseHandoffCreateReceiptLookup,
  assertHandoffCreationCurrent,
  type HandoffCreateReceiptLookup,
} from '@planemem/contracts';
import { commandReceipt } from './http.js';
import type { CommandRouter } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';

export function registerHandoffCreateReceipts(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('session.handoff.receipt', async (request) => {
    const { context, input } = request;
    if (context.authenticated_client !== true)
      throw new ContractError('DENIED', 'A verified client is required', {
        trace_id: context.trace_id,
      });
    const sessionId = input.session_id;
    let query;
    try {
      if (
        !isUlid(sessionId) ||
        context.idempotency_key !== undefined ||
        context.expected_version !== undefined
      )
        throw new TypeError('Supply the original session and request_key without write options');
      const { session_id: _session, ...fields } = input;
      query = parseHandoffCreateReceiptQuery(fields);
      if (
        (query.handoff.session_id !== undefined && query.handoff.session_id !== sessionId) ||
        (query.handoff.from_client !== undefined && query.handoff.from_client !== context.client_id)
      )
        throw new TypeError('Original handoff belongs to another session or client');
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid original handoff',
        { trace_id: context.trace_id },
      );
    }
    const binding = commandReceipt(
      { operation: 'session.handoff', context, input: { ...query.handoff, session_id: sessionId } },
      query.request_key,
    );
    if (!db) throw unavailable(context.trace_id);
    try {
      const [row] = await db<Record<string, unknown>[]>`SELECT
        r.handoff_id AS receipt_handoff_id, r.session_id AS receipt_session_id,
        r.checkpoint_id AS receipt_checkpoint_id, r.request_fingerprint, r.response_document,
        h.handoff_id, h.checkpoint_id, h.tenant_id, h.workspace_id, h.project_id,
        h.from_client, h.target_client, h.status, h.version, h.trace_id, h.source_refs,
        h.claimed_by, h.claimed_by_actor, h.idempotency_key
        FROM wcp_session_checkpoints c
        JOIN wcp_sessions s ON s.session_id = c.session_id AND s.tenant_id = c.tenant_id
          AND s.workspace_id = c.workspace_id AND s.project_id = c.project_id
        JOIN wcp_projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id AND p.workspace_id = c.workspace_id
        LEFT JOIN wcp_handoff_create_commands r ON r.tenant_id = c.tenant_id AND r.workspace_id = c.workspace_id
          AND r.project_id = c.project_id AND r.request_key = ${binding.key}
        LEFT JOIN wcp_session_handoffs h ON h.handoff_id = r.handoff_id AND h.tenant_id = r.tenant_id
          AND h.workspace_id = r.workspace_id AND h.project_id = r.project_id
        WHERE c.checkpoint_id = ${query.handoff.checkpoint_id} AND c.session_id = ${sessionId as string}
          AND c.tenant_id = ${context.tenant_id} AND c.workspace_id = ${context.workspace_id} AND c.project_id = ${context.project_id}
          AND p.deleted_at IS NULL AND p.classification IN ('public', 'internal', 'confidential', 'restricted')
          AND (${context.capability.includes('data.restricted.read')} OR p.classification <> 'restricted')`;
      if (!row)
        throw new ContractError(
          'CHECKPOINT_NOT_FOUND',
          'Checkpoint is unavailable in this session',
          { trace_id: context.trace_id },
        );
      let data: HandoffCreateReceiptLookup = {
        status: 'not-observed',
        session_id: sessionId as string,
        checkpoint_id: query.handoff.checkpoint_id,
      };
      if (row.receipt_handoff_id !== null) {
        if (
          row.request_fingerprint !== binding.fingerprint ||
          row.receipt_session_id !== sessionId ||
          row.receipt_checkpoint_id !== query.handoff.checkpoint_id
        )
          throw new ContractError(
            'IDEMPOTENCY_KEY_REUSED',
            'Key belongs to another handoff creation',
            { trace_id: context.trace_id },
          );
        data = parseHandoffCreateReceiptLookup(
          row.response_document,
          sessionId as string,
          query.handoff,
          context,
        );
        if (
          data.status !== 'recorded' ||
          data.handoff_id !== row.receipt_handoff_id ||
          row.idempotency_key !== query.request_key ||
          !context.project_id
        )
          throw new TypeError();
        assertHandoffCreationCurrent(
          {
            ...row,
            schema_version: 1,
            version: Number(row.version),
            target_client: row.target_client ?? undefined,
            claimed_by: row.claimed_by ?? undefined,
            claimed_by_actor: row.claimed_by_actor ?? undefined,
          },
          data,
          { ...context, project_id: context.project_id },
        );
      }
      return { schema_version: 1 as const, trace_id: context.trace_id, source_refs: [], data };
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError)
        throw new ContractError(
          'SESSION_RECEIPT_INVALID',
          'Stored handoff creation receipt is invalid',
          { trace_id: context.trace_id },
        );
      throw unavailable(context.trace_id);
    }
  });
}
function unavailable(trace_id: string) {
  return new ContractError(
    'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
    'Handoff creation receipt storage is unavailable',
    { trace_id, retryable: true },
  );
}
