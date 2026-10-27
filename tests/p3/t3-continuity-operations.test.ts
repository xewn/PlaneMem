import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContinuationService,
  SessionService,
  type SessionStore,
  type ContinuationStore,
} from '@planemem/session-service';
import { createTestProject } from '@planemem/test-fixtures';
import {
  ContinuityOperations,
  type ContinuityRequest,
  type OperationTransaction,
  type OperationTransactions,
  type OperationRecord,
} from '../../apps/api-gateway/src/continuity-operations.js';
import { createSessionCommands } from '../../apps/api-gateway/src/session-commands.js';
import type { RequestContext } from '../../apps/api-gateway/src/router.js';

const project = createTestProject('continuity-original-result');
const context: RequestContext = {
  ...project,
  tenant_id: project.tenant_id,
  workspace_id: project.workspace_id,
  project_id: project.project_id,
  actor_id: 'actor-1',
  client_id: 'client-1',
  trace_id: 'trace-1',
  schema_version: 1,
  capability: ['session.write'],
};
const configuration = { endpoint_ref: 'planemem-candidate', configuration_digest: 'c'.repeat(64) };
function request(
  key: string,
  action = 'session.start',
  payload: Record<string, unknown> = {},
  revision?: number,
): ContinuityRequest {
  return {
    protocol_version: 'p02-continuity-v1',
    ...configuration,
    operation_key: key,
    specification_digest: 'a'.repeat(64),
    dispatch_attempt: 1,
    action,
    payload,
    ...(revision === undefined ? {} : { expected_revision: revision }),
  };
}

// Explicit in-memory transaction fixture: exercises orchestration and rollback, not PostgreSQL durability.
class Transactions implements OperationTransactions {
  canonicalizeOnRead = false;
  state = {
    sessions: [] as any[],
    runs: [] as any[],
    tool_calls: [] as any[],
    checkpoints: [] as any[],
    handoffs: [] as any[],
    records: [] as OperationRecord[],
  };
  fail: 'commit' | 'run' | 'receipt' | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(work: (transaction: OperationTransaction) => Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => {
      const state = structuredClone(this.state);
      const store: SessionStore & ContinuationStore = {
        loadSessions: async () => structuredClone(state),
        loadContinuations: async () => structuredClone(state),
        saveSession: async (session, key) => {
          const prior = state.sessions.find((r) => r.session.session_id === session.session_id);
          if (prior) prior.session = structuredClone(session);
          else state.sessions.push({ session: structuredClone(session), idempotency_key: key });
        },
        saveRun: async (run) => {
          if (this.fail === 'run') throw new Error('run-insert-failed');
          state.runs.push(structuredClone(run));
        },
        saveToolCall: async (call) => {
          state.tool_calls.push(structuredClone(call));
        },
        saveCheckpoint: async (checkpoint) => {
          state.checkpoints.push(structuredClone(checkpoint));
        },
        saveHandoff: async (handoff, key) => {
          state.handoffs.push({ handoff: structuredClone(handoff), idempotency_key: key });
        },
      };
      const sessions = new SessionService(store),
        continuation = new ContinuationService(sessions, store);
      await sessions.hydrate();
      await continuation.hydrate();
      const commands = createSessionCommands(sessions, continuation);
      const result = await work({
        execute: (command) => commands.execute(command),
        find: async (key) => {
          const records = structuredClone(state.records.filter((r) => r.operation_key === key));
          const canonical = (value: any): any =>
            Array.isArray(value)
              ? value.map(canonical)
              : value && typeof value === 'object'
                ? Object.fromEntries(
                    Object.entries(value)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, item]) => [key, canonical(item)]),
                  )
                : value;
          return this.canonicalizeOnRead ? canonical(records) : records;
        },
        insert: async (record) => {
          if (this.fail === 'receipt') throw new Error('receipt-insert-failed');
          state.records.push(structuredClone(record));
        },
      });
      if (this.fail === 'commit') throw new Error('commit-failed');
      this.state = state;
      return structuredClone(result);
    });
    this.tail = pending.catch(() => undefined);
    return pending;
  }
}

test('original receipt survives new coordinator and later session changes', async () => {
  const tx = new Transactions(),
    service = new ContinuityOperations(tx, configuration);
  const start = request('start');
  const first = await service.execute(start, context);
  const session = first.result!.data as { session_id: string };
  await service.execute(
    request('run', 'session.run', { session_id: session.session_id, model: 'fixture' }, 1),
    context,
  );
  const restored = new ContinuityOperations(tx, configuration);
  assert.deepEqual(await restored.query(start, context), first);
  assert.deepEqual(await restored.execute(start, context), first);
  assert.equal(first.revision, 1);
  assert.equal(tx.state.sessions[0].session.version, 2);
  assert.equal(tx.state.sessions.length, 1);
  assert.equal(tx.state.runs.length, 1);
});

test('failed result insert or commit cannot leave an in-memory success or partial session', async () => {
  for (const fault of ['receipt', 'commit'] as const) {
    const tx = new Transactions(),
      service = new ContinuityOperations(tx, configuration),
      start = request(fault);
    tx.fail = fault;
    await assert.rejects(service.execute(start, context), /failed/);
    assert.equal(tx.state.sessions.length, 0);
    tx.fail = undefined;
    assert.equal(await service.query(start, context), null);
    await service.execute(start, context);
    assert.equal(tx.state.sessions.length, 1);
  }
});

test('run insertion failure rolls back session version and preserves retry precondition', async () => {
  const tx = new Transactions(),
    service = new ContinuityOperations(tx, configuration);
  const first = await service.execute(request('start'), context);
  const run = request(
    'run',
    'session.run',
    { session_id: (first.result!.data as any).session_id },
    1,
  );
  tx.fail = 'run';
  await assert.rejects(service.execute(run, context), /run-insert-failed/);
  assert.equal(tx.state.sessions[0].session.version, 1);
  assert.equal(tx.state.runs.length, 0);
  tx.fail = undefined;
  await service.execute(run, context);
  assert.equal(tx.state.sessions[0].session.version, 2);
  assert.equal(tx.state.runs.length, 1);
});

test('closed NoEffect attempt fences delayed execution while next attempt can run once', async () => {
  const tx = new Transactions(),
    service = new ContinuityOperations(tx, configuration),
    start = request('closed');
  assert.equal(await service.query(start, context), null);
  const closed = await service.close(start, context);
  assert.equal(closed.outcome, 'ConfirmedNoEffect');
  assert.deepEqual(await service.execute(start, context), closed);
  assert.equal(tx.state.sessions.length, 0);
  const next = { ...start, dispatch_attempt: 2 };
  const success = await service.execute(next, context);
  assert.equal(success.outcome, 'ConfirmedEffect');
  assert.deepEqual(await service.close(start, context), closed);
  assert.deepEqual(await service.query(next, context), success);
  await assert.rejects(service.execute({ ...next, dispatch_attempt: 3 }, context), /attempt/i);
  assert.equal(tx.state.sessions.length, 1);
});

test('same key cannot change payload, scope, actor, client, digest or endpoint', async () => {
  const tx = new Transactions(),
    service = new ContinuityOperations(tx, configuration),
    start = request('fixed');
  await service.execute(start, context);
  for (const changed of [
    { ...start, payload: { parent_session_id: 'different' } },
    { ...start, specification_digest: 'b'.repeat(64) },
    { ...start, endpoint_ref: 'elsewhere' },
  ])
    await assert.rejects(service.execute(changed, context));
  for (const changed of [
    { ...context, workspace_id: 'other' },
    { ...context, actor_id: 'other' },
    { ...context, client_id: 'other' },
  ])
    await assert.rejects(service.query(start, changed));
  assert.equal(tx.state.sessions.length, 1);
});

test('two coordinators share one original result; unsupported or unsafe commands have no effect', async () => {
  const tx = new Transactions(),
    one = new ContinuityOperations(tx, configuration),
    two = new ContinuityOperations(tx, configuration);
  const [left, right] = await Promise.all([
    one.execute(request('race'), context),
    two.execute(request('race'), context),
  ]);
  assert.deepEqual(left, right);
  assert.equal(tx.state.sessions.length, 1);
  for (const bad of [
    request('skip', 'session.start'),
    request('memory', 'handoff.create'),
    request('unsafe', 'session.run', { session_id: 'x' }, 9007199254740992),
    request('override', 'session.start', { actor_id: 'elsewhere' }),
  ]) {
    if (bad.operation_key === 'skip') bad.dispatch_attempt = 2;
    await assert.rejects(one.execute(bad, context));
  }
  assert.equal(tx.state.sessions.length, 1);
});

test('legacy session start key is scoped, and ending with a stale version cannot manufacture new proof', async () => {
  const sessions = new SessionService(),
    commands = createSessionCommands(sessions, new ContinuationService(sessions));
  const start = {
    operation: 'session.start',
    input: {},
    context: { ...context, idempotency_key: 'shared' },
  };
  const first = await commands.execute(start);
  const second = await commands.execute({
    ...start,
    context: { ...start.context, actor_id: 'actor-2' },
  });
  assert.notEqual((first.data as any).session_id, (second.data as any).session_id);
  const end = {
    operation: 'session.end',
    input: { session_id: (first.data as any).session_id, status: 'ended', expected_version: 1 },
    context,
  };
  await commands.execute(end);
  await assert.rejects(commands.execute(end), /version/i);
});

test('upgraded command reader finds historical raw session key within its original scope', async () => {
  const source = new SessionService();
  const original = source.startSession({
    ...context,
    tenant_id: context.tenant_id as never,
    workspace_id: context.workspace_id as never,
    project_id: context.project_id as never,
    idempotency_key: 'historical',
  });
  const store: SessionStore = {
    loadSessions: async () => ({
      sessions: [{ session: original, idempotency_key: 'historical' }],
      runs: [],
      tool_calls: [],
    }),
    saveSession: async () => {},
    saveRun: async () => {},
    saveToolCall: async () => {},
  };
  const restored = new SessionService(store);
  await restored.hydrate();
  const commands = createSessionCommands(restored, new ContinuationService(restored));
  const replay = await commands.execute({
    operation: 'session.start',
    input: {},
    context: { ...context, idempotency_key: 'historical' },
  });
  assert.equal((replay.data as any).session_id, original.session_id);
});

test('first response uses persisted original representation just like later queries', async () => {
  const tx = new Transactions();
  tx.canonicalizeOnRead = true;
  const service = new ContinuityOperations(tx, configuration),
    start = request('store-shape');
  const original = await service.execute(start, context);
  assert.equal(JSON.stringify(await service.query(start, context)), JSON.stringify(original));
});
