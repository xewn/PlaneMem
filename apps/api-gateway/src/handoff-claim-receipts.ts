import {
  ContractError,
  isUlid,
  parseHandoffClaimReceiptQuery,
  parseHandoffClaimReceiptLookup,
  type HandoffClaimReceiptLookup,
} from '@planemem/contracts';
import { commandReceipt } from './http.js';
import type { CommandRouter } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';

export function registerHandoffClaimReceipts(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('session.handoff.claim.receipt', async (request) => {
    const { context, input } = request;
    if (context.authenticated_client !== true)
      throw new ContractError('DENIED', 'A verified client is required', {
        trace_id: context.trace_id,
      });
    const handoffId = input.handoff_id;
    let query;
    try {
      if (!isUlid(handoffId)) throw new TypeError('handoff_id must be a ULID');
      const { handoff_id: _id, ...fields } = input;
      query = parseHandoffClaimReceiptQuery(fields);
      if (
        (query.claim.handoff_id !== undefined && query.claim.handoff_id !== handoffId) ||
        (query.claim.client_id !== undefined && query.claim.client_id !== context.client_id)
      )
        throw new TypeError('Original claim belongs to another handoff or client');
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid original claim',
        { trace_id: context.trace_id },
      );
    }
    const binding = commandReceipt(
      {
        operation: 'session.handoff.claim',
        context: { ...context, expected_version: query.claim.expected_version },
        input: { ...query.claim, handoff_id: handoffId },
      },
      query.request_key,
    );
    if (!db) throw unavailable(context.trace_id);
    try {
      const [row] = await db<Record<string, unknown>[]>`SELECT h.checkpoint_id, h.version, h.status,
        h.claimed_by, h.claimed_by_actor, c.session_id, r.handoff_id AS receipt_handoff_id,
        r.request_fingerprint, r.response_document
        FROM wcp_session_handoffs h
        JOIN wcp_session_checkpoints c ON c.checkpoint_id = h.checkpoint_id AND c.tenant_id = h.tenant_id
          AND c.workspace_id = h.workspace_id AND c.project_id = h.project_id
        JOIN wcp_sessions s ON s.session_id = c.session_id AND s.tenant_id = c.tenant_id
          AND s.workspace_id = c.workspace_id AND s.project_id = c.project_id
        JOIN wcp_projects p ON p.id = h.project_id AND p.tenant_id = h.tenant_id AND p.workspace_id = h.workspace_id
        LEFT JOIN wcp_handoff_claim_commands r ON r.tenant_id = h.tenant_id AND r.workspace_id = h.workspace_id
          AND r.project_id = h.project_id AND r.request_key = ${binding.key}
        WHERE h.handoff_id = ${handoffId as string} AND h.tenant_id = ${context.tenant_id}
          AND h.workspace_id = ${context.workspace_id} AND h.project_id = ${context.project_id}
          AND p.deleted_at IS NULL AND p.classification IN ('public', 'internal', 'confidential', 'restricted')
          AND (${context.capability.includes('data.restricted.read')} OR p.classification <> 'restricted')`;
      if (!row)
        throw new ContractError('HANDOFF_NOT_FOUND', 'Handoff is unavailable in this project', {
          trace_id: context.trace_id,
        });
      let data: HandoffClaimReceiptLookup = {
        status: 'not-observed',
        handoff_id: handoffId as string,
      };
      if (row.receipt_handoff_id !== null) {
        if (row.receipt_handoff_id !== handoffId || row.request_fingerprint !== binding.fingerprint)
          throw new ContractError(
            'IDEMPOTENCY_KEY_REUSED',
            'Key belongs to another handoff claim',
            { trace_id: context.trace_id },
          );
        data = parseHandoffClaimReceiptLookup(
          row.response_document,
          handoffId as string,
          query.claim.expected_version,
          context,
        );
        if (
          data.status !== 'recorded' ||
          data.session_id !== row.session_id ||
          data.checkpoint_id !== row.checkpoint_id ||
          !Number.isSafeInteger(Number(row.version)) ||
          Number(row.version) < data.handoff_version ||
          (Number(row.version) === data.handoff_version && row.status !== 'claimed') ||
          !['claimed', 'expired'].includes(String(row.status)) ||
          row.claimed_by !== data.claimed_by ||
          row.claimed_by_actor !== data.claimed_by_actor
        )
          throw new TypeError('Current handoff does not match its claim receipt');
      }
      return { schema_version: 1 as const, trace_id: context.trace_id, source_refs: [], data };
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError)
        throw new ContractError(
          'SESSION_RECEIPT_INVALID',
          'Stored handoff claim receipt is invalid',
          { trace_id: context.trace_id },
        );
      throw unavailable(context.trace_id);
    }
  });
}
function unavailable(trace_id: string) {
  return new ContractError(
    'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
    'Handoff claim receipt storage is unavailable',
    { trace_id, retryable: true },
  );
}
