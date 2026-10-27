import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestProject } from '@planemem/test-fixtures';
import { SqliteOutbox } from '@planemem/context-bridge';
import { ContinuationService, SessionService } from '@planemem/session-service';
import { ConflictService, SyncService, type SyncScope } from '@planemem/sync-service';

const project = createTestProject('p3');
const scope: SyncScope = {
  tenant_id: project.tenant_id,
  workspace_id: project.workspace_id,
  project_id: project.project_id,
};

test('P3-U01/T3.1 enforces session lifecycle, idempotent start and scope isolation', () => {
  const service = new SessionService();
  const started = service.startSession({
    ...scope,
    client_id: 'client-a',
    actor_id: 'actor-a',
    trace_id: 'trace_session_start',
    idempotency_key: 'idem-session-start',
  });
  const retry = service.startSession({
    ...scope,
    client_id: 'client-a',
    actor_id: 'actor-a',
    trace_id: 'trace_session_retry',
    idempotency_key: 'idem-session-start',
  });
  assert.equal(retry.session_id, started.session_id);
  const run = service.appendAgentRun({
    ...scope,
    session_id: started.session_id,
    model: 'fixture-model',
    trace_id: 'trace_run',
    expected_version: 1,
  });
  service.recordToolCall({
    ...scope,
    session_id: started.session_id,
    run_id: run.run_id,
    tool_name: 'fixture.read',
    status: 'succeeded',
    trace_id: 'trace_tool',
    expected_version: 2,
  });
  const ended = service.endSession({
    ...scope,
    session_id: started.session_id,
    status: 'ended',
    trace_id: 'trace_session_end',
    expected_version: 3,
  });
  assert.equal(ended.status, 'ended');
  assert.throws(
    () =>
      service.endSession({
        ...scope,
        session_id: started.session_id,
        status: 'ended',
        trace_id: 'trace_session_end_retry',
        expected_version: 99,
      }),
    /version does not match/,
  );
  assert.equal(
    service.endSession({
      ...scope,
      session_id: started.session_id,
      status: 'ended',
      trace_id: 'trace_session_end_current',
      expected_version: 4,
    }).status,
    'ended',
  );
  assert.throws(
    () =>
      service.appendAgentRun({
        ...scope,
        session_id: started.session_id,
        trace_id: 'trace_after_end',
        expected_version: 4,
      }),
    /not running/,
  );
  assert.throws(
    () =>
      service.getSession(started.session_id, {
        ...scope,
        project_id: '01HF7YAT000000000000000099',
      } as never),
    /not authorized/,
  );
  assert.equal(service.health().ready, true);
});

test('P3-U02/T3.2 produces repeatable checkpoint hashes and complete source references', () => {
  const sessions = new SessionService();
  const session = sessions.startSession({
    ...scope,
    client_id: 'client-a',
    actor_id: 'actor-a',
    trace_id: 'trace_checkpoint_session',
    idempotency_key: 'idem-checkpoint-session',
  });
  const continuation = new ContinuationService(sessions);
  const input = {
    ...scope,
    session_id: session.session_id,
    completed: ['schema'],
    in_progress: ['sync'],
    next_actions: ['test'],
    decisions: ['append-only'],
    risks: ['network'],
    open_questions: ['provider'],
    trace_id: 'trace_checkpoint',
    expected_session_version: 1,
  };
  const first = continuation.createCheckpoint(input);
  const second = continuation.createCheckpoint(input);
  assert.equal(first.state_hash, second.state_hash);
  assert.equal(second.revision, 2);
  assert.ok(first.source_refs.some((ref) => ref.type === 'session'));
});

test('P3-I01/P3-I02/T3.2 claim-once handoff resumes a child session', () => {
  const sessions = new SessionService();
  const continuation = new ContinuationService(sessions);
  const session = sessions.startSession({
    ...scope,
    client_id: 'client-a',
    actor_id: 'actor-a',
    trace_id: 'trace_handoff_session',
    idempotency_key: 'idem-handoff-session',
  });
  const checkpoint = continuation.createCheckpoint({
    ...scope,
    session_id: session.session_id,
    completed: ['work'],
    in_progress: [],
    next_actions: ['resume'],
    decisions: [],
    risks: [],
    open_questions: [],
    trace_id: 'trace_handoff_checkpoint',
    expected_session_version: 1,
  });
  const handoff = continuation.createHandoff({
    ...scope,
    checkpoint_id: checkpoint.checkpoint_id,
    from_client: 'client-a',
    target_client: 'client-b',
    trace_id: 'trace_handoff_create',
    idempotency_key: 'idem-handoff',
  });
  assert.throws(
    () =>
      continuation.claimHandoff({
        ...scope,
        handoff_id: handoff.handoff_id,
        client_id: 'client-c',
        trace_id: 'trace_handoff_denied',
      }),
    /another client/,
  );
  const claimed = continuation.claimHandoff({
    ...scope,
    handoff_id: handoff.handoff_id,
    client_id: 'client-b',
    trace_id: 'trace_handoff_claim',
  });
  assert.equal(claimed.status, 'claimed');
  assert.equal(
    continuation.claimHandoff({
      ...scope,
      handoff_id: handoff.handoff_id,
      client_id: 'client-b',
      trace_id: 'trace_handoff_retry',
    }).status,
    'claimed',
  );

  const secondHandoff = continuation.createHandoff({
    ...scope,
    checkpoint_id: checkpoint.checkpoint_id,
    from_client: 'client-a',
    target_client: 'client-b',
    trace_id: 'trace_resume_create',
    idempotency_key: 'idem-resume-handoff',
  });
  const resumed = continuation.resumeSession({
    ...scope,
    handoff_id: secondHandoff.handoff_id,
    client_id: 'client-b',
    actor_id: 'actor-b',
    trace_id: 'trace_resume',
    idempotency_key: 'idem-resume-session',
  });
  assert.equal(resumed.session.parent_session_id, session.session_id);
  assert.equal(resumed.checkpoint.checkpoint_id, checkpoint.checkpoint_id);
});

test('P3-I03/P3-R01/T3.3 rejects cursor gaps and drains SQLite outbox without duplicate effects', async () => {
  const sync = new SyncService();
  const first = sync.appendBatch({
    ...scope,
    trace_id: 'trace_batch_1',
    idempotency_key: 'idem-batch-1',
    events: [
      {
        event_id: 'event-1',
        event_type: 'FixtureCreated',
        client_cursor: 1,
        payload: { value: 1 },
        source_refs: [{ type: 'fixture', id: 'event-1' }],
      },
    ],
  });
  assert.equal(first.accepted.length, 1);
  assert.equal(
    sync.appendBatch({
      ...scope,
      trace_id: 'trace_batch_1_retry',
      idempotency_key: 'idem-batch-1',
      events: [],
    }).next_cursor,
    1,
  );
  const gap = sync.appendBatch({
    ...scope,
    trace_id: 'trace_batch_gap',
    idempotency_key: 'idem-batch-gap',
    events: [
      {
        event_id: 'event-3',
        event_type: 'FixtureCreated',
        client_cursor: 3,
        payload: { value: 3 },
        source_refs: [],
      },
    ],
  });
  assert.equal(gap.rejected[0]?.code, 'CURSOR_GAP');
  assert.equal(
    sync.getChanges({ ...scope, after_cursor: 0, limit: 10, trace_id: 'trace_changes' }).changes
      .length,
    1,
  );
  sync.ackCursor({ ...scope, client_id: 'client-a', cursor: 1, trace_id: 'trace_ack' });
  assert.throws(
    () =>
      sync.ackCursor({
        ...scope,
        client_id: 'client-a',
        cursor: 0,
        trace_id: 'trace_ack_regression',
      }),
    /monotonic/,
  );
  const outbox = new SqliteOutbox(':memory:');
  const queued = outbox.enqueueDurably({
    ...scope,
    event_id: 'outbox-1',
    event_type: 'FixtureCreated',
    payload: { value: 1 },
    idempotency_key: 'idem-outbox-1',
    trace_id: 'trace_outbox',
  });
  assert.equal(
    outbox.enqueueDurably({
      ...scope,
      event_id: 'outbox-other',
      event_type: 'FixtureCreated',
      payload: { value: 2 },
      idempotency_key: 'idem-outbox-1',
      trace_id: 'trace_outbox_retry',
    }).event_id,
    queued.event_id,
  );
  let attempts = 0;
  const firstDrain = await outbox.drain(
    () => {
      attempts += 1;
      throw new Error('offline');
    },
    new Date(),
    10,
  );
  assert.deepEqual(firstDrain.retried, ['outbox-1']);
  const secondDrain = await outbox.drain(
    () => {
      attempts += 1;
    },
    new Date(Date.now() + 10_000),
    10,
  );
  assert.deepEqual(secondDrain.sent, ['outbox-1']);
  assert.equal(attempts, 2);
  outbox.close();
});

test('P3-I04/P3-I05/T3.5 exposes and resolves version conflicts without silent overwrite', () => {
  const conflicts = new ConflictService();
  const conflict = conflicts.detectConflict({
    ...scope,
    entity_type: 'WorkItem',
    entity_id: 'work-1',
    field: 'status',
    base_version: 1,
    local_version: 2,
    server_version: 3,
    local_value: 'done',
    server_value: 'blocked',
    trace_id: 'trace_conflict',
    source_refs: [{ type: 'plane', id: 'work-1' }],
  });
  assert.ok(conflict);
  const resolved = conflicts.resolveConflict({
    ...scope,
    conflict_id: conflict!.conflict_id,
    resolution: 'merge',
    actor_id: 'actor-a',
    expected_version: 1,
    trace_id: 'trace_resolve',
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(
    conflicts.resolveConflict({
      ...scope,
      conflict_id: conflict!.conflict_id,
      resolution: 'merge',
      actor_id: 'actor-a',
      expected_version: 999,
      trace_id: 'trace_resolve_retry',
    }).status,
    'resolved',
  );
  assert.equal(conflicts.emitResolution(resolved).event_type, 'ConflictResolved');
  assert.equal(conflicts.listConflicts(scope).length, 1);
  assert.equal(conflicts.health().ready, true);
});
