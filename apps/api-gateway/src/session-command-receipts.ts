import {
  ContractError,
  isUlid,
  parseSessionCommandReceiptQuery,
  parseSessionCommandReceiptLookup,
  type SessionCommandReceiptQuery,
  type SessionCommandReceiptLookup,
  type Ulid,
} from '@planemem/contracts';
import { readSessionMutationReceipt, type SessionMutationCommand } from '@planemem/session-service';
import { commandReceipt } from './http.js';
import type { CommandRouter, RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { visibleSessionProject } from './session-project-access.js';

/** Reads an immutable success record; never replays a command or exposes its full snapshot. */
export function registerSessionCommandReceipts(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('session.command.receipt', async ({ context, input }) => {
    if (context.authenticated_client !== true)
      throw new ContractError('DENIED', 'An authenticated client is required', {
        trace_id: context.trace_id,
      });
    const sessionId = input.session_id;
    if (!isUlid(sessionId))
      throw new ContractError('INVALID_INPUT', 'session_id must be a ULID', {
        trace_id: context.trace_id,
      });
    let query: SessionCommandReceiptQuery;
    try {
      const { session_id: _session, ...body } = input;
      query = parseSessionCommandReceiptQuery(body);
      if (query.command.session_id !== undefined && query.command.session_id !== sessionId)
        throw new TypeError('Original session_id does not match the requested session');
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid receipt query',
        {
          trace_id: context.trace_id,
        },
      );
    }
    const receipt = commandReceipt(
      {
        operation: `session.${query.operation}`,
        input: { ...query.command, session_id: sessionId },
        context: { ...context, expected_version: query.command.expected_version },
      },
      query.request_key,
    );
    if (!db) throw unavailable(context.trace_id);
    let row;
    try {
      [row] = await db<
        {
          request_fingerprint: string | null;
          response_document: unknown;
          receipt_session_id: string | null;
        }[]
      >`
        SELECT c.session_id AS receipt_session_id, c.request_fingerprint, c.response_document
        FROM wcp_sessions s LEFT JOIN wcp_session_commands c ON c.session_id = s.session_id
          AND c.operation = ${query.operation} AND c.request_key = ${receipt.key}
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
    let data: SessionCommandReceiptLookup = {
      status: 'not-observed',
      session_id: sessionId,
      operation: query.operation,
    };
    if (row.receipt_session_id !== null) {
      if (row.request_fingerprint !== receipt.fingerprint)
        throw new ContractError(
          'IDEMPOTENCY_KEY_REUSED',
          'Key belongs to another session command',
          {
            trace_id: context.trace_id,
          },
        );
      const result = readSessionMutationReceipt(
        row.response_document,
        originalCommand(query, sessionId, context),
      );
      const base = {
        status: 'recorded' as const,
        session_id: sessionId,
        session_version: result.session.version,
      };
      if (result.kind === 'run.start')
        data = {
          ...base,
          operation: 'run.start',
          run_id: result.run.run_id,
          sequence: result.run.sequence,
        };
      else if (result.kind === 'run.finish')
        data = {
          ...base,
          operation: 'run.finish',
          run_id: result.run.run_id,
          run_version: result.run.version,
          run_status: result.run.status as 'completed' | 'failed',
          changed: result.changed,
        };
      else if (result.kind === 'tool.finish')
        data = {
          ...base,
          operation: 'tool.finish',
          run_id: result.tool_call.run_id,
          tool_call_id: result.tool_call.tool_call_id,
          tool_version: result.tool_call.version,
          tool_status: result.tool_call.status as 'succeeded' | 'failed',
          changed: result.changed,
        };
      else if (result.kind === 'tool.call')
        data = {
          ...base,
          operation: 'tool.call',
          run_id: result.tool_call.run_id,
          tool_call_id: result.tool_call.tool_call_id,
        };
      else
        data = {
          ...base,
          operation: 'end',
          ended_status: query.command.status as 'ended' | 'abandoned' | 'failed',
        };
      try {
        data = parseSessionCommandReceiptLookup(data, sessionId, query);
      } catch {
        throw new ContractError(
          'SESSION_RECEIPT_INVALID',
          'Stored session command receipt is invalid',
          { trace_id: context.trace_id },
        );
      }
    }
    return { schema_version: 1 as const, trace_id: context.trace_id, source_refs: [], data };
  });
}

function originalCommand(
  query: SessionCommandReceiptQuery,
  session_id: Ulid,
  context: RequestContext,
): SessionMutationCommand {
  const input = {
    session_id,
    tenant_id: context.tenant_id as Ulid,
    workspace_id: context.workspace_id as Ulid,
    project_id: context.project_id as Ulid,
    expected_version: query.command.expected_version,
    trace_id: context.trace_id,
  };
  if (query.operation === 'run.start') {
    // Match the original gateway's optionalString behavior without changing the fingerprint.
    const model = query.command.model;
    return {
      kind: 'run.start',
      input: { ...input, ...(typeof model === 'string' && model.length > 0 ? { model } : {}) },
    };
  }
  if (query.operation === 'run.finish')
    return {
      kind: 'run.finish',
      input: {
        ...input,
        run_id: query.command.run_id as Ulid,
        expected_run_version: query.command.expected_run_version as number,
        status: query.command.status as 'completed' | 'failed',
      },
    };
  if (query.operation === 'tool.finish')
    return {
      kind: 'tool.finish',
      input: {
        ...input,
        tool_call_id: query.command.tool_call_id as Ulid,
        expected_tool_version: query.command.expected_tool_version as number,
        status: query.command.status as 'succeeded' | 'failed',
      },
    };
  if (query.operation === 'tool.call')
    return {
      kind: 'tool.call',
      input: {
        ...input,
        run_id: query.command.run_id as Ulid,
        tool_name: query.command.tool_name as string,
        status: query.command.status as 'started' | 'succeeded' | 'failed',
      },
    };
  return {
    kind: 'end',
    input: { ...input, status: query.command.status as 'ended' | 'abandoned' | 'failed' },
  };
}

function unavailable(trace_id: string) {
  return new ContractError(
    'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
    'Session command receipt storage is unavailable',
    {
      trace_id,
      retryable: true,
    },
  );
}
