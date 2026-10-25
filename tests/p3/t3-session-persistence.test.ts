import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestProject } from '@planemem/test-fixtures';
import {
  ContinuationService,
  SessionService,
  type AgentRun,
  type Checkpoint,
  type ContinuationStore,
  type ContinuationStoreSnapshot,
  type Handoff,
  type Session,
  type SessionStore,
  type SessionStoreSnapshot,
  type ToolCall,
} from '@planemem/session-service';

const project = createTestProject('p3-persistence');
const scope = {
  tenant_id: project.tenant_id,
  workspace_id: project.workspace_id,
  project_id: project.project_id,
};

class DurableFixture implements SessionStore, ContinuationStore {
  sessions: SessionStoreSnapshot['sessions'] = [];
  runs: AgentRun[] = [];
  tool_calls: ToolCall[] = [];
  checkpoints: Checkpoint[] = [];
  handoffs: ContinuationStoreSnapshot['handoffs'] = [];

  async loadSessions(): Promise<SessionStoreSnapshot> {
    return clone({ sessions: this.sessions, runs: this.runs, tool_calls: this.tool_calls });
  }

  async saveSession(session: Session, idempotency_key?: string): Promise<void> {
    const index = this.sessions.findIndex((row) => row.session.session_id === session.session_id);
    const row = {
      session: clone(session),
      ...(idempotency_key === undefined ? {} : { idempotency_key }),
    };
    if (index < 0) this.sessions.push(row);
    else this.sessions[index] = { ...this.sessions[index], ...row };
  }

  async saveRun(run: AgentRun): Promise<void> {
    this.runs.push(clone(run));
  }

  async saveToolCall(toolCall: ToolCall): Promise<void> {
    this.tool_calls.push(clone(toolCall));
  }

  async loadContinuations(): Promise<ContinuationStoreSnapshot> {
    return clone({ checkpoints: this.checkpoints, handoffs: this.handoffs });
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.push(clone(checkpoint));
  }

  async saveHandoff(handoff: Handoff, idempotency_key?: string): Promise<void> {
    const index = this.handoffs.findIndex((row) => row.handoff.handoff_id === handoff.handoff_id);
    const row = {
      handoff: clone(handoff),
      ...(idempotency_key === undefined ? {} : { idempotency_key }),
    };
    if (index < 0) this.handoffs.push(row);
    else this.handoffs[index] = { ...this.handoffs[index], ...row };
  }
}

test('P3 persistence port restores sessions, runs, checkpoints and claimed handoffs', async () => {
  const durable = new DurableFixture();
  const firstSessions = new SessionService(durable);
  const firstContinuation = new ContinuationService(firstSessions, durable);
  const session = await firstSessions.startSessionAsync({
    ...scope,
    client_id: 'client-persist',
    actor_id: 'actor-persist',
    trace_id: 'trace-persist-start',
    idempotency_key: 'idem-persist-start',
  });
  const run = await firstSessions.appendAgentRunAsync({
    ...scope,
    session_id: session.session_id,
    model: 'persist-model',
    trace_id: 'trace-persist-run',
    expected_version: 1,
  });
  await firstSessions.recordToolCallAsync({
    ...scope,
    session_id: session.session_id,
    run_id: run.run_id,
    tool_name: 'persist.read',
    status: 'succeeded',
    trace_id: 'trace-persist-tool',
    expected_version: 2,
  });
  const checkpoint = await firstContinuation.createCheckpointAsync({
    ...scope,
    session_id: session.session_id,
    completed: ['persist'],
    in_progress: ['verify'],
    next_actions: ['resume'],
    decisions: ['durable-state'],
    risks: [],
    open_questions: [],
    trace_id: 'trace-persist-checkpoint',
    expected_session_version: 3,
  });
  const handoff = await firstContinuation.createHandoffAsync({
    ...scope,
    checkpoint_id: checkpoint.checkpoint_id,
    from_client: 'client-persist',
    target_client: 'client-next',
    trace_id: 'trace-persist-handoff',
    idempotency_key: 'idem-persist-handoff',
  });

  const restoredSessions = new SessionService(durable);
  const restoredContinuation = new ContinuationService(restoredSessions, durable);
  await restoredSessions.hydrate();
  await restoredContinuation.hydrate();
  assert.equal(restoredSessions.getSession(session.session_id, scope).version, 3);
  assert.equal(restoredSessions.listRuns(session.session_id, scope)[0]?.run_id, run.run_id);
  assert.equal(restoredContinuation.getCheckpoint(checkpoint.checkpoint_id, scope).revision, 1);
  const resumed = await restoredContinuation.resumeSessionAsync({
    ...scope,
    handoff_id: handoff.handoff_id,
    client_id: 'client-next',
    actor_id: 'actor-next',
    trace_id: 'trace-persist-resume',
    idempotency_key: 'idem-persist-resume',
  });
  assert.equal(resumed.handoff.status, 'claimed');
  assert.equal(resumed.session.parent_session_id, session.session_id);
  assert.equal(durable.handoffs[0]?.handoff.status, 'claimed');
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
