import type {
  AgentRun,
  Session,
  SessionStore,
  SessionStoreSnapshot,
  ToolCall,
} from '@planemem/session-service';
import type {
  Checkpoint,
  ContinuationStore,
  ContinuationStoreSnapshot,
  Handoff,
} from '@planemem/session-service';
import type { MemoryRef } from '@planemem/domain';
import { ContractError } from '@planemem/contracts';
import postgres from 'postgres';

type Sql = ReturnType<typeof postgres> | postgres.TransactionSql;

/** PostgreSQL adapter for PlaneMem session continuity. The session-service owns the domain rules. */
export class PostgresSessionStore implements SessionStore, ContinuationStore {
  constructor(private readonly db: Sql) {}

  async loadSessions(): Promise<SessionStoreSnapshot> {
    const sessions = await this.db<SessionRow[]>`
      SELECT session_id, tenant_id, workspace_id, project_id, client_id, actor_id,
             parent_session_id, status, version, trace_id, source_refs,
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

  async saveSession(session: Session, idempotency_key?: string): Promise<void> {
    const updated = await this.db<{ session_id: string }[]>`
      INSERT INTO wcp_sessions
        (session_id, tenant_id, workspace_id, project_id, client_id, actor_id,
         parent_session_id, status, version, trace_id, source_refs, started_at, ended_at,
         idempotency_key)
      VALUES
        (${session.session_id}, ${session.tenant_id}, ${session.workspace_id}, ${session.project_id},
         ${session.client_id}, ${session.actor_id}, ${session.parent_session_id ?? null},
         ${session.status}, ${session.version}, ${session.trace_id},
         ${JSON.stringify(session.source_refs)}::jsonb, ${session.started_at},
         ${session.ended_at ?? null}, ${idempotency_key ?? null})
      ON CONFLICT (session_id) DO UPDATE SET
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        trace_id = EXCLUDED.trace_id,
        source_refs = EXCLUDED.source_refs,
        ended_at = EXCLUDED.ended_at,
        idempotency_key = COALESCE(EXCLUDED.idempotency_key, wcp_sessions.idempotency_key)
      WHERE wcp_sessions.version <= EXCLUDED.version
      RETURNING session_id
    `;
    if (updated.length === 0)
      throw new ContractError('SESSION_VERSION_CONFLICT', 'Durable session version is newer', {
        session_id: session.session_id,
        expected_version: session.version,
        trace_id: session.trace_id,
        retryable: true,
      });
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
             state_hash, context_pack_hash, memory_ref, trace_id, source_refs
      FROM wcp_session_checkpoints
      ORDER BY session_id, revision, checkpoint_id
    `;
    const handoffs = await this.db<HandoffRow[]>`
      SELECT handoff_id, tenant_id, workspace_id, project_id, checkpoint_id, from_client,
             target_client, status, claimed_by, version, trace_id, source_refs, idempotency_key
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

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    await this.db`
      INSERT INTO wcp_session_checkpoints
        (checkpoint_id, tenant_id, workspace_id, project_id, session_id, revision,
         completed, in_progress, next_actions, decisions, risks, open_questions,
         state_hash, context_pack_hash, memory_ref, trace_id, source_refs)
      VALUES
        (${checkpoint.checkpoint_id}, ${checkpoint.tenant_id}, ${checkpoint.workspace_id},
         ${checkpoint.project_id}, ${checkpoint.session_id}, ${checkpoint.revision},
         ${JSON.stringify(checkpoint.completed)}::jsonb, ${JSON.stringify(checkpoint.in_progress)}::jsonb,
         ${JSON.stringify(checkpoint.next_actions)}::jsonb, ${JSON.stringify(checkpoint.decisions)}::jsonb,
         ${JSON.stringify(checkpoint.risks)}::jsonb, ${JSON.stringify(checkpoint.open_questions)}::jsonb,
         ${checkpoint.state_hash}, ${checkpoint.context_pack_hash ?? null},
         ${checkpoint.memory_ref === undefined ? null : JSON.stringify(checkpoint.memory_ref)}::jsonb,
         ${checkpoint.trace_id}, ${JSON.stringify(checkpoint.source_refs)}::jsonb)
      ON CONFLICT (checkpoint_id) DO UPDATE SET
        trace_id = EXCLUDED.trace_id,
        source_refs = EXCLUDED.source_refs
    `;
  }

  async saveHandoff(handoff: Handoff, idempotency_key?: string): Promise<void> {
    const updated = await this.db<{ handoff_id: string }[]>`
      INSERT INTO wcp_session_handoffs
        (handoff_id, tenant_id, workspace_id, project_id, checkpoint_id, from_client,
         target_client, status, claimed_by, version, trace_id, source_refs, idempotency_key)
      VALUES
        (${handoff.handoff_id}, ${handoff.tenant_id}, ${handoff.workspace_id}, ${handoff.project_id},
         ${handoff.checkpoint_id}, ${handoff.from_client}, ${handoff.target_client ?? null},
         ${handoff.status}, ${handoff.claimed_by ?? null}, ${handoff.version}, ${handoff.trace_id},
         ${JSON.stringify(handoff.source_refs)}::jsonb, ${idempotency_key ?? null})
      ON CONFLICT (handoff_id) DO UPDATE SET
        status = EXCLUDED.status,
        claimed_by = EXCLUDED.claimed_by,
        version = EXCLUDED.version,
        trace_id = EXCLUDED.trace_id,
        source_refs = EXCLUDED.source_refs,
        idempotency_key = COALESCE(EXCLUDED.idempotency_key, wcp_session_handoffs.idempotency_key)
      WHERE
        (wcp_session_handoffs.status = 'open' AND EXCLUDED.status = 'claimed'
          AND wcp_session_handoffs.version + 1 = EXCLUDED.version)
        OR (wcp_session_handoffs.status = EXCLUDED.status
          AND wcp_session_handoffs.version <= EXCLUDED.version)
      RETURNING handoff_id
    `;
    if (updated.length === 0)
      throw new ContractError('HANDOFF_VERSION_CONFLICT', 'Durable handoff version is newer', {
        handoff_id: handoff.handoff_id,
        expected_version: handoff.version,
        trace_id: handoff.trace_id,
        retryable: true,
      });
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
