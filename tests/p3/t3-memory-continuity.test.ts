import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryContinuityOperations,
  type PreparedMemoryOperation,
} from '../../apps/api-gateway/src/memory-continuity.js';
import type { ContinuityRequest } from '../../apps/api-gateway/src/continuity-operations.js';
import type { OriginalMemoryCommand, OriginalMemoryReceipt } from '@planemem/context-service';
import type { RequestContext } from '../../apps/api-gateway/src/router.js';

const ws = '11111111-1111-4111-8111-111111111111',
  project = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const config = { endpoint_ref: 'real-memory', configuration_digest: 'c'.repeat(64) };
const context: RequestContext = {
  schema_version: 1,
  tenant_id: 'tenant',
  workspace_id: 'factory',
  project_id: 'product',
  actor_id: 'alice',
  client_id: 'worker-a',
  trace_id: 'trace-original',
  capability: ['context.write'],
};
function request(
  key = 'op-1',
  action = 'evidence.write',
  payload: Record<string, unknown> = {
    title: 'Decision',
    summary: 'Keep original evidence',
    evidence_ref: 'warehouse:prd',
    source_refs: [],
  },
): ContinuityRequest {
  return {
    ...config,
    protocol_version: 'p02-continuity-v1',
    operation_key: key,
    specification_digest: 'a'.repeat(64),
    dispatch_attempt: 1,
    action,
    payload,
  };
}
function fixture() {
  const records = new Map<string, PreparedMemoryOperation>();
  const receipts = new Map<string, OriginalMemoryReceipt>();
  const counts = { resolve: 0, execute: 0, query: 0, close: 0 };
  let failPreparation = false,
    loseReply = false;
  const store = {
    isReady: async () => true,
    get: async (key: string) => structuredClone(records.get(key) ?? null),
    putIfAbsent: async (record: PreparedMemoryOperation) => {
      if (failPreparation) throw new Error('Preparation did not commit');
      if (!records.has(record.operation_key))
        records.set(record.operation_key, structuredClone(record));
      return structuredClone(records.get(record.operation_key)!);
    },
  };
  function proof(command: OriginalMemoryCommand, noEffect = false): OriginalMemoryReceipt {
    const stamp = command.arguments.operation;
    return {
      protocol: 'ai-memory.operation.v1',
      receipt_id: id,
      recorded_at_us: 1793094825123456,
      outcome: noEffect ? 'no_effect' : 'succeeded',
      request: {
        attempt: stamp.attempt,
        binding: {
          ...stamp,
          actor: 'user:alice',
          client_id: 'worker-a',
          action: command.action,
          request_digest: 'b'.repeat(64),
        },
      },
      result: noEffect
        ? null
        : command.action === 'page.write'
          ? { page_id: id, path: 'actors/u-alice/proof.md', body_sha256: 'b'.repeat(64) }
          : command.action === 'handoff.create'
            ? { handoff_id: id }
            : { status: 'claimed', handoff: { id: command.arguments.handoff_id } },
    };
  }
  const port = {
    isReady: async () => true,
    readOriginalPage: async () => 'Original frozen page body',
    resolveScope: async () => {
      counts.resolve++;
      return { workspace: 'factory', project: 'product', workspace_id: ws, project_id: project };
    },
    execute: async (command: OriginalMemoryCommand) => {
      assert.equal(records.size > 0, true, 'Preparation must be committed before any MCP effect');
      counts.execute++;
      const key = `${command.arguments.operation.operation_key}/${command.arguments.operation.attempt}`;
      const original = receipts.get(key) ?? proof(command);
      receipts.set(key, original);
      if (loseReply) throw new Error('Actual response was lost');
      return structuredClone(original);
    },
    query: async (command: OriginalMemoryCommand) => {
      counts.query++;
      return structuredClone(
        receipts.get(
          `${command.arguments.operation.operation_key}/${command.arguments.operation.attempt}`,
        ) ?? null,
      );
    },
    close: async (command: OriginalMemoryCommand) => {
      counts.close++;
      const value = proof(command, true);
      receipts.set(
        `${command.arguments.operation.operation_key}/${command.arguments.operation.attempt}`,
        value,
      );
      return value;
    },
  };
  const service = (endpoint = 'http://memory.test') =>
    new MemoryContinuityOperations(store, config, endpoint, () => port);
  return {
    service,
    records,
    counts,
    setPreparationFailure: () => {
      failPreparation = true;
    },
    setReplyLoss: () => {
      loseReply = true;
    },
  };
}

test('memory intent is committed before sending; missing preparation is unknown and cannot dispatch', async () => {
  const f = fixture();
  assert.equal(await f.service().query(request(), context), null);
  assert.deepEqual(f.counts, { resolve: 0, execute: 0, query: 0, close: 0 });
  f.setPreparationFailure();
  await assert.rejects(() => f.service().execute(request(), context), /did not commit/);
  assert.equal(f.counts.execute, 0);
});

test('response loss recovers from the frozen command after a new gateway instance', async () => {
  const f = fixture();
  f.setReplyLoss();
  await assert.rejects(() => f.service().execute(request(), context), /response was lost/);
  const stored = structuredClone([...f.records.values()][0]);
  const proof = await f.service().query(request(), context);
  assert.equal(proof?.outcome, 'ConfirmedEffect');
  assert.equal(proof?.observed_at, '2026-10-27T09:53:45.123456Z');
  assert.deepEqual(await f.service().query(request(), context), proof);
  assert.deepEqual([...f.records.values()][0], stored);
  assert.equal(f.counts.resolve, 1);
  assert.equal(f.counts.execute, 1);
  assert.equal(f.counts.close, 0);
});

test('fixed operation cannot be reused with another payload, actor, client or endpoint', async () => {
  const f = fixture();
  const service = f.service();
  await service.execute(request(), context);
  for (const changed of [
    { ...context, actor_id: 'bob' },
    { ...context, client_id: 'worker-b' },
    { ...context, project_id: 'other' },
  ])
    await assert.rejects(() => service.query(request(), changed), /another immutable request/);
  await assert.rejects(
    () =>
      service.execute(
        { ...request(), payload: { ...request().payload, summary: 'Changed' } },
        context,
      ),
    /another immutable request/,
  );
  await assert.rejects(
    () => f.service('http://replacement.test').query(request(), context),
    /another immutable request/,
  );
  assert.equal(f.counts.execute, 1);
});

test('three memory actions retain typed references, original evidence and explicit NoEffect', async () => {
  const f = fixture(),
    service = f.service();
  const page = await service.execute(request(), context);
  const pageRef = (page.result!.data as any).page_ref;
  assert.equal((page.result!.data as any).hash, `sha256:${'b'.repeat(64)}`);
  const handoff = await service.execute(
    request('handoff', 'handoff.create', { page_ref: pageRef }),
    context,
  );
  const handoffRef = (handoff.result!.data as any).handoff_ref;
  assert.ok(
    String(f.records.get('handoff')!.command.arguments.summary).includes(
      'Original frozen page body',
    ),
  );
  const claimed = await service.execute(
    request('claim', 'handoff.claim', { handoff_ref: handoffRef }),
    context,
  );
  assert.equal((claimed.result!.data as any).page_ref, pageRef);
  assert.equal((claimed.result!.data as any).status, 'claimed');
  const noEffect = await service.close(request('close'), context);
  assert.equal(noEffect.outcome, 'ConfirmedNoEffect');
  assert.equal(noEffect.result, null);
  assert.equal(noEffect.revision, null);
  assert.deepEqual(noEffect.source_refs, []);
  assert.deepEqual(await service.query(request('close'), context), noEffect);
});
