import {
  ContractError,
  isUlid,
  parseSessionRunQuery,
  parseSessionToolCallQuery,
  parseSessionRunPage,
  parseSessionRunDetail,
  parseSessionToolCallPage,
  parseSessionToolCallDetail,
  parseSessionCommandIdentity,
  parseSessionStateQuery,
  parseSessionStateEnvelope,
} from '@planemem/contracts';
import type { CommandRequest, CommandRouter } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { visibleSessionProject } from './session-project-access.js';

export function registerSessionActivity(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('session.read', async (request) => {
    const { tenant_id, workspace_id, project_id, trace_id } = request.context;
    let sessionId: string;
    try {
      sessionId = parseSessionStateQuery(request.input).session_id;
    } catch {
      throw new ContractError('INVALID_INPUT', 'Supply only session_id as a ULID', { trace_id });
    }
    if (!db) throw unavailable(trace_id);
    try {
      const [row] = await db<Record<string, unknown>[]>`
        SELECT s.session_id, s.status, s.version, s.ended_at FROM wcp_sessions s
        WHERE s.session_id = ${sessionId} AND s.tenant_id = ${tenant_id}
          AND s.workspace_id = ${workspace_id} AND s.project_id = ${project_id}
          AND ${visibleSessionProject(db, request.context, request.context.capability.includes('data.restricted.read'))}`;
      if (!row)
        throw new ContractError('SESSION_NOT_FOUND', 'Session does not exist in this project', {
          trace_id,
        });
      return parseSessionStateEnvelope(
        {
          schema_version: 1,
          trace_id,
          tenant_id,
          workspace_id,
          project_id,
          source_refs: [{ type: 'session', id: sessionId }],
          ...commandIdentity(request),
          session_permissions: {
            write_sessions:
              request.context.authenticated_client === true &&
              (request.context.roles?.includes('admin') === true ||
                request.context.capability.includes('session.write')),
          },
          data: {
            session_id: row.session_id,
            status: row.status,
            version: Number(row.version),
            ended_at: row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at,
          },
        },
        sessionId,
        request.context,
        trace_id,
      );
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof RangeError)
        throw new ContractError('SESSION_ACTIVITY_INVALID', 'Stored session state is invalid', {
          trace_id,
        });
      throw unavailable(trace_id);
    }
  });
  router.register('session.run.read', async (request) => {
    const { session_id, run_id, ...extra } = request.input;
    const { tenant_id, workspace_id, project_id, trace_id } = request.context;
    if (!isUlid(session_id) || !isUlid(run_id) || Object.keys(extra).length)
      throw new ContractError('INVALID_INPUT', 'Supply only session_id and run_id as ULIDs', {
        trace_id,
      });
    if (!db) throw unavailable(trace_id);
    try {
      // One statement gives the selected run and parent versions a common read snapshot.
      const [row] = await db<Record<string, unknown>[]>`
        SELECT s.session_id, s.status AS session_status, s.version AS session_version,
          r.run_id, r.sequence_no, r.model, r.status, r.version, r.trace_id, r.source_refs
        FROM wcp_sessions s LEFT JOIN wcp_agent_runs r
          ON r.session_id = s.session_id AND r.run_id = ${run_id}
        WHERE s.session_id = ${session_id} AND s.tenant_id = ${tenant_id}
          AND s.workspace_id = ${workspace_id} AND s.project_id = ${project_id}
          AND ${visibleSessionProject(db, request.context, request.context.capability.includes('data.restricted.read'))}`;
      if (!row)
        throw new ContractError('SESSION_NOT_FOUND', 'Session does not exist in this project', {
          trace_id,
        });
      if (row.run_id == null)
        throw new ContractError('RUN_NOT_FOUND', 'Run does not exist in this session', {
          trace_id,
        });
      const data = parseSessionRunDetail(
        {
          session: {
            session_id: row.session_id,
            status: row.session_status,
            version: Number(row.session_version),
          },
          run: {
            run_id: row.run_id,
            session_id: row.session_id,
            sequence: Number(row.sequence_no),
            ...(row.model == null ? {} : { model: row.model }),
            status: row.status,
            version: Number(row.version),
            trace_id: row.trace_id,
            source_refs: json(row.source_refs),
          },
        },
        session_id,
        run_id,
      );
      return {
        schema_version: 1 as const,
        trace_id,
        source_refs: [{ type: 'session', id: session_id }],
        // A display hint only; writes still pass through their own policy and identity checks.
        ...commandIdentity(request),
        session_permissions: {
          write_sessions:
            request.context.authenticated_client === true &&
            (request.context.roles?.includes('admin') === true ||
              request.context.capability.includes('session.write')),
        },
        data,
      };
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError)
        throw new ContractError('SESSION_ACTIVITY_INVALID', 'Stored session activity is invalid', {
          trace_id,
        });
      throw unavailable(trace_id);
    }
  });
  router.register('session.tool.read', async (request) => {
    const { session_id, tool_call_id, ...extra } = request.input;
    const { tenant_id, workspace_id, project_id, trace_id } = request.context;
    if (!isUlid(session_id) || !isUlid(tool_call_id) || Object.keys(extra).length)
      throw new ContractError('INVALID_INPUT', 'Supply only session_id and tool_call_id as ULIDs', {
        trace_id,
      });
    if (!db) throw unavailable(trace_id);
    try {
      const [row] = await db<Record<string, unknown>[]>`
        SELECT s.session_id, s.status AS session_status, s.version AS session_version,
          t.tool_call_id, t.run_id, t.tool_name, t.status, t.version, t.trace_id, t.source_refs,
          r.run_id AS linked_run_id, r.sequence_no AS run_sequence, r.model AS run_model,
          r.status AS run_status, r.version AS run_version, r.trace_id AS run_trace_id,
          r.source_refs AS run_source_refs
        FROM wcp_sessions s LEFT JOIN wcp_tool_calls t
          ON t.session_id = s.session_id AND t.tool_call_id = ${tool_call_id}
        LEFT JOIN wcp_agent_runs r ON r.run_id = t.run_id AND r.session_id = s.session_id
        WHERE s.session_id = ${session_id} AND s.tenant_id = ${tenant_id}
          AND s.workspace_id = ${workspace_id} AND s.project_id = ${project_id}
          AND ${visibleSessionProject(db, request.context, request.context.capability.includes('data.restricted.read'))}`;
      if (!row)
        throw new ContractError('SESSION_NOT_FOUND', 'Session does not exist in this project', {
          trace_id,
        });
      if (row.tool_call_id == null)
        throw new ContractError('TOOL_CALL_NOT_FOUND', 'Tool call does not exist in this session', {
          trace_id,
        });
      const data = parseSessionToolCallDetail(
        {
          session: {
            session_id: row.session_id,
            status: row.session_status,
            version: Number(row.session_version),
          },
          run: {
            run_id: row.linked_run_id,
            session_id: row.session_id,
            sequence: Number(row.run_sequence),
            ...(row.run_model == null ? {} : { model: row.run_model }),
            status: row.run_status,
            version: Number(row.run_version),
            trace_id: row.run_trace_id,
            source_refs: json(row.run_source_refs),
          },
          tool_call: {
            tool_call_id: row.tool_call_id,
            session_id: row.session_id,
            run_id: row.run_id,
            tool_name: row.tool_name,
            status: row.status,
            version: Number(row.version),
            trace_id: row.trace_id,
            source_refs: json(row.source_refs),
          },
        },
        session_id,
        tool_call_id,
      );
      return {
        schema_version: 1 as const,
        trace_id,
        source_refs: [{ type: 'session', id: session_id }],
        ...commandIdentity(request),
        session_permissions: {
          write_sessions:
            request.context.authenticated_client === true &&
            (request.context.roles?.includes('admin') === true ||
              request.context.capability.includes('session.write')),
        },
        data,
      };
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError)
        throw new ContractError('SESSION_ACTIVITY_INVALID', 'Stored session activity is invalid', {
          trace_id,
        });
      throw unavailable(trace_id);
    }
  });
  for (const operation of ['session.runs.list', 'session.tools.list'])
    router.register(operation, async (request) => {
      const { session_id, ...input } = request.input;
      const trace_id = request.context.trace_id;
      if (!isUlid(session_id))
        throw new ContractError('INVALID_INPUT', 'session_id must be a ULID', { trace_id });
      const runs = operation === 'session.runs.list';
      let query;
      try {
        query = runs ? parseSessionRunQuery(input) : parseSessionToolCallQuery(input);
      } catch (error) {
        throw new ContractError(
          'INVALID_INPUT',
          error instanceof Error ? error.message : 'Invalid activity query',
          { trace_id },
        );
      }
      if (!db) throw unavailable(trace_id);
      try {
        const { tenant_id, workspace_id, project_id } = request.context;
        const visibleProject = visibleSessionProject(
          db,
          request.context,
          request.context.capability.includes('data.restricted.read'),
        );
        let data;
        if (runs) {
          const filter = parseSessionRunQuery(query);
          const older =
            filter.before_sequence === undefined
              ? db``
              : db`AND r.sequence_no < ${filter.before_sequence}`;
          const joined = await db<Record<string, unknown>[]>`
            SELECT s.session_id AS parent_session_id, s.status AS session_status, s.version AS session_version, r.*
            FROM wcp_sessions s LEFT JOIN LATERAL (
              SELECT r.run_id, r.session_id, r.sequence_no, r.model, r.status, r.version, r.trace_id, r.source_refs
              FROM wcp_agent_runs r WHERE r.session_id = s.session_id ${older}
              ORDER BY r.sequence_no DESC LIMIT ${filter.limit + 1}
            ) r ON true
            WHERE s.session_id = ${session_id} AND s.tenant_id = ${tenant_id}
              AND s.workspace_id = ${workspace_id} AND s.project_id = ${project_id} AND ${visibleProject}
            ORDER BY r.sequence_no DESC`;
          const session = pageSession(joined[0], trace_id);
          const rows = joined[0]!.run_id === null ? [] : joined;
          const page = rows.slice(0, filter.limit).map((row) => ({
            run_id: row.run_id,
            session_id: row.session_id,
            sequence: Number(row.sequence_no),
            ...(row.model == null ? {} : { model: row.model }),
            status: row.status,
            version: Number(row.version),
            trace_id: row.trace_id,
            source_refs: json(row.source_refs),
          }));
          data = parseSessionRunPage(
            {
              session,
              runs: page,
              ...(rows.length > filter.limit
                ? { next_before_sequence: page.at(-1)?.sequence }
                : {}),
            },
            session_id,
            filter,
          );
        } else {
          const filter = parseSessionToolCallQuery(query);
          const older =
            filter.before_id === undefined
              ? db``
              : db`AND t.tool_call_id COLLATE "C" < ${filter.before_id}`;
          const runFilter =
            filter.run_id === undefined ? db`` : db`AND t.run_id = ${filter.run_id}`;
          const joined = await db<Record<string, unknown>[]>`
            SELECT s.session_id AS parent_session_id, s.status AS session_status, s.version AS session_version,
              (${filter.run_id ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM wcp_agent_runs selected_run
                WHERE selected_run.session_id = s.session_id AND selected_run.run_id = ${filter.run_id ?? null})) AS requested_run_exists,
              t.*
            FROM wcp_sessions s LEFT JOIN LATERAL (
              SELECT t.tool_call_id, t.session_id, t.run_id, t.tool_name, t.status, t.version, t.trace_id, t.source_refs
              FROM wcp_tool_calls t JOIN wcp_agent_runs r ON r.run_id = t.run_id AND r.session_id = t.session_id
              WHERE t.session_id = s.session_id ${older} ${runFilter}
              ORDER BY t.tool_call_id COLLATE "C" DESC LIMIT ${filter.limit + 1}
            ) t ON true
            WHERE s.session_id = ${session_id} AND s.tenant_id = ${tenant_id}
              AND s.workspace_id = ${workspace_id} AND s.project_id = ${project_id} AND ${visibleProject}
            ORDER BY t.tool_call_id COLLATE "C" DESC`;
          const session = pageSession(joined[0], trace_id);
          if (joined[0]!.requested_run_exists !== true)
            throw new ContractError('RUN_NOT_FOUND', 'Run does not exist in this session', {
              trace_id,
            });
          const rows = joined[0]!.tool_call_id === null ? [] : joined;
          const page = rows.slice(0, filter.limit).map((row) => ({
            tool_call_id: row.tool_call_id,
            session_id: row.session_id,
            run_id: row.run_id,
            tool_name: row.tool_name,
            status: row.status,
            version: Number(row.version),
            trace_id: row.trace_id,
            source_refs: json(row.source_refs),
          }));
          data = parseSessionToolCallPage(
            {
              session,
              tool_calls: page,
              ...(filter.run_id === undefined ? {} : { run_id: filter.run_id }),
              ...(rows.length > filter.limit ? { next_before_id: page.at(-1)?.tool_call_id } : {}),
            },
            session_id,
            filter,
          );
        }
        return {
          schema_version: 1 as const,
          trace_id,
          source_refs: [{ type: 'session', id: session_id }],
          data,
        };
      } catch (error) {
        if (error instanceof ContractError) throw error;
        if (error instanceof TypeError || error instanceof SyntaxError)
          throw new ContractError(
            'SESSION_ACTIVITY_INVALID',
            'Stored session activity is invalid',
            { trace_id },
          );
        throw unavailable(trace_id);
      }
    });
}

function commandIdentity(request: CommandRequest) {
  if (request.context.authenticated_client !== true) return {};
  const { tenant_id, workspace_id, project_id, actor_id, client_id } = request.context;
  return {
    session_identity: parseSessionCommandIdentity({
      tenant_id,
      workspace_id,
      project_id,
      actor_id,
      client_id,
    }),
  };
}

function pageSession(row: Record<string, unknown> | undefined, trace_id: string) {
  if (!row)
    throw new ContractError('SESSION_NOT_FOUND', 'Session does not exist in this project', {
      trace_id,
    });
  return {
    session_id: row.parent_session_id,
    status: row.session_status,
    version: Number(row.session_version),
  };
}
function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function unavailable(trace_id: string) {
  return new ContractError(
    'SESSION_STORAGE_UNAVAILABLE',
    'Session activity storage is unavailable',
    { trace_id, retryable: true },
  );
}
