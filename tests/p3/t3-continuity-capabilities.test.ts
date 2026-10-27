import assert from 'node:assert/strict';
import test from 'node:test';
import {
  continuityCapabilityReport,
  type OperationTransactions,
} from '../../apps/api-gateway/src/continuity-operations.js';
import { operationPolicyAction, httpOperationTrace } from '../../apps/api-gateway/src/server.js';

test('explicit operation trace survives automatic W3C transport instrumentation', () => {
  const automatic = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
  assert.equal(
    httpOperationTrace({ 'x-trace-id': 'trace-frozen-intent', traceparent: automatic }),
    'trace-frozen-intent',
  );
  assert.equal(httpOperationTrace({ traceparent: automatic }), automatic);
  assert.equal(httpOperationTrace({}), 'trace_http_unknown');
});

const config = { endpoint_ref: 'p02-real', configuration_digest: 'c'.repeat(64) };
test('capability discovery is a read even when the advertised actions are writes', () => {
  assert.equal(operationPolicyAction('session.continuity.capabilities'), 'context.read');
  assert.equal(operationPolicyAction('session.continuity.execute'), 'session.write');
  assert.equal(operationPolicyAction('context.handoff.create'), 'context.write');
});
test('capabilities require actual receipt schema availability on each request', async () => {
  let available = false,
    checks = 0;
  const transactions: OperationTransactions = {
    run: async () => {
      throw new Error('not a mutation');
    },
    isReady: async () => {
      checks++;
      return available;
    },
  };
  assert.deepEqual((await continuityCapabilityReport(config, transactions)).actions, []);
  available = true;
  const enabled = await continuityCapabilityReport(config, transactions);
  assert.equal(enabled.durable_operation_proof, true);
  assert.equal(enabled.actions.length, 5);
  available = false;
  assert.equal(
    (await continuityCapabilityReport(config, transactions)).durable_operation_proof,
    false,
  );
  assert.equal(checks, 3);
  assert.equal((await continuityCapabilityReport(config)).durable_operation_proof, false);
});

test('memory capability requires its durable preparation store and actual MCP tools independently', async () => {
  const transactions: OperationTransactions = {
    run: async () => {
      throw new Error('read only');
    },
    isReady: async () => true,
  };
  let ready = false;
  const memory = { isReady: async () => ready };
  assert.equal((await continuityCapabilityReport(config, transactions, memory)).actions.length, 5);
  ready = true;
  const enabled = await continuityCapabilityReport(config, transactions, memory);
  assert.deepEqual(enabled.actions.slice(-3), [
    'evidence.write',
    'handoff.create',
    'handoff.claim',
  ]);
  ready = false;
  assert.equal((await continuityCapabilityReport(config, transactions, memory)).actions.length, 5);
});

test('memory continuity routes consume the context capability selected by their action', () => {
  for (const action of ['evidence.write', 'handoff.create', 'handoff.claim'])
    assert.equal(operationPolicyAction('session.continuity.execute', { action }), 'context.write');
  assert.equal(
    operationPolicyAction('session.continuity.execute', { action: 'session.start' }),
    'session.write',
  );
});
