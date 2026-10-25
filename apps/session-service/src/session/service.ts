import { ContractError, createUlid, type SourceRef, type Ulid } from '@planemem/contracts';

export interface SessionScope {
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
}

export type SessionStatus = 'running' | 'paused' | 'ended' | 'abandoned' | 'failed';

export interface Session extends SessionScope {
  schema_version: 1;
  session_id: Ulid;
  client_id: string;
  actor_id: string;
  parent_session_id?: Ulid;
  status: SessionStatus;
  version: number;
  started_at: string;
  ended_at?: string;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface AgentRun {
  schema_version: 1;
  run_id: Ulid;
  session_id: Ulid;
  sequence: number;
  model?: string;
  status: 'running' | 'completed' | 'failed';
  version: number;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface ToolCall {
  schema_version: 1;
  tool_call_id: Ulid;
  session_id: Ulid;
  run_id: Ulid;
  tool_name: string;
  status: 'started' | 'succeeded' | 'failed';
  version: number;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface StartSessionInput extends SessionScope {
  client_id: string;
  actor_id: string;
  parent_session_id?: Ulid;
  trace_id: string;
  idempotency_key: string;
}

export interface SessionStoreSnapshot {
  sessions: Array<{ session: Session; idempotency_key?: string }>;
  runs: AgentRun[];
  tool_calls: ToolCall[];
}

/** Durable boundary for the session aggregate. The default service remains in-memory for unit tests. */
export interface SessionStore {
  loadSessions(): Promise<SessionStoreSnapshot>;
  saveSession(session: Session, idempotency_key?: string): Promise<void>;
  saveRun(run: AgentRun): Promise<void>;
  saveToolCall(toolCall: ToolCall): Promise<void>;
}

export class SessionService {
  private readonly sessions = new Map<string, Session>();
  private readonly runs = new Map<string, AgentRun>();
  private readonly toolCalls = new Map<string, ToolCall>();
  private readonly idempotency = new Map<string, Session>();

  constructor(private readonly store?: SessionStore) {}

  async hydrate(): Promise<void> {
    if (!this.store) return;
    const snapshot = await this.store.loadSessions();
    this.sessions.clear();
    this.runs.clear();
    this.toolCalls.clear();
    this.idempotency.clear();
    for (const row of snapshot.sessions) {
      const session = cloneSession(row.session);
      this.sessions.set(String(session.session_id), session);
      if (row.idempotency_key !== undefined) this.idempotency.set(row.idempotency_key, session);
    }
    for (const run of snapshot.runs) this.runs.set(String(run.run_id), cloneAgentRun(run));
    for (const toolCall of snapshot.tool_calls)
      this.toolCalls.set(String(toolCall.tool_call_id), cloneToolCall(toolCall));
  }

  health(): {
    service: 'session-service';
    version: '0.1.0';
    status: 'ok';
    ready: true;
    metrics: { sessions: number; runs: number; tool_calls: number };
  } {
    return {
      service: 'session-service',
      version: '0.1.0',
      status: 'ok',
      ready: true,
      metrics: {
        sessions: this.sessions.size,
        runs: this.runs.size,
        tool_calls: this.toolCalls.size,
      },
    };
  }

  startSession(input: StartSessionInput): Session {
    const previous = this.idempotency.get(input.idempotency_key);
    if (previous !== undefined) return { ...previous, source_refs: [...previous.source_refs] };
    if (input.parent_session_id !== undefined) this.getSession(input.parent_session_id, input);
    const session: Session = {
      schema_version: 1,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      session_id: createUlid(),
      client_id: input.client_id,
      actor_id: input.actor_id,
      ...(input.parent_session_id === undefined
        ? {}
        : { parent_session_id: input.parent_session_id }),
      status: 'running',
      version: 1,
      started_at: new Date().toISOString(),
      trace_id: input.trace_id,
      source_refs: [{ type: 'session', id: input.client_id }],
    };
    this.sessions.set(String(session.session_id), session);
    this.idempotency.set(input.idempotency_key, session);
    return { ...session, source_refs: [...session.source_refs] };
  }

  async startSessionAsync(input: StartSessionInput): Promise<Session> {
    const previous = this.idempotency.get(input.idempotency_key);
    if (previous !== undefined) return cloneSession(previous);
    const session = this.startSession(input);
    await this.store?.saveSession(session, input.idempotency_key);
    return session;
  }

  appendAgentRun(
    input: SessionScope & {
      session_id: Ulid;
      model?: string;
      trace_id: string;
      expected_version: number;
    },
  ): AgentRun {
    const session = this.requireRunning(input.session_id, input);
    this.checkVersion(session.version, input.expected_version, session.trace_id);
    const run: AgentRun = {
      schema_version: 1,
      run_id: createUlid(),
      session_id: session.session_id,
      sequence:
        [...this.runs.values()].filter((candidate) => candidate.session_id === session.session_id)
          .length + 1,
      ...(input.model === undefined ? {} : { model: input.model }),
      status: 'running',
      version: 1,
      trace_id: input.trace_id,
      source_refs: [{ type: 'session', id: String(session.session_id) }],
    };
    this.runs.set(String(run.run_id), run);
    session.version += 1;
    return { ...run, source_refs: [...run.source_refs] };
  }

  async appendAgentRunAsync(
    input: SessionScope & {
      session_id: Ulid;
      model?: string;
      trace_id: string;
      expected_version: number;
    },
  ): Promise<AgentRun> {
    const run = this.appendAgentRun(input);
    await this.store?.saveSession(this.sessions.get(String(input.session_id))!, undefined);
    await this.store?.saveRun(run);
    return run;
  }

  recordToolCall(
    input: SessionScope & {
      session_id: Ulid;
      run_id: Ulid;
      tool_name: string;
      status: ToolCall['status'];
      trace_id: string;
      expected_version: number;
    },
  ): ToolCall {
    const session = this.requireRunning(input.session_id, input);
    const run = this.runs.get(String(input.run_id));
    if (!run || run.session_id !== session.session_id)
      throw new ContractError('RUN_NOT_FOUND', 'Agent run does not exist in this session', {
        run_id: input.run_id,
        trace_id: input.trace_id,
        retryable: false,
      });
    this.checkVersion(session.version, input.expected_version, input.trace_id);
    const toolCall: ToolCall = {
      schema_version: 1,
      tool_call_id: createUlid(),
      session_id: session.session_id,
      run_id: run.run_id,
      tool_name: input.tool_name,
      status: input.status,
      version: 1,
      trace_id: input.trace_id,
      source_refs: [{ type: 'agent-run', id: String(run.run_id) }],
    };
    this.toolCalls.set(String(toolCall.tool_call_id), toolCall);
    session.version += 1;
    return { ...toolCall, source_refs: [...toolCall.source_refs] };
  }

  async recordToolCallAsync(
    input: SessionScope & {
      session_id: Ulid;
      run_id: Ulid;
      tool_name: string;
      status: ToolCall['status'];
      trace_id: string;
      expected_version: number;
    },
  ): Promise<ToolCall> {
    const toolCall = this.recordToolCall(input);
    await this.store?.saveSession(this.sessions.get(String(input.session_id))!, undefined);
    await this.store?.saveToolCall(toolCall);
    return toolCall;
  }

  endSession(
    input: SessionScope & {
      session_id: Ulid;
      status: 'ended' | 'abandoned' | 'failed';
      trace_id: string;
      expected_version: number;
    },
  ): Session {
    const session = this.getStoredSession(input.session_id, input);
    if (session.status === input.status)
      return { ...session, source_refs: [...session.source_refs] };
    if (session.status !== 'running' && session.status !== 'paused')
      throw new ContractError(
        'SESSION_STATE_CONFLICT',
        'Session cannot be ended from its current state',
        { current_status: session.status, trace_id: input.trace_id, retryable: false },
      );
    this.checkVersion(session.version, input.expected_version, input.trace_id);
    session.status = input.status;
    session.version += 1;
    session.ended_at = new Date().toISOString();
    session.trace_id = input.trace_id;
    return { ...session, source_refs: [...session.source_refs] };
  }

  async endSessionAsync(
    input: SessionScope & {
      session_id: Ulid;
      status: 'ended' | 'abandoned' | 'failed';
      trace_id: string;
      expected_version: number;
    },
  ): Promise<Session> {
    const session = this.endSession(input);
    await this.store?.saveSession(session, undefined);
    return session;
  }

  getSession(session_id: Ulid, scope: SessionScope & { trace_id?: string }): Session {
    const session = this.getStoredSession(session_id, scope);
    return { ...session, source_refs: [...session.source_refs] };
  }

  private getStoredSession(session_id: Ulid, scope: SessionScope & { trace_id?: string }): Session {
    const session = this.sessions.get(String(session_id));
    if (!session)
      throw new ContractError('SESSION_NOT_FOUND', 'Session does not exist', {
        session_id,
        trace_id: scope.trace_id ?? 'trace_session_unknown',
        retryable: false,
      });
    if (
      session.tenant_id !== scope.tenant_id ||
      session.workspace_id !== scope.workspace_id ||
      session.project_id !== scope.project_id
    )
      throw new ContractError('SESSION_ACCESS_DENIED', 'Session scope is not authorized', {
        session_id,
        trace_id: scope.trace_id ?? 'trace_session_denied',
        retryable: false,
      });
    return session;
  }

  listRuns(session_id: Ulid, scope: SessionScope & { trace_id?: string }): AgentRun[] {
    this.getSession(session_id, scope);
    return [...this.runs.values()]
      .filter((run) => run.session_id === session_id)
      .map((run) => ({ ...run, source_refs: [...run.source_refs] }));
  }

  private requireRunning(session_id: Ulid, scope: SessionScope & { trace_id: string }): Session {
    const session = this.getStoredSession(session_id, scope);
    if (session.status !== 'running')
      throw new ContractError('SESSION_STATE_CONFLICT', 'Session is not running', {
        session_id,
        current_status: session.status,
        trace_id: scope.trace_id,
        retryable: false,
      });
    return session;
  }

  private checkVersion(current: number, expected: number, trace_id: string): void {
    if (current !== expected)
      throw new ContractError('SESSION_VERSION_CONFLICT', 'Session version does not match', {
        current_version: current,
        expected_version: expected,
        trace_id,
        retryable: false,
      });
  }
}

function cloneSession(session: Session): Session {
  return { ...session, source_refs: [...session.source_refs] };
}

function cloneAgentRun(run: AgentRun): AgentRun {
  return { ...run, source_refs: [...run.source_refs] };
}

function cloneToolCall(toolCall: ToolCall): ToolCall {
  return { ...toolCall, source_refs: [...toolCall.source_refs] };
}
