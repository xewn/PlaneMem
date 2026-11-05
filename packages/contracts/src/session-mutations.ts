import { ContractError } from './errors.js';
import { createUlid, isUlid } from './ids.js';
import { validateSourceRef } from './metadata.js';
import { parseSessionResumeOrigin } from './session-resume.js';
import type {
  SessionMutationRun as AgentRun,
  SessionMutationSession as Session,
  SessionMutationScope as SessionScope,
  SessionMutationToolCall as ToolCall,
} from './session-mutation-model.js';

interface MutationInput extends SessionScope {
  /** Trusted adapter capability; never copied from the command body or saved as history. */
  read_restricted?: boolean;
  session_id: Session['session_id'];
  trace_id: string;
  expected_version: number;
  receipt?: { key: string; fingerprint: string };
}
export interface AppendAgentRunInput extends MutationInput {
  model?: string;
}
export interface RecordToolCallInput extends MutationInput {
  run_id: AgentRun['run_id'];
  tool_name: string;
  status: ToolCall['status'];
}
export interface FinishAgentRunInput extends MutationInput {
  run_id: AgentRun['run_id'];
  expected_run_version: number;
  status: 'completed' | 'failed';
}
export interface FinishToolCallInput extends MutationInput {
  tool_call_id: ToolCall['tool_call_id'];
  expected_tool_version: number;
  status: 'succeeded' | 'failed';
}
export interface EndSessionInput extends MutationInput {
  status: 'ended' | 'abandoned' | 'failed';
}
export type SessionMutationCommand =
  | { kind: 'run.start'; input: AppendAgentRunInput }
  | { kind: 'run.finish'; input: FinishAgentRunInput }
  | { kind: 'tool.call'; input: RecordToolCallInput }
  | { kind: 'tool.finish'; input: FinishToolCallInput }
  | { kind: 'end'; input: EndSessionInput };
export interface SessionMutationState {
  session: Session;
  last_run_sequence: number;
  run?: AgentRun;
  tool_call?: ToolCall;
}
export type SessionMutationResult =
  | { kind: 'run.start'; session: Session; run: AgentRun }
  | { kind: 'run.finish'; session: Session; run: AgentRun; changed: boolean }
  | { kind: 'tool.call'; session: Session; tool_call: ToolCall }
  | { kind: 'tool.finish'; session: Session; tool_call: ToolCall; changed: boolean }
  | { kind: 'end'; session: Session };
export interface SessionMutationCommit {
  result: SessionMutationResult;
  current_session: Session;
  current_run?: AgentRun;
  current_tool_call?: ToolCall;
}

/** Pure transition: storage supplies locked authoritative state; caches publish only after commit. */
export function prepareSessionMutation(
  command: SessionMutationCommand,
  state: SessionMutationState,
): SessionMutationResult {
  const input = command.input;
  const session = structuredClone(state.session);
  if (
    (command.kind === 'end' && !['ended', 'abandoned', 'failed'].includes(command.input.status)) ||
    (command.kind === 'tool.call' &&
      (typeof command.input.tool_name !== 'string' ||
        !command.input.tool_name.trim() ||
        !['started', 'succeeded', 'failed'].includes(command.input.status))) ||
    (command.kind === 'run.start' &&
      command.input.model !== undefined &&
      (typeof command.input.model !== 'string' || !command.input.model.trim()))
  )
    throw new ContractError('INVALID_INPUT', 'Invalid session command fields', {
      trace_id: input.trace_id,
    });
  if (
    session.session_id !== input.session_id ||
    session.tenant_id !== input.tenant_id ||
    session.workspace_id !== input.workspace_id ||
    session.project_id !== input.project_id
  )
    throw new ContractError('SESSION_ACCESS_DENIED', 'Session scope is not authorized', {
      trace_id: input.trace_id,
    });
  if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1)
    throw new ContractError('INVALID_INPUT', 'expected_version must be a positive safe integer', {
      trace_id: input.trace_id,
    });
  if (!Number.isSafeInteger(session.version) || session.version < 1)
    throw new ContractError('SESSION_RECEIPT_INVALID', 'Stored session version is invalid', {
      trace_id: input.trace_id,
    });
  if (session.version !== input.expected_version)
    throw new ContractError('SESSION_VERSION_CONFLICT', 'Session version does not match', {
      current_version: session.version,
      expected_version: input.expected_version,
      trace_id: input.trace_id,
    });
  if (command.kind === 'run.finish') return finishRun(command.input, session, state.run);
  if (command.kind === 'tool.finish') return finishTool(command.input, session, state.tool_call);
  if (command.kind === 'end' && session.status === command.input.status)
    return { kind: 'end', session };
  if (session.status !== 'running' && !(command.kind === 'end' && session.status === 'paused'))
    throw new ContractError('SESSION_STATE_CONFLICT', 'Session state does not allow this command', {
      current_status: session.status,
      trace_id: input.trace_id,
    });
  if (!Number.isSafeInteger(session.version + 1))
    throw new ContractError(
      'SESSION_VERSION_CONFLICT',
      'Session version exceeds the supported range',
      { trace_id: input.trace_id },
    );
  session.version += 1;
  session.trace_id = input.trace_id;
  if (command.kind === 'end') {
    session.status = command.input.status;
    session.ended_at = new Date().toISOString();
    return { kind: 'end', session };
  }
  if (command.kind === 'run.start') {
    const sequence = state.last_run_sequence + 1;
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 2147483647)
      throw new ContractError(
        'SESSION_VERSION_CONFLICT',
        'Run sequence exceeds the supported range',
        { trace_id: input.trace_id },
      );
    return {
      kind: 'run.start',
      session,
      run: {
        schema_version: 1,
        run_id: createUlid(),
        session_id: session.session_id,
        sequence,
        ...(command.input.model === undefined ? {} : { model: command.input.model }),
        status: 'running',
        version: 1,
        session_version: session.version,
        trace_id: input.trace_id,
        source_refs: [{ type: 'session', id: session.session_id }],
      },
    };
  }
  if (
    !state.run ||
    state.run.run_id !== command.input.run_id ||
    state.run.session_id !== session.session_id
  )
    throw new ContractError('RUN_NOT_FOUND', 'Agent run does not exist in this session', {
      trace_id: input.trace_id,
    });
  if (state.run.status !== 'running')
    throw new ContractError('RUN_STATE_CONFLICT', 'Finished runs do not accept new tool records', {
      trace_id: input.trace_id,
      current_status: state.run.status,
    });
  return {
    kind: 'tool.call',
    session,
    tool_call: {
      schema_version: 1,
      tool_call_id: createUlid(),
      session_id: session.session_id,
      run_id: state.run.run_id,
      tool_name: command.input.tool_name,
      status: command.input.status,
      version: 1,
      session_version: session.version,
      trace_id: input.trace_id,
      source_refs: [{ type: 'agent-run', id: state.run.run_id }],
    },
  };
}

function finishRun(
  input: FinishAgentRunInput,
  session: Session,
  stored: AgentRun | undefined,
): SessionMutationResult {
  if (
    !['completed', 'failed'].includes(input.status) ||
    !Number.isSafeInteger(input.expected_run_version) ||
    input.expected_run_version < 1
  )
    throw new ContractError(
      'INVALID_INPUT',
      'Supply a terminal status and positive expected_run_version',
      { trace_id: input.trace_id },
    );
  if (!stored || stored.run_id !== input.run_id || stored.session_id !== session.session_id)
    throw new ContractError('RUN_NOT_FOUND', 'Agent run does not exist in this session', {
      trace_id: input.trace_id,
    });
  if (!Number.isSafeInteger(stored.version) || stored.version < 1)
    throw new ContractError('SESSION_RECEIPT_INVALID', 'Stored run version is invalid', {
      trace_id: input.trace_id,
    });
  if (stored.version !== input.expected_run_version)
    throw new ContractError('RUN_VERSION_CONFLICT', 'Run version does not match', {
      trace_id: input.trace_id,
      current_version: stored.version,
      expected_version: input.expected_run_version,
    });
  if (!['running', 'paused', 'ended', 'abandoned', 'failed'].includes(session.status))
    throw new ContractError(
      'SESSION_STATE_CONFLICT',
      'Session state does not allow finishing a run',
      { trace_id: input.trace_id },
    );
  const run = structuredClone(stored);
  if (run.status === input.status) {
    run.session_version = session.version;
    return { kind: 'run.finish', session, run, changed: false };
  }
  if (run.status !== 'running')
    throw new ContractError(
      'RUN_STATE_CONFLICT',
      'The run already has a different terminal status',
      { trace_id: input.trace_id, current_status: run.status },
    );
  if (!Number.isSafeInteger(run.version + 1) || !Number.isSafeInteger(session.version + 1))
    throw new ContractError(
      'RUN_VERSION_CONFLICT',
      'Run or session version exceeds the supported range',
      { trace_id: input.trace_id },
    );
  run.status = input.status;
  run.version += 1;
  run.trace_id = input.trace_id;
  session.version += 1;
  session.trace_id = input.trace_id;
  run.session_version = session.version;
  return { kind: 'run.finish', session, run, changed: true };
}

function finishTool(
  input: FinishToolCallInput,
  session: Session,
  stored: ToolCall | undefined,
): SessionMutationResult {
  if (
    !['succeeded', 'failed'].includes(input.status) ||
    !isUlid(input.tool_call_id) ||
    !Number.isSafeInteger(input.expected_tool_version) ||
    input.expected_tool_version < 1
  )
    throw new ContractError(
      'INVALID_INPUT',
      'Supply a tool_call_id, terminal status and positive expected_tool_version',
      { trace_id: input.trace_id },
    );
  if (
    !stored ||
    stored.tool_call_id !== input.tool_call_id ||
    stored.session_id !== session.session_id
  )
    throw new ContractError('TOOL_CALL_NOT_FOUND', 'Tool call does not exist in this session', {
      trace_id: input.trace_id,
    });
  if (!Number.isSafeInteger(stored.version) || stored.version < 1)
    throw new ContractError('SESSION_RECEIPT_INVALID', 'Stored tool call version is invalid', {
      trace_id: input.trace_id,
    });
  if (stored.version !== input.expected_tool_version)
    throw new ContractError('TOOL_VERSION_CONFLICT', 'Tool call version does not match', {
      trace_id: input.trace_id,
      current_version: stored.version,
      expected_version: input.expected_tool_version,
    });
  if (!['running', 'paused', 'ended', 'abandoned', 'failed'].includes(session.status))
    throw new ContractError(
      'SESSION_STATE_CONFLICT',
      'Session state does not allow finishing a tool call',
      {
        trace_id: input.trace_id,
      },
    );
  const tool_call = structuredClone(stored);
  if (tool_call.status === input.status) {
    tool_call.session_version = session.version;
    return { kind: 'tool.finish', session, tool_call, changed: false };
  }
  if (tool_call.status !== 'started')
    throw new ContractError(
      'TOOL_STATE_CONFLICT',
      'Tool call already has a different terminal status',
      {
        trace_id: input.trace_id,
        current_status: tool_call.status,
      },
    );
  if (!Number.isSafeInteger(tool_call.version + 1) || !Number.isSafeInteger(session.version + 1))
    throw new ContractError(
      'TOOL_VERSION_CONFLICT',
      'Tool call or session version exceeds the supported range',
      {
        trace_id: input.trace_id,
      },
    );
  tool_call.status = input.status;
  tool_call.version += 1;
  tool_call.trace_id = input.trace_id;
  session.version += 1;
  session.trace_id = input.trace_id;
  tool_call.session_version = session.version;
  return { kind: 'tool.finish', session, tool_call, changed: true };
}

/** A stored successful response is historical and must still match its original command. */
export function readSessionMutationReceipt(
  value: unknown,
  command: SessionMutationCommand,
): SessionMutationResult {
  const fail = (): never => {
    throw new ContractError(
      'SESSION_RECEIPT_INVALID',
      'Stored session command receipt is invalid',
      { trace_id: command.input.trace_id },
    );
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const result = value as SessionMutationResult;
  const { session } = result;
  const input = command.input;
  if (
    result.kind !== command.kind ||
    !session ||
    session.schema_version !== 1 ||
    session.session_id !== input.session_id ||
    session.tenant_id !== input.tenant_id ||
    session.workspace_id !== input.workspace_id ||
    session.project_id !== input.project_id ||
    !Number.isSafeInteger(input.expected_version) ||
    input.expected_version < 1 ||
    !Number.isSafeInteger(session.version) ||
    session.version < 1 ||
    typeof session.actor_id !== 'string' ||
    typeof session.client_id !== 'string' ||
    typeof session.trace_id !== 'string' ||
    typeof session.started_at !== 'string' ||
    !Number.isFinite(Date.parse(session.started_at)) ||
    (session.parent_session_id !== undefined && !isUlid(session.parent_session_id))
  )
    return fail();
  try {
    if (!Array.isArray(session.source_refs)) return fail();
    session.source_refs.forEach(validateSourceRef);
    if (session.resume_origin !== undefined) {
      if (session.parent_session_id === undefined) return fail();
      parseSessionResumeOrigin(session.resume_origin);
    }
  } catch {
    return fail();
  }
  if (command.kind === 'run.finish' && result.kind === 'run.finish') {
    const run = result.run;
    const expected = command.input.expected_run_version;
    const closed = ['ended', 'abandoned', 'failed'].includes(session.status);
    if (
      !['running', 'paused', 'ended', 'abandoned', 'failed'].includes(session.status) ||
      (closed
        ? typeof session.ended_at !== 'string' || !Number.isFinite(Date.parse(session.ended_at))
        : session.ended_at !== undefined) ||
      typeof result.changed !== 'boolean' ||
      !Number.isSafeInteger(expected) ||
      expected < 1 ||
      session.version !== input.expected_version + (result.changed ? 1 : 0) ||
      !run ||
      run.schema_version !== 1 ||
      !isUlid(run.run_id) ||
      run.run_id !== command.input.run_id ||
      run.session_id !== session.session_id ||
      run.status !== command.input.status ||
      !['completed', 'failed'].includes(run.status) ||
      !Number.isSafeInteger(run.version) ||
      run.version !== expected + (result.changed ? 1 : 0) ||
      run.session_version !== session.version ||
      !Number.isSafeInteger(run.sequence) ||
      run.sequence < 1 ||
      run.sequence > 2147483647 ||
      (run.model !== undefined && typeof run.model !== 'string') ||
      typeof run.trace_id !== 'string' ||
      (result.changed && run.trace_id !== session.trace_id)
    )
      return fail();
    try {
      if (!Array.isArray(run.source_refs)) return fail();
      run.source_refs.forEach(validateSourceRef);
    } catch {
      return fail();
    }
    return structuredClone(result);
  }
  if (command.kind === 'tool.finish' && result.kind === 'tool.finish') {
    const tool = result.tool_call;
    const expected = command.input.expected_tool_version;
    const closed = ['ended', 'abandoned', 'failed'].includes(session.status);
    if (
      !['running', 'paused', 'ended', 'abandoned', 'failed'].includes(session.status) ||
      (closed
        ? typeof session.ended_at !== 'string' || !Number.isFinite(Date.parse(session.ended_at))
        : session.ended_at !== undefined) ||
      typeof result.changed !== 'boolean' ||
      !Number.isSafeInteger(expected) ||
      expected < 1 ||
      session.version !== input.expected_version + (result.changed ? 1 : 0) ||
      !tool ||
      tool.schema_version !== 1 ||
      !isUlid(tool.tool_call_id) ||
      tool.tool_call_id !== command.input.tool_call_id ||
      tool.session_id !== session.session_id ||
      !isUlid(tool.run_id) ||
      typeof tool.tool_name !== 'string' ||
      !tool.tool_name.trim() ||
      tool.status !== command.input.status ||
      !['succeeded', 'failed'].includes(tool.status) ||
      !Number.isSafeInteger(tool.version) ||
      tool.version !== expected + (result.changed ? 1 : 0) ||
      tool.session_version !== session.version ||
      typeof tool.trace_id !== 'string' ||
      (result.changed && tool.trace_id !== session.trace_id)
    )
      return fail();
    try {
      if (
        !Array.isArray(tool.source_refs) ||
        tool.source_refs.length !== 1 ||
        tool.source_refs[0]?.type !== 'agent-run' ||
        tool.source_refs[0]?.id !== tool.run_id
      )
        return fail();
      tool.source_refs.forEach(validateSourceRef);
    } catch {
      return fail();
    }
    return structuredClone(result);
  }
  if (command.kind === 'end' && result.kind === 'end') {
    if (
      session.status !== command.input.status ||
      typeof session.ended_at !== 'string' ||
      !Number.isFinite(Date.parse(session.ended_at)) ||
      ![input.expected_version, input.expected_version + 1].includes(session.version)
    )
      return fail();
  } else {
    if (
      session.status !== 'running' ||
      session.ended_at !== undefined ||
      session.version !== input.expected_version + 1
    )
      return fail();
    const entity =
      result.kind === 'run.start'
        ? result.run
        : result.kind === 'tool.call'
          ? result.tool_call
          : undefined;
    if (
      !entity ||
      entity.schema_version !== 1 ||
      entity.version !== 1 ||
      entity.session_id !== input.session_id ||
      entity.session_version !== session.version ||
      typeof entity.trace_id !== 'string' ||
      entity.trace_id !== session.trace_id
    )
      return fail();
    try {
      if (!Array.isArray(entity.source_refs)) return fail();
      entity.source_refs.forEach(validateSourceRef);
    } catch {
      return fail();
    }
    if (command.kind === 'run.start' && result.kind === 'run.start') {
      if (
        !isUlid(result.run.run_id) ||
        result.run.status !== 'running' ||
        result.run.model !== command.input.model ||
        result.run.source_refs.length !== 1 ||
        result.run.source_refs[0]?.type !== 'session' ||
        result.run.source_refs[0]?.id !== session.session_id ||
        !Number.isSafeInteger(result.run.sequence) ||
        result.run.sequence < 1 ||
        result.run.sequence > 2147483647
      )
        return fail();
    } else if (command.kind === 'tool.call' && result.kind === 'tool.call') {
      if (
        !isUlid(result.tool_call.tool_call_id) ||
        result.tool_call.run_id !== command.input.run_id ||
        result.tool_call.tool_name !== command.input.tool_name ||
        result.tool_call.status !== command.input.status ||
        result.tool_call.source_refs.length !== 1 ||
        result.tool_call.source_refs[0]?.type !== 'agent-run' ||
        result.tool_call.source_refs[0]?.id !== command.input.run_id
      )
        return fail();
    } else return fail();
  }
  return structuredClone(result);
}
