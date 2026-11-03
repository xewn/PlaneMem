import type {
  AgentRun,
  Session,
  SessionScope,
  SessionStore,
  SessionStoreSnapshot,
  ToolCall,
  SessionMutationCommand,
  SessionMutationState,
  SessionMutationResult,
  SessionMutationCommit,
  StartSessionReceiptInput,
  SessionStartCommit,
} from '@planemem/session-service';
import { readSessionMutationReceipt } from '@planemem/session-service';
import type {
  Checkpoint,
  CreateCheckpointInput,
  ClaimHandoffInput,
  ClaimHandoffReceiptInput,
  HandoffClaimCommit,
  CreateHandoffReceiptInput,
  HandoffCreateCommit,
  ContinuationStore,
  ContinuationStoreSnapshot,
  Handoff,
} from '@planemem/session-service';
import type { MemoryRef } from '@planemem/domain';
import {
  ContractError,
  parseSessionResumeOrigin,
  parseHandoffClaimReceiptLookup,
  parseHandoffCreateReceiptLookup,
  assertHandoffCreationCurrent,
  parseSessionStartReceiptLookup,
  assertSessionStartCurrent,
} from '@planemem/contracts';
import postgres from 'postgres';
import { lockSessionProject, visibleSessionProject } from './session-project-access.js';

type Sql = ReturnType<typeof postgres>;

export async function withSessionTransaction<T>(
  db: Sql,
  traceId: string,
  run: (tx: Sql) => Promise<T>,
): Promise<T> {
  try {
    return (await db.begin(run)) as T;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError('SESSION_STORAGE_UNAVAILABLE', 'Session storage is unavailable', {
      trace_id: traceId,
      retryable: true,
    });
  }
}

/** PostgreSQL adapter for PlaneMem session continuity. The session-service owns the domain rules. */
export class PostgresSessionStore implements SessionStore, ContinuationStore {
  constructor(
    private readonly db: Sql,
    private readonly inTransaction = false,
  ) {}

  /** A caller-owned transaction must also own its domain service caches until commit. */
  private async transaction<T>(write: (tx: Sql) => Promise<T>): Promise<T> {
    if (this.inTransaction) return write(this.db);
    return (await this.db.begin(write)) as T;
  }

  async loadSessions(): Promise<SessionStoreSnapshot> {
    const sessions = await this.db<SessionRow[]>`
      SELECT session_id, tenant_id, workspace_id, project_id, client_id, actor_id,
             parent_session_id, resume_origin, status, version, trace_id, source_refs,
             started_at::text AS started_at, ended_at::text AS ended_at, idempotency_key
      FROM wcp_sessions
      ORDER BY started_at, session_id
    `;
    const runs = await this.db<RunRow[]>`
      SELECT run_id, session_id, sequence_no, model, status, version, trace_id, source_refs
      FROM wcp_agent_runs
      ORDER BY session_id, sequence_no, run_id
    `;
    const toolCalls = await this.db<ToolCallRow[]>`
      SELECT tool_call_id, session_id, run_id, tool_name, status, version, trace_id, source_refs
      FROM wcp_tool_calls
      ORDER BY session_id, tool_call_id
    `;
    return {
      sessions: sessions.map((row) => ({
        session: toSession(row),
        ...(row.idempotency_key === null ? {} : { idempotency_key: row.idempotency_key }),
      })),
      runs: runs.map(toRun),
      tool_calls: toolCalls.map(toToolCall),
    };
  }

  async startSessionWithReceipt(
    input: StartSessionReceiptInput,
    candidate: Session,
  ): Promise<SessionStartCommit> {
    try {
      return await this.transaction(async (tx) => {
        const [project] = await tx<{ id: string }[]>`SELECT id FROM wcp_projects
          WHERE id = ${input.project_id} AND tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id}
            AND deleted_at IS NULL AND classification IN ('public', 'internal', 'confidential', 'restricted')
            AND (${input.read_restricted === true} OR classification <> 'restricted') FOR SHARE`;
        if (!project)
          throw new ContractError('DENIED', 'Project is unavailable for starting a session', {
            trace_id: input.trace_id,
          });
        // Match the existing actor/client/raw-key unique boundary across ordinary starts.
        const lock = JSON.stringify([
          'session.start',
          input.tenant_id,
          input.workspace_id,
          input.project_id,
          input.actor_id,
          input.client_id,
          input.idempotency_key,
        ]);
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
        if (input.parent_session_id !== undefined) {
          const [parent] = await tx<{ session_id: string }[]>`SELECT session_id FROM wcp_sessions
            WHERE session_id = ${input.parent_session_id} AND tenant_id = ${input.tenant_id}
              AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id} FOR SHARE`;
          if (!parent)
            throw new ContractError(
              'SESSION_NOT_FOUND',
              'Parent session is unavailable in this project',
              { trace_id: input.trace_id },
            );
        }
        const command = {
          ...(input.parent_session_id === undefined
            ? {}
            : { parent_session_id: input.parent_session_id }),
        };
        const [previous] = await tx<
          { session_id: string; request_fingerprint: string; response_document: unknown }[]
        >`SELECT session_id, request_fingerprint, response_document
          FROM wcp_session_start_commands WHERE tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id}
            AND project_id = ${input.project_id} AND request_key = ${input.receipt.key}`;
        if (previous) {
          if (previous.request_fingerprint !== input.receipt.fingerprint)
            throw new ContractError(
              'IDEMPOTENCY_KEY_REUSED',
              'Key belongs to another session start',
              { trace_id: input.trace_id },
            );
          const receipt = parseSessionStartReceiptLookup(
            previous.response_document,
            command,
            input,
          );
          if (receipt.status !== 'recorded' || receipt.session_id !== previous.session_id)
            throw new TypeError();
          const [row] = await tx<
            SessionRow[]
          >`SELECT *, started_at::text AS started_at, ended_at::text AS ended_at FROM wcp_sessions
            WHERE session_id = ${previous.session_id} AND tenant_id = ${input.tenant_id}
              AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id} FOR SHARE`;
          if (!row || row.idempotency_key !== input.idempotency_key) throw new TypeError();
          // PostgreSQL text timestamps may use spaces, offsets and shortened fractions.
          const session = toSession({
            ...row,
            started_at: new Date(row.started_at).toISOString(),
            ended_at: row.ended_at === null ? null : new Date(row.ended_at).toISOString(),
          });
          assertSessionStartCurrent(session, receipt, input);
          return { session, receipt };
        }
        const [legacy] = await tx<{ session_id: string }[]>`SELECT session_id FROM wcp_sessions
          WHERE tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id}
            AND actor_id = ${input.actor_id} AND client_id = ${input.client_id} AND idempotency_key = ${input.idempotency_key}`;
        if (legacy)
          throw new ContractError(
            'SESSION_START_LEGACY_UNVERIFIED',
            'This original key has a session without a matching start receipt. Retain the original request for review.',
            { trace_id: input.trace_id },
          );
        const receipt = parseSessionStartReceiptLookup(
          {
            status: 'recorded',
            session_id: candidate.session_id,
            ...command,
            actor_id: input.actor_id,
            client_id: input.client_id,
            started_at: candidate.started_at,
            session_version: 1,
          },
          command,
          input,
        );
        if (receipt.status !== 'recorded') throw new TypeError();
        assertSessionStartCurrent(candidate, receipt, input);
        if (candidate.version !== 1 || candidate.status !== 'running') throw new TypeError();
        const inserted = await tx<{ session_id: string }[]>`INSERT INTO wcp_sessions
          (session_id, tenant_id, workspace_id, project_id, client_id, actor_id, parent_session_id, status, version, started_at, trace_id, source_refs, idempotency_key)
          VALUES (${candidate.session_id}, ${input.tenant_id}, ${input.workspace_id}, ${input.project_id}, ${input.client_id}, ${input.actor_id},
            ${input.parent_session_id ?? null}, 'running', 1, ${candidate.started_at}, ${input.trace_id}, ${JSON.stringify(candidate.source_refs)}::jsonb, ${input.idempotency_key})
          ON CONFLICT DO NOTHING RETURNING session_id`;
        if (inserted.length !== 1)
          throw new ContractError(
            'SESSION_START_LEGACY_UNVERIFIED',
            'A concurrent session cannot be attributed to this original start',
            { trace_id: input.trace_id },
          );
        await tx`INSERT INTO wcp_session_start_commands
          (tenant_id, workspace_id, project_id, request_key, request_fingerprint, session_id, response_document)
          VALUES (${input.tenant_id}, ${input.workspace_id}, ${input.project_id}, ${input.receipt.key}, ${input.receipt.fingerprint}, ${candidate.session_id}, ${JSON.stringify(receipt)}::jsonb)`;
        return { session: candidate, receipt };
      });
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError)
        throw new ContractError('SESSION_RECEIPT_INVALID', 'Stored session start is invalid', {
          trace_id: input.trace_id,
        });
      throw new ContractError(
        'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
        'Session start receipt storage is unavailable',
        { trace_id: input.trace_id, retryable: true },
      );
    }
  }

  async findSession(
    id: Session['session_id'],
    scope: SessionScope & { read_restricted?: boolean },
  ): Promise<Session | undefined> {
    const [row] = await this.db<SessionRow[]>`
      SELECT session_id, tenant_id, workspace_id, project_id, client_id, actor_id,
             parent_session_id, resume_origin, status, version, trace_id, source_refs, idempotency_key,
             started_at::text AS started_at, ended_at::text AS ended_at
        FROM wcp_sessions WHERE session_id = ${id} AND tenant_id = ${scope.tenant_id}
          AND workspace_id = ${scope.workspace_id} AND project_id = ${scope.project_id}
          AND ${visibleSessionProject(this.db, scope, scope.read_restricted === true)}
    `;
    return row && toSession(row);
  }

  async saveSession(session: Session, idempotency_key?: string): Promise<Session | void> {
    const conflict =
      idempotency_key === undefined
        ? this.db`
      ON CONFLICT (session_id) DO UPDATE SET
        status = EXCLUDED.status, version = EXCLUDED.version, trace_id = EXCLUDED.trace_id,
        source_refs = EXCLUDED.source_refs, ended_at = EXCLUDED.ended_at
      WHERE wcp_sessions.version = EXCLUDED.version - 1
        AND wcp_sessions.tenant_id = EXCLUDED.tenant_id
        AND wcp_sessions.workspace_id = EXCLUDED.workspace_id
        AND wcp_sessions.project_id = EXCLUDED.project_id
        AND wcp_sessions.actor_id = EXCLUDED.actor_id AND wcp_sessions.client_id = EXCLUDED.client_id
        AND wcp_sessions.parent_session_id IS NOT DISTINCT FROM EXCLUDED.parent_session_id
        AND wcp_sessions.resume_origin IS NOT DISTINCT FROM EXCLUDED.resume_origin
    `
        : this.db`ON CONFLICT DO NOTHING`;
    const updated = await this.db<{ session_id: string }[]>`
      INSERT INTO wcp_sessions
        (session_id, tenant_id, workspace_id, project_id, client_id, actor_id,
         parent_session_id, resume_origin, status, version, trace_id, source_refs, started_at, ended_at,
         idempotency_key)
      VALUES
        (${session.session_id}, ${session.tenant_id}, ${session.workspace_id}, ${session.project_id},
         ${session.client_id}, ${session.actor_id}, ${session.parent_session_id ?? null},
         ${session.resume_origin === undefined ? null : JSON.stringify(session.resume_origin)}::jsonb,
         ${session.status}, ${session.version}, ${session.trace_id},
         ${JSON.stringify(session.source_refs)}::jsonb, ${session.started_at},
         ${session.ended_at ?? null}, ${idempotency_key ?? null})
      ${conflict}
      RETURNING session_id
    `;
    if (updated.length !== 0) return;
    if (idempotency_key !== undefined) {
      const [row] = await this.db<SessionRow[]>`
        SELECT session_id, tenant_id, workspace_id, project_id, client_id, actor_id,
               parent_session_id, resume_origin, status, version, trace_id, source_refs, idempotency_key,
               started_at::text AS started_at, ended_at::text AS ended_at
          FROM wcp_sessions WHERE tenant_id = ${session.tenant_id}
            AND workspace_id = ${session.workspace_id} AND project_id = ${session.project_id}
            AND actor_id = ${session.actor_id} AND client_id = ${session.client_id}
            AND idempotency_key = ${idempotency_key}
      `;
      if (row) return toSession(row);
    }
    throw new ContractError('SESSION_VERSION_CONFLICT', 'Durable session version is newer', {
      session_id: session.session_id,
      expected_version: session.version,
      trace_id: session.trace_id,
      retryable: true,
    });
  }

  async mutateSession(
    command: SessionMutationCommand,
    prepare: (state: SessionMutationState) => SessionMutationResult,
  ): Promise<SessionMutationCommit> {
    const { input, kind } = command;
    try {
      return await this.transaction(async (tx) => {
        await lockSessionProject(tx, input);
        const [row] = await tx<
          SessionRow[]
        >`SELECT *, started_at::text AS started_at, ended_at::text AS ended_at
          FROM wcp_sessions WHERE session_id = ${input.session_id} AND tenant_id = ${input.tenant_id}
            AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id} FOR UPDATE`;
        if (!row)
          throw new ContractError('SESSION_NOT_FOUND', 'Session does not exist in this project', {
            trace_id: input.trace_id,
          });
        const current = toSession(row);
        if (input.receipt) {
          const [previous] = await tx<
            { request_fingerprint: string; response_document: unknown }[]
          >`
            SELECT request_fingerprint, response_document FROM wcp_session_commands
            WHERE session_id = ${input.session_id} AND operation = ${kind} AND request_key = ${input.receipt.key}`;
          if (previous) {
            if (previous.request_fingerprint !== input.receipt.fingerprint)
              throw new ContractError(
                'IDEMPOTENCY_KEY_REUSED',
                'Key belongs to another session command',
                { trace_id: input.trace_id },
              );
            const result = readSessionMutationReceipt(previous.response_document, command);
            let currentRun: AgentRun | undefined;
            let currentTool: ToolCall | undefined;
            if (result.kind === 'run.start' || result.kind === 'run.finish') {
              const [row] = await tx<RunRow[]>`SELECT * FROM wcp_agent_runs
                WHERE session_id = ${input.session_id} AND run_id = ${result.run.run_id} FOR UPDATE`;
              if (
                !row ||
                !Number.isSafeInteger(Number(row.version)) ||
                Number(row.version) < result.run.version ||
                (Number(row.version) === result.run.version && row.status !== result.run.status) ||
                (result.kind === 'run.finish' && row.status !== result.run.status) ||
                Number(row.sequence_no) !== result.run.sequence ||
                (row.model ?? undefined) !== result.run.model ||
                !['running', 'completed', 'failed'].includes(row.status)
              )
                throw new ContractError(
                  'SESSION_RECEIPT_INVALID',
                  'Current run does not match its receipt history',
                  { trace_id: input.trace_id },
                );
              currentRun = toRun(row);
            }
            if (result.kind === 'tool.call' || result.kind === 'tool.finish') {
              const [row] = await tx<ToolCallRow[]>`SELECT t.* FROM wcp_tool_calls t
                JOIN wcp_agent_runs r ON r.run_id = t.run_id AND r.session_id = t.session_id
                WHERE t.session_id = ${input.session_id} AND t.tool_call_id = ${result.tool_call.tool_call_id}
                FOR UPDATE OF t`;
              const saved = result.tool_call;
              if (
                !row ||
                !Number.isSafeInteger(Number(row.version)) ||
                Number(row.version) < saved.version ||
                (Number(row.version) === saved.version && row.status !== saved.status) ||
                (saved.status !== 'started' && row.status !== saved.status) ||
                row.run_id !== saved.run_id ||
                row.tool_name !== saved.tool_name ||
                !['started', 'succeeded', 'failed'].includes(row.status)
              )
                throw new ContractError(
                  'SESSION_RECEIPT_INVALID',
                  'Current tool call does not match its receipt history',
                  {
                    trace_id: input.trace_id,
                  },
                );
              currentTool = toToolCall(row);
            }
            return {
              result,
              current_session: current,
              ...(currentRun ? { current_run: currentRun } : {}),
              ...(currentTool ? { current_tool_call: currentTool } : {}),
            };
          }
        }
        let lastRunSequence = 0;
        let run: AgentRun | undefined;
        let toolCall: ToolCall | undefined;
        if (kind === 'run.start') {
          const [latest] = await tx<
            { sequence: number | string }[]
          >`SELECT COALESCE(MAX(sequence_no), 0) AS sequence
            FROM wcp_agent_runs WHERE session_id = ${input.session_id}`;
          lastRunSequence = Number(latest!.sequence);
        } else if (command.kind === 'tool.call' || command.kind === 'run.finish') {
          const [savedRun] = await tx<RunRow[]>`SELECT * FROM wcp_agent_runs
            WHERE session_id = ${input.session_id} AND run_id = ${command.input.run_id} FOR UPDATE`;
          if (savedRun) run = toRun(savedRun);
        } else if (command.kind === 'tool.finish') {
          const [savedTool] = await tx<ToolCallRow[]>`SELECT t.* FROM wcp_tool_calls t
            JOIN wcp_agent_runs r ON r.run_id = t.run_id AND r.session_id = t.session_id
            WHERE t.session_id = ${input.session_id} AND t.tool_call_id = ${command.input.tool_call_id}
            FOR UPDATE OF t`;
          if (savedTool) toolCall = toToolCall(savedTool);
        }
        const result = prepare({
          session: current,
          last_run_sequence: lastRunSequence,
          ...(run === undefined ? {} : { run }),
          ...(toolCall === undefined ? {} : { tool_call: toolCall }),
        });
        readSessionMutationReceipt(result, command);
        const next = result.session;
        const updated = await tx<{ session_id: string }[]>`UPDATE wcp_sessions
          SET status = ${next.status}, version = ${next.version}, trace_id = ${next.trace_id}, ended_at = ${next.ended_at ?? null}
          WHERE session_id = ${input.session_id} AND tenant_id = ${input.tenant_id}
            AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id} AND version = ${current.version}
          RETURNING session_id`;
        if (updated.length !== 1)
          throw new ContractError('SESSION_VERSION_CONFLICT', 'Session changed before commit', {
            trace_id: input.trace_id,
          });
        if (result.kind === 'run.start') {
          const item = result.run;
          await tx`INSERT INTO wcp_agent_runs (run_id, session_id, sequence_no, model, status, version, trace_id, source_refs)
            VALUES (${item.run_id}, ${item.session_id}, ${item.sequence}, ${item.model ?? null}, ${item.status},
              ${item.version}, ${item.trace_id}, ${JSON.stringify(item.source_refs)}::jsonb)`;
        } else if (result.kind === 'run.finish' && result.changed) {
          const item = result.run;
          const updatedRun = await tx<{ run_id: string }[]>`UPDATE wcp_agent_runs
            SET status = ${item.status}, version = ${item.version}, trace_id = ${item.trace_id}
            WHERE session_id = ${input.session_id} AND run_id = ${item.run_id}
              AND version = ${run!.version} AND status = 'running' RETURNING run_id`;
          if (updatedRun.length !== 1)
            throw new ContractError('RUN_VERSION_CONFLICT', 'Run changed before commit', {
              trace_id: input.trace_id,
            });
        } else if (result.kind === 'tool.finish' && result.changed) {
          const item = result.tool_call;
          const updatedTool = await tx<{ tool_call_id: string }[]>`UPDATE wcp_tool_calls
            SET status = ${item.status}, version = ${item.version}, trace_id = ${item.trace_id}
            WHERE session_id = ${input.session_id} AND tool_call_id = ${item.tool_call_id}
              AND run_id = ${item.run_id} AND version = ${toolCall!.version} AND status = 'started'
            RETURNING tool_call_id`;
          if (updatedTool.length !== 1)
            throw new ContractError('TOOL_VERSION_CONFLICT', 'Tool call changed before commit', {
              trace_id: input.trace_id,
            });
        } else if (result.kind === 'tool.call') {
          const item = result.tool_call;
          await tx`INSERT INTO wcp_tool_calls (tool_call_id, session_id, run_id, tool_name, status, version, trace_id, source_refs)
            VALUES (${item.tool_call_id}, ${item.session_id}, ${item.run_id}, ${item.tool_name}, ${item.status},
              ${item.version}, ${item.trace_id}, ${JSON.stringify(item.source_refs)}::jsonb)`;
        }
        if (input.receipt)
          await tx`INSERT INTO wcp_session_commands
          (session_id, operation, request_key, request_fingerprint, response_document)
          VALUES (${input.session_id}, ${kind}, ${input.receipt.key}, ${input.receipt.fingerprint}, ${JSON.stringify(result)}::jsonb)`;
        return {
          result,
          current_session: next,
          ...(result.kind === 'run.start' || result.kind === 'run.finish'
            ? { current_run: result.run }
            : {}),
          ...(result.kind === 'tool.call' || result.kind === 'tool.finish'
            ? { current_tool_call: result.tool_call }
            : {}),
        };
      });
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError(
        'SESSION_STORAGE_UNAVAILABLE',
        'Session command storage is unavailable',
        { trace_id: input.trace_id, retryable: true },
      );
    }
  }

  async saveRun(run: AgentRun): Promise<void> {
    await this.db`
      INSERT INTO wcp_agent_runs
        (run_id, session_id, sequence_no, model, status, version, trace_id, source_refs)
      VALUES
        (${run.run_id}, ${run.session_id}, ${run.sequence}, ${run.model ?? null}, ${run.status},
         ${run.version}, ${run.trace_id}, ${JSON.stringify(run.source_refs)}::jsonb)
      ON CONFLICT (run_id) DO UPDATE SET
        model = EXCLUDED.model,
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        trace_id = EXCLUDED.trace_id,
        source_refs = EXCLUDED.source_refs
    `;
  }

  async saveToolCall(toolCall: ToolCall): Promise<void> {
    await this.db`
      INSERT INTO wcp_tool_calls
        (tool_call_id, session_id, run_id, tool_name, status, version, trace_id, source_refs)
      VALUES
        (${toolCall.tool_call_id}, ${toolCall.session_id}, ${toolCall.run_id}, ${toolCall.tool_name},
         ${toolCall.status}, ${toolCall.version}, ${toolCall.trace_id},
         ${JSON.stringify(toolCall.source_refs)}::jsonb)
      ON CONFLICT (tool_call_id) DO UPDATE SET
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        trace_id = EXCLUDED.trace_id,
        source_refs = EXCLUDED.source_refs
    `;
  }

  async loadContinuations(): Promise<ContinuationStoreSnapshot> {
    const checkpoints = await this.db<CheckpointRow[]>`
      SELECT checkpoint_id, tenant_id, workspace_id, project_id, session_id, revision,
             completed, in_progress, next_actions, decisions, risks, open_questions,
             state_hash, context_pack_hash, context_pack_id, memory_ref, trace_id, source_refs
      FROM wcp_session_checkpoints
      ORDER BY session_id, revision, checkpoint_id
    `;
    const handoffs = await this.db<HandoffRow[]>`
      SELECT handoff_id, tenant_id, workspace_id, project_id, checkpoint_id, from_client,
             target_client, status, claimed_by, claimed_by_actor, version, trace_id, source_refs, idempotency_key
      FROM wcp_session_handoffs
      ORDER BY handoff_id
    `;
    return {
      checkpoints: checkpoints.map(toCheckpoint),
      handoffs: handoffs.map((row) => ({
        handoff: toHandoff(row),
        ...(row.idempotency_key === null ? {} : { idempotency_key: row.idempotency_key }),
      })),
    };
  }

  async appendCheckpoint(
    input: CreateCheckpointInput,
    prepare: (session: Pick<Session, 'status' | 'version'>, revision: number) => Checkpoint,
  ): Promise<Checkpoint> {
    return this.transaction(async (tx) => {
      await lockSessionProject(tx, input);
      const [session] = await tx<Pick<SessionRow, 'status' | 'version'>[]>`
        SELECT status, version FROM wcp_sessions WHERE session_id = ${input.session_id}
          AND tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id}
          FOR UPDATE
      `;
      if (!session)
        throw new ContractError('SESSION_NOT_FOUND', 'Session does not exist in this project', {
          trace_id: input.trace_id,
        });
      if (input.receipt) {
        const [saved] = await tx<(CheckpointRow & { request_fingerprint: string })[]>`
          SELECT * FROM wcp_session_checkpoints WHERE session_id = ${input.session_id} AND request_key = ${input.receipt.key}
            AND tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id}
        `;
        if (saved) {
          if (saved.request_fingerprint !== input.receipt.fingerprint)
            throw new ContractError(
              'IDEMPOTENCY_KEY_REUSED',
              'Key belongs to another checkpoint request',
              { trace_id: input.trace_id },
            );
          return toCheckpoint(saved);
        }
      }
      const [latest] = await tx<{ revision: number | string }[]>`
        SELECT revision FROM wcp_session_checkpoints WHERE session_id = ${input.session_id}
          AND tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id}
          ORDER BY revision DESC LIMIT 1
      `;
      const checkpoint = prepare(
        { status: session.status, version: Number(session.version) },
        Number(latest?.revision ?? 0) + 1,
      );
      await this.writeCheckpoint(tx, checkpoint, input.receipt);
      return checkpoint;
    });
  }

  saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    return this.writeCheckpoint(this.db, checkpoint);
  }

  private async writeCheckpoint(
    db: Sql,
    checkpoint: Checkpoint,
    receipt?: CreateCheckpointInput['receipt'],
  ): Promise<void> {
    await db`
      INSERT INTO wcp_session_checkpoints
        (checkpoint_id, tenant_id, workspace_id, project_id, session_id, revision,
         completed, in_progress, next_actions, decisions, risks, open_questions,
         state_hash, context_pack_hash, context_pack_id, memory_ref, trace_id, source_refs, request_key, request_fingerprint)
      VALUES
        (${checkpoint.checkpoint_id}, ${checkpoint.tenant_id}, ${checkpoint.workspace_id},
         ${checkpoint.project_id}, ${checkpoint.session_id}, ${checkpoint.revision},
         ${JSON.stringify(checkpoint.completed)}::jsonb, ${JSON.stringify(checkpoint.in_progress)}::jsonb,
         ${JSON.stringify(checkpoint.next_actions)}::jsonb, ${JSON.stringify(checkpoint.decisions)}::jsonb,
         ${JSON.stringify(checkpoint.risks)}::jsonb, ${JSON.stringify(checkpoint.open_questions)}::jsonb,
         ${checkpoint.state_hash}, ${checkpoint.context_pack_hash ?? null}, ${checkpoint.context_pack_id ?? null},
         ${checkpoint.memory_ref === undefined ? null : JSON.stringify(checkpoint.memory_ref)}::jsonb,
         ${checkpoint.trace_id}, ${JSON.stringify(checkpoint.source_refs)}::jsonb,
         ${receipt?.key ?? null}, ${receipt?.fingerprint ?? null})
      ON CONFLICT (checkpoint_id) DO UPDATE SET
        trace_id = EXCLUDED.trace_id,
        source_refs = EXCLUDED.source_refs
    `;
  }

  async findCheckpoint(
    id: Checkpoint['checkpoint_id'],
    scope: SessionScope & { read_restricted?: boolean },
  ): Promise<Checkpoint | undefined> {
    const [row] = await this.db<CheckpointRow[]>`
      SELECT c.* FROM wcp_session_checkpoints c JOIN wcp_sessions s ON s.session_id = c.session_id
        AND s.tenant_id = c.tenant_id AND s.workspace_id = c.workspace_id AND s.project_id = c.project_id
      WHERE c.checkpoint_id = ${id} AND c.tenant_id = ${scope.tenant_id}
        AND c.workspace_id = ${scope.workspace_id} AND c.project_id = ${scope.project_id}
        AND ${visibleSessionProject(this.db, scope, scope.read_restricted === true)}
    `;
    return row && toCheckpoint(row);
  }

  async updateHandoff(
    input: ClaimHandoffInput,
    transition: (current: Handoff) => Handoff,
  ): Promise<Handoff> {
    return this.transaction(async (tx) => {
      await lockSessionProject(tx, input);
      const [row] = await tx<HandoffRow[]>`
        SELECT h.* FROM wcp_session_handoffs h JOIN wcp_session_checkpoints c ON c.checkpoint_id = h.checkpoint_id
          AND c.tenant_id = h.tenant_id AND c.workspace_id = h.workspace_id AND c.project_id = h.project_id
        JOIN wcp_sessions s ON s.session_id = c.session_id AND s.tenant_id = c.tenant_id
          AND s.workspace_id = c.workspace_id AND s.project_id = c.project_id
        WHERE h.handoff_id = ${input.handoff_id} AND h.tenant_id = ${input.tenant_id}
          AND h.workspace_id = ${input.workspace_id} AND h.project_id = ${input.project_id}
        FOR UPDATE OF h
      `;
      if (!row)
        throw new ContractError('HANDOFF_NOT_FOUND', 'Handoff does not exist in this project', {
          trace_id: input.trace_id,
        });
      const current = toHandoff(row);
      const next = transition(current);
      if (next.version !== current.version) {
        await tx`
          UPDATE wcp_session_handoffs SET status = ${next.status}, claimed_by = ${next.claimed_by ?? null},
            claimed_by_actor = ${next.claimed_by_actor ?? null}, version = ${next.version}, trace_id = ${next.trace_id}, updated_at = now()
          WHERE handoff_id = ${current.handoff_id}
        `;
      }
      return next;
    });
  }

  async findHandoff(
    id: Handoff['handoff_id'],
    scope: SessionScope & { read_restricted?: boolean },
  ): Promise<Handoff | undefined> {
    const [row] = await this.db<HandoffRow[]>`
      SELECT h.* FROM wcp_session_handoffs h JOIN wcp_session_checkpoints c ON c.checkpoint_id = h.checkpoint_id
        AND c.tenant_id = h.tenant_id AND c.workspace_id = h.workspace_id AND c.project_id = h.project_id
      JOIN wcp_sessions s ON s.session_id = c.session_id AND s.tenant_id = c.tenant_id
        AND s.workspace_id = c.workspace_id AND s.project_id = c.project_id
      WHERE h.handoff_id = ${id} AND h.tenant_id = ${scope.tenant_id}
        AND h.workspace_id = ${scope.workspace_id} AND h.project_id = ${scope.project_id}
        AND ${visibleSessionProject(this.db, scope, scope.read_restricted === true)}
    `;
    return row && toHandoff(row);
  }

  async createHandoffWithReceipt(
    input: CreateHandoffReceiptInput,
    candidate: Handoff,
  ): Promise<HandoffCreateCommit> {
    try {
      return await this.transaction(async (tx) => {
        const [project] = await tx<{ id: string }[]>`SELECT id FROM wcp_projects
          WHERE id = ${input.project_id} AND tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id}
            AND deleted_at IS NULL AND classification IN ('public', 'internal', 'confidential', 'restricted')
            AND (${input.read_restricted === true} OR classification <> 'restricted') FOR SHARE`;
        if (!project)
          throw new ContractError(
            'CHECKPOINT_NOT_FOUND',
            'Checkpoint is unavailable in this project',
            { trace_id: input.trace_id },
          );
        // Preserve the legacy client/key uniqueness boundary, including across different actors.
        const lock = JSON.stringify([
          'handoff.create',
          input.tenant_id,
          input.workspace_id,
          input.project_id,
          input.from_client,
          input.idempotency_key,
        ]);
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
        const [checkpoint] = await tx<{ checkpoint_id: string }[]>`SELECT c.checkpoint_id
          FROM wcp_session_checkpoints c JOIN wcp_sessions s ON s.session_id = c.session_id
            AND s.tenant_id = c.tenant_id AND s.workspace_id = c.workspace_id AND s.project_id = c.project_id
          WHERE c.checkpoint_id = ${input.checkpoint_id} AND c.session_id = ${input.session_id}
            AND c.tenant_id = ${input.tenant_id} AND c.workspace_id = ${input.workspace_id}
            AND c.project_id = ${input.project_id} FOR SHARE OF c, s`;
        if (!checkpoint)
          throw new ContractError(
            'CHECKPOINT_NOT_FOUND',
            'Checkpoint is unavailable in this session',
            { trace_id: input.trace_id },
          );
        const [previous] = await tx<
          {
            handoff_id: string;
            session_id: string;
            checkpoint_id: string;
            request_fingerprint: string;
            response_document: unknown;
          }[]
        >`SELECT handoff_id, session_id, checkpoint_id, request_fingerprint, response_document
          FROM wcp_handoff_create_commands WHERE tenant_id = ${input.tenant_id}
            AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id}
            AND request_key = ${input.receipt.key}`;
        const command = {
          checkpoint_id: input.checkpoint_id,
          ...(input.target_client === undefined ? {} : { target_client: input.target_client }),
        };
        const identity = { actor_id: input.actor_id, client_id: input.from_client };
        if (previous) {
          if (
            previous.request_fingerprint !== input.receipt.fingerprint ||
            previous.session_id !== input.session_id ||
            previous.checkpoint_id !== input.checkpoint_id
          )
            throw new ContractError(
              'IDEMPOTENCY_KEY_REUSED',
              'Key belongs to another handoff creation',
              { trace_id: input.trace_id },
            );
          const receipt = parseHandoffCreateReceiptLookup(
            previous.response_document,
            input.session_id,
            command,
            identity,
          );
          if (receipt.status !== 'recorded' || receipt.handoff_id !== previous.handoff_id)
            throw new TypeError();
          const [row] = await tx<HandoffRow[]>`SELECT * FROM wcp_session_handoffs
            WHERE handoff_id = ${previous.handoff_id} AND tenant_id = ${input.tenant_id}
              AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id} FOR SHARE`;
          if (!row || row.idempotency_key !== input.idempotency_key) throw new TypeError();
          const handoff = toHandoff(row);
          assertHandoffCreationCurrent(handoff, receipt, input);
          return { handoff, receipt };
        }
        const [legacy] = await tx<
          { handoff_id: string }[]
        >`SELECT handoff_id FROM wcp_session_handoffs
          WHERE tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id}
            AND project_id = ${input.project_id} AND from_client = ${input.from_client}
            AND idempotency_key = ${input.idempotency_key}`;
        if (legacy)
          throw new ContractError(
            'HANDOFF_CREATE_LEGACY_UNVERIFIED',
            'This client/key already has a handoff without a matching actor-bound creation receipt. Retain the original request for review.',
            { trace_id: input.trace_id },
          );
        const receipt = parseHandoffCreateReceiptLookup(
          {
            status: 'recorded',
            handoff_id: candidate.handoff_id,
            session_id: input.session_id,
            checkpoint_id: input.checkpoint_id,
            from_client: input.from_client,
            created_by_actor: input.actor_id,
            handoff_version: 1,
            ...(input.target_client === undefined ? {} : { target_client: input.target_client }),
          },
          input.session_id,
          command,
          identity,
        );
        if (receipt.status !== 'recorded') throw new TypeError();
        assertHandoffCreationCurrent(candidate, receipt, input);
        if (candidate.version !== 1 || candidate.status !== 'open') throw new TypeError();
        const inserted = await tx<{ handoff_id: string }[]>`INSERT INTO wcp_session_handoffs
          (handoff_id, tenant_id, workspace_id, project_id, checkpoint_id, from_client, target_client,
            status, version, trace_id, source_refs, idempotency_key)
          VALUES (${candidate.handoff_id}, ${input.tenant_id}, ${input.workspace_id}, ${input.project_id},
            ${input.checkpoint_id}, ${input.from_client}, ${input.target_client ?? null}, 'open', 1,
            ${input.trace_id}, ${JSON.stringify(candidate.source_refs)}::jsonb, ${input.idempotency_key})
          ON CONFLICT DO NOTHING RETURNING handoff_id`;
        if (inserted.length !== 1)
          throw new ContractError(
            'HANDOFF_CREATE_LEGACY_UNVERIFIED',
            'A concurrent handoff creation cannot be attributed to this original request',
            { trace_id: input.trace_id },
          );
        await tx`INSERT INTO wcp_handoff_create_commands
          (tenant_id, workspace_id, project_id, request_key, request_fingerprint, session_id, checkpoint_id, handoff_id, response_document)
          VALUES (${input.tenant_id}, ${input.workspace_id}, ${input.project_id}, ${input.receipt.key},
            ${input.receipt.fingerprint}, ${input.session_id}, ${input.checkpoint_id}, ${candidate.handoff_id}, ${JSON.stringify(receipt)}::jsonb)`;
        return { handoff: candidate, receipt };
      });
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError)
        throw new ContractError('SESSION_RECEIPT_INVALID', 'Stored handoff creation is invalid', {
          trace_id: input.trace_id,
        });
      throw new ContractError(
        'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
        'Handoff creation receipt storage is unavailable',
        {
          trace_id: input.trace_id,
          retryable: true,
        },
      );
    }
  }

  async claimHandoffWithReceipt(
    input: ClaimHandoffReceiptInput,
    transition: (current: Handoff) => Handoff,
  ): Promise<HandoffClaimCommit> {
    try {
      return await this.transaction(async (tx) => {
        const [project] = await tx<{ id: string }[]>`SELECT id FROM wcp_projects
          WHERE id = ${input.project_id} AND tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id}
            AND deleted_at IS NULL AND classification IN ('public', 'internal', 'confidential', 'restricted')
            AND (${input.read_restricted === true} OR classification <> 'restricted') FOR SHARE`;
        if (!project)
          throw new ContractError('HANDOFF_NOT_FOUND', 'Handoff is unavailable in this project', {
            trace_id: input.trace_id,
          });
        // A key cannot race to claim different handoffs in the same identity and scope.
        const lock = JSON.stringify([
          'handoff.claim',
          input.tenant_id,
          input.workspace_id,
          input.project_id,
          input.receipt.key,
        ]);
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
        const [row] = await tx<(HandoffRow & { session_id: string })[]>`SELECT h.*, c.session_id
          FROM wcp_session_handoffs h JOIN wcp_session_checkpoints c ON c.checkpoint_id = h.checkpoint_id
            AND c.tenant_id = h.tenant_id AND c.workspace_id = h.workspace_id AND c.project_id = h.project_id
          JOIN wcp_sessions s ON s.session_id = c.session_id AND s.tenant_id = c.tenant_id
            AND s.workspace_id = c.workspace_id AND s.project_id = c.project_id
          WHERE h.handoff_id = ${input.handoff_id} AND h.tenant_id = ${input.tenant_id}
            AND h.workspace_id = ${input.workspace_id} AND h.project_id = ${input.project_id} FOR UPDATE OF h`;
        if (!row)
          throw new ContractError('HANDOFF_NOT_FOUND', 'Handoff does not exist in this project', {
            trace_id: input.trace_id,
          });
        const current = toHandoff(row);
        const [previous] = await tx<
          { handoff_id: string; request_fingerprint: string; response_document: unknown }[]
        >`
          SELECT handoff_id, request_fingerprint, response_document FROM wcp_handoff_claim_commands
          WHERE tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id}
            AND project_id = ${input.project_id} AND request_key = ${input.receipt.key}`;
        if (previous) {
          if (
            previous.handoff_id !== input.handoff_id ||
            previous.request_fingerprint !== input.receipt.fingerprint
          )
            throw new ContractError(
              'IDEMPOTENCY_KEY_REUSED',
              'Key belongs to another handoff claim',
              { trace_id: input.trace_id },
            );
          const receipt = parseHandoffClaimReceiptLookup(
            previous.response_document,
            input.handoff_id,
            input.expected_version,
            input,
          );
          if (
            receipt.status !== 'recorded' ||
            receipt.session_id !== row.session_id ||
            receipt.checkpoint_id !== current.checkpoint_id ||
            !Number.isSafeInteger(current.version) ||
            current.version < receipt.handoff_version ||
            (current.version === receipt.handoff_version && current.status !== 'claimed') ||
            !['claimed', 'expired'].includes(current.status) ||
            current.claimed_by !== receipt.claimed_by ||
            current.claimed_by_actor !== receipt.claimed_by_actor
          )
            throw new TypeError('Current handoff does not match its claim history');
          return { handoff: current, receipt };
        }
        const next = transition(current);
        const receipt = parseHandoffClaimReceiptLookup(
          {
            status: 'recorded',
            handoff_id: next.handoff_id,
            checkpoint_id: next.checkpoint_id,
            session_id: row.session_id,
            expected_version: input.expected_version,
            handoff_version: next.version,
            claimed_by: next.claimed_by,
            claimed_by_actor: next.claimed_by_actor,
            changed: next.version !== current.version,
          },
          input.handoff_id,
          input.expected_version,
          input,
        );
        if (
          receipt.status !== 'recorded' ||
          next.status !== 'claimed' ||
          next.checkpoint_id !== current.checkpoint_id ||
          next.tenant_id !== current.tenant_id ||
          next.workspace_id !== current.workspace_id ||
          next.project_id !== current.project_id ||
          next.from_client !== current.from_client ||
          next.target_client !== current.target_client
        )
          throw new TypeError('Invalid handoff claim transition');
        if (receipt.changed) {
          const updated = await tx<{ handoff_id: string }[]>`UPDATE wcp_session_handoffs
            SET status = 'claimed', claimed_by = ${next.claimed_by!}, claimed_by_actor = ${next.claimed_by_actor!},
              version = ${next.version}, trace_id = ${input.trace_id}, updated_at = now()
            WHERE handoff_id = ${input.handoff_id} AND tenant_id = ${input.tenant_id}
              AND workspace_id = ${input.workspace_id} AND project_id = ${input.project_id} AND version = ${current.version}
            RETURNING handoff_id`;
          if (updated.length !== 1)
            throw new ContractError('HANDOFF_VERSION_CONFLICT', 'Handoff changed before commit', {
              trace_id: input.trace_id,
            });
        }
        await tx`INSERT INTO wcp_handoff_claim_commands
          (tenant_id, workspace_id, project_id, request_key, request_fingerprint, handoff_id, response_document)
          VALUES (${input.tenant_id}, ${input.workspace_id}, ${input.project_id}, ${input.receipt.key},
            ${input.receipt.fingerprint}, ${input.handoff_id}, ${JSON.stringify(receipt)}::jsonb)`;
        return { handoff: next, receipt };
      });
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError)
        throw new ContractError('SESSION_RECEIPT_INVALID', 'Stored handoff claim is invalid', {
          trace_id: input.trace_id,
        });
      throw new ContractError(
        'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
        'Handoff claim receipt storage is unavailable',
        { trace_id: input.trace_id, retryable: true },
      );
    }
  }

  async saveHandoff(handoff: Handoff, idempotency_key?: string): Promise<Handoff> {
    const [inserted] = await this.db<HandoffRow[]>`
      INSERT INTO wcp_session_handoffs
        (handoff_id, tenant_id, workspace_id, project_id, checkpoint_id, from_client,
         target_client, status, claimed_by, claimed_by_actor, version, trace_id, source_refs, idempotency_key)
      VALUES
        (${handoff.handoff_id}, ${handoff.tenant_id}, ${handoff.workspace_id}, ${handoff.project_id},
         ${handoff.checkpoint_id}, ${handoff.from_client}, ${handoff.target_client ?? null},
         ${handoff.status}, ${handoff.claimed_by ?? null}, ${handoff.claimed_by_actor ?? null}, ${handoff.version}, ${handoff.trace_id},
         ${JSON.stringify(handoff.source_refs)}::jsonb, ${idempotency_key ?? null})
      ON CONFLICT DO NOTHING RETURNING *
    `;
    if (inserted) return toHandoff(inserted);
    if (idempotency_key !== undefined) {
      const [existing] = await this.db<HandoffRow[]>`
        SELECT * FROM wcp_session_handoffs WHERE tenant_id = ${handoff.tenant_id}
          AND workspace_id = ${handoff.workspace_id} AND project_id = ${handoff.project_id}
          AND from_client = ${handoff.from_client} AND idempotency_key = ${idempotency_key}
      `;
      if (existing) return toHandoff(existing);
      throw new ContractError('HANDOFF_VERSION_CONFLICT', 'Handoff identifier already exists', {
        trace_id: handoff.trace_id,
      });
    }
    return this.updateHandoff(
      { ...handoff, client_id: handoff.claimed_by ?? handoff.from_client },
      (current) => {
        if (
          current.checkpoint_id === handoff.checkpoint_id &&
          current.from_client === handoff.from_client &&
          current.target_client === handoff.target_client
        ) {
          if (
            current.status === handoff.status &&
            current.version === handoff.version &&
            current.claimed_by === handoff.claimed_by &&
            current.claimed_by_actor === handoff.claimed_by_actor
          )
            return current;
          if (
            current.status === 'open' &&
            handoff.status === 'claimed' &&
            handoff.claimed_by &&
            (!current.target_client || current.target_client === handoff.claimed_by) &&
            current.version + 1 === handoff.version
          )
            return handoff;
        }
        throw new ContractError('HANDOFF_VERSION_CONFLICT', 'Durable handoff has changed', {
          trace_id: handoff.trace_id,
        });
      },
    );
  }
}

interface SessionRow {
  session_id: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  client_id: string;
  actor_id: string;
  parent_session_id: string | null;
  resume_origin: unknown;
  status: Session['status'];
  version: number | string;
  trace_id: string;
  source_refs: unknown;
  started_at: string;
  ended_at: string | null;
  idempotency_key: string | null;
}

interface RunRow {
  run_id: string;
  session_id: string;
  sequence_no: number | string;
  model: string | null;
  status: AgentRun['status'];
  version: number | string;
  trace_id: string;
  source_refs: unknown;
}

interface ToolCallRow {
  tool_call_id: string;
  session_id: string;
  run_id: string;
  tool_name: string;
  status: ToolCall['status'];
  version: number | string;
  trace_id: string;
  source_refs: unknown;
}

interface CheckpointRow {
  checkpoint_id: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  session_id: string;
  revision: number | string;
  completed: unknown;
  in_progress: unknown;
  next_actions: unknown;
  decisions: unknown;
  risks: unknown;
  open_questions: unknown;
  state_hash: string;
  context_pack_hash: string | null;
  context_pack_id: string | null;
  memory_ref: unknown;
  trace_id: string;
  source_refs: unknown;
}

interface HandoffRow {
  handoff_id: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  checkpoint_id: string;
  from_client: string;
  target_client: string | null;
  status: Handoff['status'];
  claimed_by: string | null;
  claimed_by_actor: string | null;
  version: number | string;
  trace_id: string;
  source_refs: unknown;
  idempotency_key: string | null;
}

function toSession(row: SessionRow): Session {
  return {
    schema_version: 1,
    tenant_id: row.tenant_id as Session['tenant_id'],
    workspace_id: row.workspace_id as Session['workspace_id'],
    project_id: row.project_id as Session['project_id'],
    session_id: row.session_id as Session['session_id'],
    client_id: row.client_id,
    actor_id: row.actor_id,
    ...(row.parent_session_id === null
      ? {}
      : { parent_session_id: row.parent_session_id as Session['session_id'] }),
    ...(row.resume_origin == null
      ? {}
      : { resume_origin: parseSessionResumeOrigin(row.resume_origin) }),
    status: row.status,
    version: Number(row.version),
    started_at: normalizeTimestamp(row.started_at),
    ...(row.ended_at === null ? {} : { ended_at: normalizeTimestamp(row.ended_at) }),
    trace_id: row.trace_id,
    source_refs: parseJson(row.source_refs),
  };
}

function toRun(row: RunRow): AgentRun {
  return {
    schema_version: 1,
    run_id: row.run_id as AgentRun['run_id'],
    session_id: row.session_id as AgentRun['session_id'],
    sequence: Number(row.sequence_no),
    ...(row.model === null ? {} : { model: row.model }),
    status: row.status,
    version: Number(row.version),
    trace_id: row.trace_id,
    source_refs: parseJson(row.source_refs),
  };
}

function toToolCall(row: ToolCallRow): ToolCall {
  return {
    schema_version: 1,
    tool_call_id: row.tool_call_id as ToolCall['tool_call_id'],
    session_id: row.session_id as ToolCall['session_id'],
    run_id: row.run_id as ToolCall['run_id'],
    tool_name: row.tool_name,
    status: row.status,
    version: Number(row.version),
    trace_id: row.trace_id,
    source_refs: parseJson(row.source_refs),
  };
}

function toCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    schema_version: 1,
    tenant_id: row.tenant_id as Checkpoint['tenant_id'],
    workspace_id: row.workspace_id as Checkpoint['workspace_id'],
    project_id: row.project_id as Checkpoint['project_id'],
    checkpoint_id: row.checkpoint_id as Checkpoint['checkpoint_id'],
    session_id: row.session_id as Checkpoint['session_id'],
    revision: Number(row.revision),
    completed: parseJson(row.completed),
    in_progress: parseJson(row.in_progress),
    next_actions: parseJson(row.next_actions),
    decisions: parseJson(row.decisions),
    risks: parseJson(row.risks),
    open_questions: parseJson(row.open_questions),
    state_hash: row.state_hash,
    ...(row.context_pack_hash === null ? {} : { context_pack_hash: row.context_pack_hash }),
    ...(row.context_pack_id == null ? {} : { context_pack_id: row.context_pack_id }),
    ...(row.memory_ref === null ? {} : { memory_ref: parseJson<MemoryRef>(row.memory_ref) }),
    trace_id: row.trace_id,
    source_refs: parseJson(row.source_refs),
  };
}

function toHandoff(row: HandoffRow): Handoff {
  return {
    schema_version: 1,
    tenant_id: row.tenant_id as Handoff['tenant_id'],
    workspace_id: row.workspace_id as Handoff['workspace_id'],
    project_id: row.project_id as Handoff['project_id'],
    handoff_id: row.handoff_id as Handoff['handoff_id'],
    checkpoint_id: row.checkpoint_id as Handoff['checkpoint_id'],
    from_client: row.from_client,
    ...(row.target_client === null ? {} : { target_client: row.target_client }),
    status: row.status,
    ...(row.claimed_by === null ? {} : { claimed_by: row.claimed_by }),
    ...(row.claimed_by_actor === null ? {} : { claimed_by_actor: row.claimed_by_actor }),
    version: Number(row.version),
    trace_id: row.trace_id,
    source_refs: parseJson(row.source_refs),
  };
}

function parseJson<T>(value: unknown): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);
}

function normalizeTimestamp(value: string): string {
  return value.endsWith('+00') ? `${value.slice(0, -3)}Z` : value;
}
