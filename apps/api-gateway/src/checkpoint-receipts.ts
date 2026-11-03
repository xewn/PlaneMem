import {
  ContractError,
  isUlid,
  parseCheckpointReceiptQuery,
  type CheckpointReceiptLookup,
} from '@planemem/contracts';
import { commandReceipt } from './http.js';
import type { CommandRouter } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { visibleSessionProject } from './session-project-access.js';

/** Historical outcome only: never returns notes, source refs, or an apparently fresh pack. */
export function registerCheckpointReceipts(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('session.checkpoint.receipt', async (request) => {
    const { context, input } = request;
    if (context.authenticated_client !== true)
      throw new ContractError('DENIED', 'An authenticated client is required', {
        trace_id: context.trace_id,
      });
    const sessionId = input.session_id;
    if (!isUlid(sessionId))
      throw new ContractError('INVALID_INPUT', 'session_id must be a ULID', {
        trace_id: context.trace_id,
      });
    let query;
    try {
      const { session_id: _session, ...body } = input;
      query = parseCheckpointReceiptQuery(body);
      if (query.checkpoint.session_id !== undefined && query.checkpoint.session_id !== sessionId)
        throw new TypeError('Original session_id does not match the requested session');
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid receipt query',
        { trace_id: context.trace_id },
      );
    }
    const receipt = commandReceipt(
      {
        operation: 'session.checkpoint',
        input: { ...query.checkpoint, session_id: sessionId },
        context: { ...context, expected_version: query.checkpoint.expected_version },
      },
      query.request_key,
    );
    if (!db) throw unavailable(context.trace_id);
    let row;
    try {
      [row] = await db<
        {
          checkpoint_id: string | null;
          revision: string | number | null;
          context_pack_id: string | null;
          request_fingerprint: string | null;
        }[]
      >`SELECT c.checkpoint_id, c.revision, c.context_pack_id, c.request_fingerprint
        FROM wcp_sessions s LEFT JOIN wcp_session_checkpoints c ON c.session_id = s.session_id
          AND c.tenant_id = s.tenant_id AND c.workspace_id = s.workspace_id AND c.project_id = s.project_id
          AND c.request_key = ${receipt.key}
        WHERE s.tenant_id = ${context.tenant_id} AND s.workspace_id = ${context.workspace_id}
          AND s.project_id = ${context.project_id} AND s.session_id = ${sessionId}
          AND ${visibleSessionProject(db, context, context.capability.includes('data.restricted.read'))}`;
    } catch {
      throw unavailable(context.trace_id);
    }
    if (!row)
      throw new ContractError('SESSION_NOT_FOUND', 'Session is unavailable in this project', {
        trace_id: context.trace_id,
      });
    const recorded = row.checkpoint_id !== null;
    if (recorded && row.request_fingerprint !== receipt.fingerprint)
      throw new ContractError(
        'IDEMPOTENCY_KEY_REUSED',
        'Key belongs to another checkpoint request',
        { trace_id: context.trace_id },
      );
    if (
      recorded &&
      (!isUlid(row.checkpoint_id) ||
        !Number.isSafeInteger(Number(row.revision)) ||
        Number(row.revision) < 1 ||
        (row.context_pack_id !== null && !isUlid(row.context_pack_id)) ||
        (row.context_pack_id ?? undefined) !== query.checkpoint.context_pack_id)
    )
      throw new ContractError('SESSION_RECEIPT_INVALID', 'Stored checkpoint receipt is invalid', {
        trace_id: context.trace_id,
      });
    const data: CheckpointReceiptLookup = recorded
      ? {
          status: 'recorded',
          session_id: sessionId,
          checkpoint_id: row.checkpoint_id!,
          revision: Number(row.revision),
          context_pack_state: 'not-checked',
          ...(row.context_pack_id === null ? {} : { context_pack_id: row.context_pack_id }),
        }
      : { status: 'not-observed', session_id: sessionId };
    return { schema_version: 1 as const, trace_id: context.trace_id, source_refs: [], data };
  });
}

function unavailable(trace_id: string) {
  return new ContractError(
    'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
    'Checkpoint receipt storage is unavailable',
    { trace_id, retryable: true },
  );
}
