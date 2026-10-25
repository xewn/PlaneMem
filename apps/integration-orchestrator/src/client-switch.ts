import type { MemoryRef } from '@planemem/domain';
import { InMemoryMemoryProvider, MemoryServiceAdapter } from '@planemem/context-service';
import {
  ContinuationService,
  SessionService,
  type Checkpoint,
  type Handoff,
  type Session,
} from '@planemem/session-service';
import type { Ulid } from '@planemem/contracts';
import type { IntegrationReport, IntegrationStep } from './runner.js';

export interface ClientSwitchScenarioInput {
  scope: {
    tenant_id: Ulid;
    workspace_id: Ulid;
    project_id: Ulid;
  };
  trace_id: string;
}

export interface ClientSwitchScenarioResult {
  report: IntegrationReport;
  memory_ref: MemoryRef;
  checkpoint: Checkpoint;
  handoff: Handoff;
  resumed_session: Session;
}

/** Executes the public session, memory and handoff boundaries for client switching. */
export async function runClientSwitchScenario(
  input: ClientSwitchScenarioInput,
): Promise<ClientSwitchScenarioResult> {
  const started_at = new Date().toISOString();
  const steps: IntegrationStep[] = [];
  const sessions = new SessionService();
  const continuation = new ContinuationService(sessions);
  const memory = new MemoryServiceAdapter(new InMemoryMemoryProvider());

  const codexSession = await executeStep(steps, input.trace_id, 'codex.session', () =>
    sessions.startSession({
      ...input.scope,
      client_id: 'codex',
      actor_id: 'actor-fixture',
      trace_id: input.trace_id,
      idempotency_key: 'codex-session-fixture',
    }),
  );
  const memory_ref = await executeStep(steps, input.trace_id, 'memory.capture', () =>
    memory.capture({
      ...input.scope,
      content: 'Codex completed the implementation plan and left a next action for Claude.',
      trace_id: input.trace_id,
    }),
  );
  const checkpoint = await executeStep(steps, input.trace_id, 'checkpoint.create', () =>
    continuation.createCheckpoint({
      ...input.scope,
      session_id: codexSession.session_id,
      completed: ['implementation plan'],
      in_progress: ['integration verification'],
      next_actions: ['run the remaining RC gates'],
      decisions: ['keep Plane as the work authority'],
      risks: [],
      open_questions: [],
      memory_ref,
      trace_id: input.trace_id,
      expected_session_version: codexSession.version,
    }),
  );
  const handoff = await executeStep(steps, input.trace_id, 'handoff.create', () =>
    continuation.createHandoff({
      ...input.scope,
      checkpoint_id: checkpoint.checkpoint_id,
      from_client: 'codex',
      target_client: 'claude-code',
      trace_id: input.trace_id,
      idempotency_key: 'codex-to-claude-fixture',
    }),
  );
  const resumed_session = await executeStep(
    steps,
    input.trace_id,
    'claude.resume',
    () =>
      continuation.resumeSession({
        ...input.scope,
        handoff_id: handoff.handoff_id,
        client_id: 'claude-code',
        actor_id: 'actor-fixture',
        trace_id: input.trace_id,
        idempotency_key: 'claude-resume-fixture',
      }).session,
  );

  return {
    report: {
      schema_version: 1,
      scenario_id: 'client-switch',
      trace_id: input.trace_id,
      status: 'passed',
      steps,
      faults: [],
      started_at,
      ended_at: new Date().toISOString(),
    },
    memory_ref,
    checkpoint,
    handoff: continuation.getHandoff(handoff.handoff_id, input.scope),
    resumed_session,
  };
}

async function executeStep<T>(
  steps: IntegrationStep[],
  trace_id: string,
  name: string,
  action: () => Promise<T> | T,
): Promise<T> {
  try {
    const result = await action();
    steps.push({
      name,
      status: 'passed',
      trace_id,
      source_refs: [{ type: 'integration-step', id: name }],
    });
    return result;
  } catch (error) {
    steps.push({
      name,
      status: 'failed',
      trace_id,
      source_refs: [{ type: 'integration-step', id: name }],
    });
    throw error;
  }
}
