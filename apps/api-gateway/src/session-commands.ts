import { ContractError } from '@planemem/contracts';
import { SessionService, ContinuationService } from '@planemem/session-service';
import { CommandRouter, type RequestContext } from './router.js';
type RuntimeBody = Record<string, unknown>;
export const sessionOperations = [
  'session.start',
  'session.run.start',
  'session.tool.call',
  'session.end',
  'session.checkpoint',
  'session.handoff',
  'session.handoff.claim',
  'session.resume',
] as const;
export function createSessionCommands(
  sessions: SessionService,
  continuation: ContinuationService,
): CommandRouter {
  const router = new CommandRouter();
  router.register('session.start', async (request) => {
    const session = await sessions.startSessionAsync({
      ...sessionScope(request),
      client_id: optionalString(request.input.client_id) ?? request.context.client_id,
      actor_id: optionalString(request.input.actor_id) ?? request.context.actor_id,
      ...(optionalString(request.input.parent_session_id) === undefined
        ? {}
        : { parent_session_id: optionalString(request.input.parent_session_id) as never }),
      trace_id: request.context.trace_id,
      idempotency_key: idempotencyFor(request),
    });
    return sessionResult(request, session, session.source_refs);
  });
  router.register('session.run.start', async (request) => {
    const model = optionalString(request.input.model);
    const run = await sessions.appendAgentRunAsync({
      ...sessionScope(request),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      ...(model === undefined ? {} : { model }),
      trace_id: request.context.trace_id,
      expected_version: expectedVersion(request),
    });
    return sessionResult(request, run, run.source_refs);
  });
  router.register('session.tool.call', async (request) => {
    const toolCall = await sessions.recordToolCallAsync({
      ...sessionScope(request),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      run_id: requireString(request.input.run_id, 'run_id') as never,
      tool_name: requireString(request.input.tool_name, 'tool_name'),
      status: requireEnum(request.input.status, 'status', ['started', 'succeeded', 'failed']),
      trace_id: request.context.trace_id,
      expected_version: expectedVersion(request),
    });
    return sessionResult(request, toolCall, toolCall.source_refs);
  });
  router.register('session.end', async (request) => {
    const session = await sessions.endSessionAsync({
      ...sessionScope(request),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      status: requireEnum(request.input.status, 'status', ['ended', 'abandoned', 'failed']),
      trace_id: request.context.trace_id,
      expected_version: expectedVersion(request),
    });
    return sessionResult(request, session, session.source_refs);
  });
  router.register('session.checkpoint', async (request) => {
    const checkpoint = await continuation.createCheckpointAsync({
      ...sessionScope(request),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      completed: requireStringArray(request.input.completed, 'completed'),
      in_progress: requireStringArray(request.input.in_progress, 'in_progress'),
      next_actions: requireStringArray(request.input.next_actions, 'next_actions'),
      decisions: requireStringArray(request.input.decisions, 'decisions'),
      risks: requireStringArray(request.input.risks, 'risks'),
      open_questions: requireStringArray(request.input.open_questions, 'open_questions'),
      ...(request.input.context_pack === undefined
        ? {}
        : { context_pack: request.input.context_pack as never }),
      ...(request.input.memory_ref === undefined
        ? {}
        : { memory_ref: request.input.memory_ref as never }),
      trace_id: request.context.trace_id,
      expected_session_version: expectedVersion(request),
    });
    return sessionResult(request, checkpoint, checkpoint.source_refs);
  });
  router.register('session.handoff', async (request) => {
    const targetClient = optionalString(request.input.target_client);
    const handoff = await continuation.createHandoffAsync({
      ...sessionScope(request),
      checkpoint_id: requireString(request.input.checkpoint_id, 'checkpoint_id') as never,
      from_client: optionalString(request.input.from_client) ?? request.context.client_id,
      ...(targetClient === undefined ? {} : { target_client: targetClient }),
      trace_id: request.context.trace_id,
      idempotency_key: idempotencyFor(request),
    });
    return sessionResult(request, handoff, handoff.source_refs);
  });
  router.register('session.handoff.claim', async (request) => {
    const handoff = await continuation.claimHandoffAsync({
      ...sessionScope(request),
      handoff_id: requireString(request.input.handoff_id, 'handoff_id') as never,
      client_id: optionalString(request.input.client_id) ?? request.context.client_id,
      trace_id: request.context.trace_id,
    });
    return sessionResult(request, handoff, handoff.source_refs);
  });
  router.register('session.resume', async (request) => {
    const handoffId = requireString(request.input.handoff_id, 'handoff_id') as never;
    const handoff = continuation.getHandoff(handoffId, {
      ...sessionScope(request),
      trace_id: request.context.trace_id,
    });
    const checkpoint = continuation.getCheckpoint(handoff.checkpoint_id, {
      ...sessionScope(request),
      trace_id: request.context.trace_id,
    });
    const requestedSessionId = optionalString(request.input.session_id);
    if (requestedSessionId !== undefined && requestedSessionId !== String(checkpoint.session_id)) {
      throw new ContractError('SESSION_SCOPE_MISMATCH', 'Resume session does not match handoff', {
        trace_id: request.context.trace_id,
        retryable: false,
      });
    }
    const resumed = await continuation.resumeSessionAsync({
      ...sessionScope(request),
      handoff_id: handoffId,
      client_id: optionalString(request.input.client_id) ?? request.context.client_id,
      actor_id: optionalString(request.input.actor_id) ?? request.context.actor_id,
      trace_id: request.context.trace_id,
      idempotency_key: idempotencyFor(request),
    });
    return sessionResult(request, resumed, [
      ...resumed.session.source_refs,
      ...resumed.checkpoint.source_refs,
      ...resumed.handoff.source_refs,
    ]);
  });

  return router;
}
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new ContractError('INVALID_INPUT', `${field} must be a non-empty string`, {
      field,
      trace_id: 'trace_runtime_input',
      retryable: false,
    });
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw new ContractError('INVALID_INPUT', `${field} must be an array of strings`, {
      field,
      trace_id: 'trace_runtime_input',
      retryable: false,
    });
  return value as string[];
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new ContractError('INVALID_INPUT', `${field} must be one of ${allowed.join(', ')}`, {
      field,
      trace_id: 'trace_runtime_input',
      retryable: false,
    });
  return value as T;
}

function sessionScope(request: { context: RequestContext }): {
  tenant_id: never;
  workspace_id: never;
  project_id: never;
} {
  return {
    tenant_id: request.context.tenant_id as never,
    workspace_id: request.context.workspace_id as never,
    project_id: request.context.project_id as never,
  };
}

function idempotencyFor(request: { context: RequestContext; input: RuntimeBody }): string {
  return requireString(
    request.context.idempotency_key ?? request.input.idempotency_key,
    'idempotency_key',
  );
}

function expectedVersion(request: { context: RequestContext; input: RuntimeBody }): number {
  return requireInteger(
    request.context.expected_version ?? request.input.expected_version,
    'expected_version',
  );
}

function sessionResult(
  request: { context: RequestContext },
  data: unknown,
  source_refs: Array<{ type: string; id: string }>,
): {
  schema_version: 1;
  trace_id: string;
  source_refs: Array<{ type: string; id: string }>;
  data: unknown;
} {
  return {
    schema_version: 1,
    trace_id: request.context.trace_id,
    source_refs,
    data,
  };
}

function requireInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new ContractError('INVALID_INPUT', `${field} must be a non-negative integer`, {
      field,
      trace_id: 'trace_runtime_input',
      retryable: false,
    });
  return value as number;
}
