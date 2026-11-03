import {
  ContractError,
  parseSessionStartReceiptQuery,
  parseSessionStartReceiptLookup,
  assertSessionStartIdentity,
  assertSessionStartCurrent,
  type SessionStartReceiptLookup,
} from '@planemem/contracts';
import { commandReceipt } from './http.js';
import type { CommandRouter } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';

export function registerSessionStartReceipts(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('session.start.receipt', async (request) => {
    const { context, input } = request;
    if (context.authenticated_client !== true)
      throw new ContractError('DENIED', 'A verified client is required', {
        trace_id: context.trace_id,
      });
    let query;
    try {
      if (
        context.idempotency_key !== undefined ||
        context.expected_version !== undefined ||
        !context.project_id
      )
        throw new TypeError('Supply the original start request without write options');
      query = parseSessionStartReceiptQuery(input);
      assertSessionStartIdentity(query.session, context);
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid original start',
        { trace_id: context.trace_id },
      );
    }
    const binding = commandReceipt(
      { operation: 'session.start', context, input: { ...query.session } },
      query.request_key,
    );
    if (!db) throw unavailable(context.trace_id);
    try {
      // One snapshot checks project visibility, the original parent and the current created session.
      const [row] = await db<Record<string, unknown>[]>`SELECT r.session_id AS receipt_session_id,
        r.request_fingerprint, r.response_document, s.session_id, s.tenant_id, s.workspace_id, s.project_id,
        s.actor_id, s.client_id, s.parent_session_id, s.resume_origin, s.status, s.version,
        s.started_at::text AS started_at, s.ended_at::text AS ended_at, s.trace_id, s.source_refs, s.idempotency_key
        FROM wcp_projects p
        LEFT JOIN wcp_session_start_commands r ON r.tenant_id = p.tenant_id AND r.workspace_id = p.workspace_id
          AND r.project_id = p.id AND r.request_key = ${binding.key}
        LEFT JOIN wcp_sessions s ON s.session_id = r.session_id AND s.tenant_id = r.tenant_id
          AND s.workspace_id = r.workspace_id AND s.project_id = r.project_id
        WHERE p.id = ${context.project_id} AND p.tenant_id = ${context.tenant_id} AND p.workspace_id = ${context.workspace_id}
          AND p.deleted_at IS NULL AND p.classification IN ('public', 'internal', 'confidential', 'restricted')
          AND (${context.capability.includes('data.restricted.read')} OR p.classification <> 'restricted')
          AND (${query.session.parent_session_id ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM wcp_sessions parent WHERE parent.session_id = ${query.session.parent_session_id ?? null}
              AND parent.tenant_id = p.tenant_id AND parent.workspace_id = p.workspace_id AND parent.project_id = p.id))`;
      if (!row)
        throw new ContractError('DENIED', 'Original start project or parent is unavailable', {
          trace_id: context.trace_id,
        });
      let data: SessionStartReceiptLookup = { status: 'not-observed' };
      if (row.receipt_session_id !== null) {
        if (row.request_fingerprint !== binding.fingerprint)
          throw new ContractError(
            'IDEMPOTENCY_KEY_REUSED',
            'Key belongs to another session start',
            { trace_id: context.trace_id },
          );
        data = parseSessionStartReceiptLookup(row.response_document, query.session, context);
        if (
          data.status !== 'recorded' ||
          data.session_id !== row.receipt_session_id ||
          row.idempotency_key !== query.request_key ||
          !context.project_id
        )
          throw new TypeError();
        if (
          typeof row.started_at !== 'string' ||
          (row.ended_at !== null && typeof row.ended_at !== 'string')
        )
          throw new TypeError();
        assertSessionStartCurrent(
          {
            ...row,
            schema_version: 1,
            version: Number(row.version),
            parent_session_id: row.parent_session_id ?? undefined,
            resume_origin: row.resume_origin ?? undefined,
            started_at: new Date(row.started_at).toISOString(),
            ended_at:
              row.ended_at === null ? undefined : new Date(row.ended_at as string).toISOString(),
          },
          data,
          { ...context, project_id: context.project_id },
        );
      }
      return { schema_version: 1 as const, trace_id: context.trace_id, source_refs: [], data };
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError)
        throw new ContractError(
          'SESSION_RECEIPT_INVALID',
          'Stored session start receipt is invalid',
          { trace_id: context.trace_id },
        );
      throw unavailable(context.trace_id);
    }
  });
}
function unavailable(trace_id: string) {
  return new ContractError(
    'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
    'Session start receipt storage is unavailable',
    { trace_id, retryable: true },
  );
}
