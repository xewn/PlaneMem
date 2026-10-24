import assert from 'node:assert/strict';
import test from 'node:test';
import { createUlid } from '@planemem/contracts';
import {
  CANONICAL_EVENT_TYPES,
  EventTypeRegistry,
  EventConsumerLedger,
  validateEvent,
  type CanonicalEvent,
} from '@planemem/events';

const tenantId = createUlid(1_700_000_000_020);
const workspaceId = createUlid(1_700_000_000_021);
const projectId = createUlid(1_700_000_000_022);
const aggregateId = createUlid(1_700_000_000_023);

function event(version = 1): CanonicalEvent<{ title: string }> {
  return {
    event_id: createUlid(1_700_000_000_024 + version),
    event_type: 'CheckpointCreated',
    schema_version: 1,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    project_id: projectId,
    aggregate_type: 'checkpoint',
    aggregate_id: aggregateId,
    aggregate_version: version,
    actor_id: createUlid(1_700_000_000_030),
    client_id: 'codex',
    session_id: createUlid(1_700_000_000_031),
    correlation_id: createUlid(1_700_000_000_032),
    causation_id: createUlid(1_700_000_000_033),
    occurred_at: '2026-10-20T08:00:00.000Z',
    trace_id: 'trace_event_01',
    source_refs: [{ type: 'fixture', id: 'p0-event-01' }],
    sensitivity: 'internal',
    payload: { title: 'checkpoint' },
  };
}

test('T0.4 registers the canonical event type set and validates a versioned envelope', () => {
  const registry = new EventTypeRegistry();
  assert.deepEqual(registry.listTypes(), [...CANONICAL_EVENT_TYPES]);
  const result = validateEvent(event(), registry);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.event.event_type, 'CheckpointCreated');
    assert.equal(result.event.schema_version, 1);
  }
});

test('T0.4 rejects missing fields, unsupported versions, and non-object payloads', () => {
  const valid = event();
  const missing = { ...valid };
  delete (missing as Record<string, unknown>).trace_id;
  const missingResult = validateEvent(missing);
  assert.equal(missingResult.valid, false);
  if (!missingResult.valid) {
    assert.equal(missingResult.error.code, 'EVENT_SCHEMA_VALIDATION_FAILED');
    assert.equal(missingResult.error.trace_id, 'trace_unknown');
  }
  const unsupported = validateEvent({ ...valid, schema_version: 2 });
  assert.equal(unsupported.valid, false);
  if (!unsupported.valid) {
    assert.equal(unsupported.error.code, 'EVENT_SCHEMA_VERSION_UNSUPPORTED');
  }
  const invalidPayload = validateEvent({ ...valid, payload: 'raw transcript' });
  assert.equal(invalidPayload.valid, false);
});

test('T0.4 deduplicates event IDs and rejects aggregate version gaps without effects', () => {
  const ledger = new EventConsumerLedger();
  let effects = 0;
  const firstEvent = event(1);
  const first = ledger.consume(firstEvent, () => {
    effects += 1;
  });
  const duplicate = ledger.consume(firstEvent, () => {
    effects += 1;
  });
  const gap = ledger.consume(event(3), () => {
    effects += 1;
  });
  const next = ledger.consume(event(2), () => {
    effects += 1;
  });
  assert.equal(first.status, 'accepted');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(gap.status, 'out_of_order');
  assert.equal(next.status, 'accepted');
  assert.equal(effects, 2);
});
