import {
  ContractError,
  createUlid,
  parseSessionResumeOrigin,
  parseSessionStartReceiptLookup,
  assertSessionStartCurrent,
  type SessionStartRecorded,
  type SessionResumeOrigin,
  type SourceRef,
  type Ulid,
} from '@planemem/contracts';
import {
  prepareSessionMutation,
  type AppendAgentRunInput,
  type FinishAgentRunInput,
  type RecordToolCallInput,
  type FinishToolCallInput,
  type EndSessionInput,
  type SessionMutationCommand,
  type SessionMutationState,
  type SessionMutationResult,
  type SessionMutationCommit,
} from './mutations.js';

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
  resume_origin?: SessionResumeOrigin;
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
  /** Version of the session after the original command; not the current live version. */
  session_version?: number;
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
  session_version?: number;
  trace_id: string;
  source_refs: SourceRef[];
}

export interface StartSessionInput extends SessionScope {
  client_id: string;
  actor_id: string;
  parent_session_id?: Ulid;
  resume_origin?: SessionResumeOrigin;
  trace_id: string;
  idempotency_key: string;
}

export interface SessionStoreSnapshot {
  sessions: Array<{ session: Session; idempotency_key?: string }>;
  runs: AgentRun[];
  tool_calls: ToolCall[];
}

export interface StartSessionReceiptInput extends Omit<StartSessionInput, 'resume_origin'> {
  receipt: { key: string; fingerprint: string };
  read_restricted: boolean;
}
export interface SessionStartCommit {
  session: Session;
  receipt: SessionStartRecorded;
}

/** Durable boundary for the session aggregate. The default service remains in-memory for unit tests. */
export interface SessionStore {
  startSessionWithReceipt?(
    input: StartSessionReceiptInput,
    candidate: Session,
  ): Promise<SessionStartCommit>;
  loadSessions(): Promise<SessionStoreSnapshot>;
  saveSession(session: Session, idempotency_key?: string): Promise<Session | void>;
  findSession?(id: Ulid, scope: SessionScope): Promise<Session | undefined>;
  saveRun(run: AgentRun): Promise<void>;
  saveToolCall(toolCall: ToolCall): Promise<void>;
  mutateSession?(
    command: SessionMutationCommand,
    prepare: (state: SessionMutationState) => SessionMutationResult,
  ): Promise<SessionMutationCommit>;
}

export class SessionService {
  private readonly sessions = new Map<string, Session>();
  private readonly runs = new Map<string, AgentRun>();
  private readonly toolCalls = new Map<string, ToolCall>();
  private readonly idempotency = new Map<string, Session>();
  private readonly pendingStarts = new Map<string, Promise<Session>>();
  private readonly mutationReceipts = new Map<
    string,
    { fingerprint: string; result: SessionMutationResult }
  >();

  constructor(private readonly store?: SessionStore) {}

  async hydrate(): Promise<void> {
    if (!this.store) return;
    const snapshot = await this.store.loadSessions();
    this.sessions.clear();
    this.runs.clear();
    this.toolCalls.clear();
    this.idempotency.clear();
    this.mutationReceipts.clear();
    for (const row of snapshot.sessions) {
      const session = cloneSession(row.session);
      this.sessions.set(String(session.session_id), session);
      if (row.idempotency_key !== undefined)
        this.idempotency.set(startKey(session, row.idempotency_key), session);
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
    const key = startKey(input, input.idempotency_key);
    const previous = this.idempotency.get(key);
    if (previous) return this.replayStart(input, previous);
    return this.rememberSession(key, this.newSession(input));
  }

  /** Ordinary starts are durable commands; resume retains its separately bound path. */
  async startSessionWithReceiptAsync(input: StartSessionReceiptInput): Promise<SessionStartCommit> {
    if (!this.store?.startSessionWithReceipt)
      throw new ContractError(
        'SESSION_RECEIPT_STORAGE_UNAVAILABLE',
        'Session start receipt storage is unavailable',
        { trace_id: input.trace_id, retryable: true },
      );
    const candidate: Session = {
      schema_version: 1,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      session_id: createUlid(),
      actor_id: input.actor_id,
      client_id: input.client_id,
      ...(input.parent_session_id === undefined
        ? {}
        : { parent_session_id: input.parent_session_id }),
      status: 'running',
      version: 1,
      started_at: new Date().toISOString(),
      trace_id: input.trace_id,
      source_refs: [{ type: 'session', id: input.client_id }],
    };
    const result = await this.store.startSessionWithReceipt(input, candidate);
    try {
      const receipt = parseSessionStartReceiptLookup(
        result.receipt,
        {
          ...(input.parent_session_id === undefined
            ? {}
            : { parent_session_id: input.parent_session_id }),
        },
        input,
      );
      if (receipt.status !== 'recorded') throw new TypeError();
      assertSessionStartCurrent(result.session, receipt, input);
      this.cacheCommittedSession(result.session);
      return { session: cloneSession(result.session), receipt };
    } catch {
      throw new ContractError(
        'SESSION_RECEIPT_INVALID',
        'Session start result contradicts its receipt',
        { trace_id: input.trace_id },
      );
    }
  }

  /** Publish only after an externally owned transaction has committed. */
  cacheCommittedSession(session: Session): void {
    const current = this.sessions.get(session.session_id);
    if (!current || current.version < session.version)
      this.sessions.set(session.session_id, cloneSession(session));
  }

  private newSession(input: StartSessionInput): Session {
    if (input.parent_session_id !== undefined) this.getSession(input.parent_session_id, input);
    if (input.resume_origin !== undefined && input.parent_session_id === undefined)
      throw new ContractError('INVALID_INPUT', 'A resumed session requires a parent', {
        trace_id: input.trace_id,
      });
    return {
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
      ...(input.resume_origin === undefined
        ? {}
        : { resume_origin: parseSessionResumeOrigin(input.resume_origin) }),
      status: 'running',
      version: 1,
      started_at: new Date().toISOString(),
      trace_id: input.trace_id,
      source_refs: [{ type: 'session', id: input.client_id }],
    };
  }

  async startSessionAsync(input: StartSessionInput): Promise<Session> {
    if (!this.store) return this.startSession(input);
    const key = startKey(input, input.idempotency_key);
    const previous = this.idempotency.get(key);
    if (previous) return this.replayStart(input, previous);
    const pending = this.pendingStarts.get(key);
    if (pending) return this.replayStart(input, await pending);
    const started = this.persistStart(input, key, this.store);
    this.pendingStarts.set(key, started);
    try {
      return await started;
    } finally {
      this.pendingStarts.delete(key);
    }
  }

  private async persistStart(
    input: StartSessionInput,
    key: string,
    store: SessionStore,
  ): Promise<Session> {
    if (
      input.parent_session_id &&
      !this.sessions.has(input.parent_session_id) &&
      store.findSession
    ) {
      const parent = await store.findSession(input.parent_session_id, input);
      if (parent) this.cacheCommittedSession(parent);
    }
    const session = this.newSession(input);
    const stored = await store.saveSession(session, input.idempotency_key);
    return this.rememberSession(key, stored ? this.replayStart(input, stored) : session);
  }

  private rememberSession(key: string, session: Session): Session {
    this.cacheCommittedSession(session);
    this.idempotency.set(key, cloneSession(session));
    return cloneSession(session);
  }

  private replayStart(input: StartSessionInput, previous: Session): Session {
    if (
      input.resume_origin &&
      !previous.resume_origin &&
      previous.parent_session_id === input.parent_session_id
    )
      throw new ContractError(
        'SESSION_RESUME_LEGACY_UNVERIFIED',
        'This key has a historical session without a recorded handoff binding',
        { trace_id: input.trace_id },
      );
    if (
      previous.parent_session_id !== input.parent_session_id ||
      previous.resume_origin?.handoff_id !== input.resume_origin?.handoff_id ||
      previous.resume_origin?.checkpoint_id !== input.resume_origin?.checkpoint_id ||
      previous.resume_origin?.require_claimed !== input.resume_origin?.require_claimed
    )
      throw new ContractError(
        'IDEMPOTENCY_KEY_REUSED',
        'Key belongs to a different session start',
        { trace_id: input.trace_id },
      );
    return cloneSession(previous);
  }

  appendAgentRun(input: AppendAgentRunInput): AgentRun {
    const result = this.mutateLocally({ kind: 'run.start', input });
    if (result.kind !== 'run.start')
      throw new ContractError('SESSION_RECEIPT_INVALID', 'Unexpected command result');
    return result.run;
  }

  async appendAgentRunAsync(input: AppendAgentRunInput): Promise<AgentRun> {
    const result = await this.mutateAsync({ kind: 'run.start', input });
    if (result.kind !== 'run.start')
      throw new ContractError('SESSION_RECEIPT_INVALID', 'Unexpected command result');
    return result.run;
  }

  finishAgentRun(input: FinishAgentRunInput): AgentRun {
    const result = this.mutateLocally({ kind: 'run.finish', input });
    if (result.kind !== 'run.finish')
      throw new ContractError('SESSION_RECEIPT_INVALID', 'Unexpected command result');
    return result.run;
  }

  async finishAgentRunAsync(input: FinishAgentRunInput): Promise<AgentRun> {
    const result = await this.mutateAsync({ kind: 'run.finish', input });
    if (result.kind !== 'run.finish')
      throw new ContractError('SESSION_RECEIPT_INVALID', 'Unexpected command result');
    return result.run;
  }

  recordToolCall(input: RecordToolCallInput): ToolCall {
    const result = this.mutateLocally({ kind: 'tool.call', input });
    if (result.kind !== 'tool.call')
      throw new ContractError('SESSION_RECEIPT_INVALID', 'Unexpected command result');
    return result.tool_call;
  }

  async recordToolCallAsync(input: RecordToolCallInput): Promise<ToolCall> {
    const result = await this.mutateAsync({ kind: 'tool.call', input });
    if (result.kind !== 'tool.call')
      throw new ContractError('SESSION_RECEIPT_INVALID', 'Unexpected command result');
    return result.tool_call;
  }

  finishToolCall(input: FinishToolCallInput): ToolCall {
    const result = this.mutateLocally({ kind: 'tool.finish', input });
    if (result.kind !== 'tool.finish')
      throw new ContractError('SESSION_RECEIPT_INVALID', 'Unexpected command result');
    return result.tool_call;
  }

  async finishToolCallAsync(input: FinishToolCallInput): Promise<ToolCall> {
    const result = await this.mutateAsync({ kind: 'tool.finish', input });
    if (result.kind !== 'tool.finish')
      throw new ContractError('SESSION_RECEIPT_INVALID', 'Unexpected command result');
    return result.tool_call;
  }

  endSession(input: EndSessionInput): Session {
    return this.mutateLocally({ kind: 'end', input }).session;
  }

  async endSessionAsync(input: EndSessionInput): Promise<Session> {
    return (await this.mutateAsync({ kind: 'end', input })).session;
  }

  private mutateLocally(command: SessionMutationCommand): SessionMutationResult {
    const { input } = command;
    const key =
      input.receipt &&
      JSON.stringify([
        input.tenant_id,
        input.workspace_id,
        input.project_id,
        input.session_id,
        command.kind,
        input.receipt.key,
      ]);
    const previous = key ? this.mutationReceipts.get(key) : undefined;
    if (previous) {
      if (previous.fingerprint !== input.receipt!.fingerprint)
        throw new ContractError(
          'IDEMPOTENCY_KEY_REUSED',
          'Key belongs to another session command',
          { trace_id: input.trace_id },
        );
      return structuredClone(previous.result);
    }
    let sequence = 0;
    if (command.kind === 'run.start')
      for (const run of this.runs.values()) {
        if (run.session_id === input.session_id) sequence = Math.max(sequence, run.sequence);
      }
    const run =
      command.kind === 'tool.call' || command.kind === 'run.finish'
        ? this.runs.get(command.input.run_id)
        : undefined;
    const toolCall =
      command.kind === 'tool.finish' ? this.toolCalls.get(command.input.tool_call_id) : undefined;
    const result = prepareSessionMutation(command, {
      session: this.getSession(input.session_id, input),
      last_run_sequence: sequence,
      ...(run === undefined ? {} : { run }),
      ...(toolCall === undefined ? {} : { tool_call: toolCall }),
    });
    this.cacheMutation(result);
    if (key)
      this.mutationReceipts.set(key, {
        fingerprint: input.receipt!.fingerprint,
        result: structuredClone(result),
      });
    return result;
  }

  private async mutateAsync(command: SessionMutationCommand): Promise<SessionMutationResult> {
    if (!this.store) return this.mutateLocally(command);
    if (!this.store.mutateSession)
      throw new ContractError(
        'SESSION_STORAGE_UNAVAILABLE',
        'The configured store does not support atomic session commands',
        { trace_id: command.input.trace_id },
      );
    const { result, current_session, current_run, current_tool_call } =
      await this.store.mutateSession(command, (state) => prepareSessionMutation(command, state));
    this.cacheMutation(result);
    this.cacheCommittedSession(current_session);
    if (current_run) this.cacheRun(current_run);
    if (current_tool_call) this.cacheToolCall(current_tool_call);
    return structuredClone(result);
  }

  private cacheMutation(result: SessionMutationResult): void {
    this.cacheCommittedSession(result.session);
    if (result.kind === 'run.start' || result.kind === 'run.finish') this.cacheRun(result.run);
    if (result.kind === 'tool.call' || result.kind === 'tool.finish')
      this.cacheToolCall(result.tool_call);
  }

  private cacheToolCall(tool: ToolCall): void {
    const current = this.toolCalls.get(tool.tool_call_id);
    if (!current || current.version < tool.version)
      this.toolCalls.set(tool.tool_call_id, cloneToolCall(tool));
  }

  private cacheRun(run: AgentRun): void {
    const current = this.runs.get(run.run_id);
    if (!current || current.version < run.version) this.runs.set(run.run_id, cloneAgentRun(run));
  }

  getSession(session_id: Ulid, scope: SessionScope & { trace_id?: string }): Session {
    const session = this.getStoredSession(session_id, scope);
    return cloneSession(session);
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
      .map(cloneAgentRun);
  }
}

function startKey(
  scope: SessionScope & { actor_id: string; client_id: string },
  key: string,
): string {
  return JSON.stringify([
    scope.tenant_id,
    scope.workspace_id,
    scope.project_id,
    scope.actor_id,
    scope.client_id,
    key,
  ]);
}

function cloneSession(session: Session): Session {
  return structuredClone(session);
}

function cloneAgentRun(run: AgentRun): AgentRun {
  return structuredClone(run);
}

function cloneToolCall(toolCall: ToolCall): ToolCall {
  return structuredClone(toolCall);
}
