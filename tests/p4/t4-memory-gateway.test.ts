import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryService } from '@planemem/context-service';
import { signWebhook } from '@planemem/plane-connector';
import { mockPlaneEvent } from '@planemem/test-fixtures';
import { createPlatformServer, type PlatformServer } from '../../apps/api-gateway/src/server.js';

function headers(capability: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-tenant-id': 'tenant-memory-gateway',
    'x-workspace-id': 'workspace-memory-gateway',
    'x-project-id': 'project-memory-gateway',
    'x-actor-id': 'actor-memory-gateway',
    'x-client-id': 'client-memory-gateway',
    'x-capability': capability,
    traceparent: 'trace-memory-gateway',
  };
}

test('T4 memory provider projects context index/search through the configured adapter', async () => {
  const app: PlatformServer = createPlatformServer({
    port: 0,
    memory_service: createMemoryService({ mode: 'in-memory' }),
  });
  const baseUrl = await app.start();
  try {
    const indexed = await fetch(`${baseUrl}/v1/context/index`, {
      method: 'POST',
      headers: { ...headers('context.write'), 'idempotency-key': 'memory-gateway-index-1' },
      body: JSON.stringify({
        id: 'memory-gateway-1',
        title: 'Factory lifecycle memory',
        snippet: 'quality evidence and role handoff',
        revision: 1,
        score: 1,
        source_refs: [{ type: 'factory-order', id: 'order-memory-gateway' }],
      }),
    });
    assert.equal(indexed.status, 200);
    const indexedBody = await indexed.json();
    assert.equal(
      indexedBody.data.source_refs.some((ref: { type: string }) => ref.type === 'ai-memory'),
      true,
    );

    const searched = await fetch(`${baseUrl}/v1/context/search`, {
      method: 'POST',
      headers: headers('context.read'),
      body: JSON.stringify({ query: 'quality evidence' }),
    });
    assert.equal(searched.status, 200);
    const body = await searched.json();
    assert.equal(body.trace_id, 'trace-memory-gateway');
    assert.equal(body.data.trace_id, 'trace-memory-gateway');
    assert.equal(
      body.data.hits.some((hit: { id: string }) => hit.id.startsWith('memory://')),
      true,
    );

    const health = await fetch(`${baseUrl}/health`);
    const healthBody = await health.json();
    assert.equal(healthBody.memory.service, 'memory-adapter');
    assert.equal(healthBody.memory.ready, true);
  } finally {
    await app.stop();
  }
});

test('T4 required memory mode fails closed when the configured provider is disabled', async () => {
  const app = createPlatformServer({
    port: 0,
    memory_service: createMemoryService({ mode: 'in-memory', enabled: false }),
    memory_required: true,
  });
  const baseUrl = await app.start();
  try {
    const response = await fetch(`${baseUrl}/v1/context/index`, {
      method: 'POST',
      headers: { ...headers('context.write'), 'idempotency-key': 'memory-gateway-required-1' },
      body: JSON.stringify({
        id: 'memory-gateway-required',
        title: 'Required memory',
        snippet: 'must be persisted',
        revision: 1,
        score: 1,
        source_refs: [{ type: 'factory-order', id: 'order-required' }],
      }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'MEMORY_PROVIDER_OFF');
    const ready = await fetch(`${baseUrl}/health/ready`);
    assert.equal(ready.status, 503);
    const readyBody = await ready.json();
    assert.equal(readyBody.ready, false);
    assert.equal(readyBody.status, 'not_ready');
  } finally {
    await app.stop();
  }
});

test('T4 memory gateway exposes scoped handoff create and claim routes', async () => {
  const app = createPlatformServer({
    port: 0,
    memory_service: createMemoryService({ mode: 'in-memory' }),
  });
  const baseUrl = await app.start();
  try {
    const indexed = await fetch(`${baseUrl}/v1/context/index`, {
      method: 'POST',
      headers: { ...headers('context.write'), 'idempotency-key': 'memory-gateway-handoff-index' },
      body: JSON.stringify({
        id: 'memory-gateway-handoff',
        title: 'Handoff memory',
        snippet: 'handoff content',
        revision: 1,
        score: 1,
        source_refs: [{ type: 'factory-order', id: 'order-handoff' }],
      }),
    });
    assert.equal(indexed.status, 200);
    const indexedBody = await indexed.json();
    const pageRef = indexedBody.data.source_refs.find(
      (ref: { type: string; id: string }) => ref.type === 'ai-memory',
    ).id;

    const created = await fetch(`${baseUrl}/v1/context/handoff`, {
      method: 'POST',
      headers: headers('context.write'),
      body: JSON.stringify({ page_ref: pageRef }),
    });
    assert.equal(created.status, 200);
    const createdBody = await created.json();
    assert.equal(createdBody.data.page_ref, pageRef);

    const claimed = await fetch(`${baseUrl}/v1/context/handoff/claim`, {
      method: 'POST',
      headers: headers('context.write'),
      body: JSON.stringify({
        handoff_ref: createdBody.data.handoff_ref,
        client_id: 'client-claim',
      }),
    });
    assert.equal(claimed.status, 200);
    assert.equal((await claimed.json()).data.status, 'claimed');
  } finally {
    await app.stop();
  }
});

test('T4 exposes scoped project state and work-item context projections', async () => {
  const app: PlatformServer = createPlatformServer({
    port: 0,
    plane_webhook_secret: 'project-state-secret',
    memory_service: createMemoryService({ mode: 'in-memory' }),
  });
  const baseUrl = await app.start();
  const projectEvent = mockPlaneEvent('gateway-state');
  const workItemEvent = {
    ...projectEvent,
    event_id: '01HF7YAT000000000000000009',
    event_type: 'WorkItemCreated' as const,
    aggregate_type: 'work_item',
    aggregate_id: '01HF7YAT000000000000000004',
    aggregate_version: 1,
    trace_id: 'trace-work-item-state',
    source_refs: [{ type: 'plane', id: 'work-item-gateway-state' }],
    payload: {
      id: '01HF7YAT000000000000000004',
      external_id: 'fixture-gateway-work-item',
      title: 'Factory work item state',
      status: 'observed',
    },
  };
  const projectionHeaders = (capability: string): Record<string, string> => ({
    ...headers(capability),
    'x-tenant-id': projectEvent.tenant_id,
    'x-workspace-id': projectEvent.workspace_id,
    'x-project-id': projectEvent.project_id ?? projectEvent.aggregate_id,
    'x-actor-id': projectEvent.actor_id ?? '01HF7YAT000000000000000007',
  });

  async function postEvent(event: typeof projectEvent): Promise<void> {
    const raw = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await signWebhook(raw, 'project-state-secret', timestamp);
    const response = await fetch(`${baseUrl}/v1/plane/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-plane-delivery-id': `delivery-${event.event_id}`,
        'x-plane-event-id': event.event_id,
        'x-plane-timestamp': timestamp,
        'x-plane-signature': signature,
        'x-trace-id': event.trace_id,
      },
      body: raw,
    });
    assert.equal(response.status, 200);
  }

  try {
    await postEvent(projectEvent);
    await postEvent(workItemEvent);

    const project = await fetch(
      `${baseUrl}/v1/projects/${encodeURIComponent('fixture-gateway-state-project')}/state`,
      { headers: projectionHeaders('context.read') },
    );
    assert.equal(project.status, 200);
    const projectBody = await project.json();
    assert.equal(projectBody.data.fields.title, 'Continuity project gateway-state');
    assert.equal(projectBody.data.tenant_id, projectEvent.tenant_id);

    const workItem = await fetch(
      `${baseUrl}/v1/work-items/${encodeURIComponent('fixture-gateway-work-item')}/context`,
      { headers: projectionHeaders('context.read') },
    );
    assert.equal(workItem.status, 200);
    const workItemBody = await workItem.json();
    assert.equal(workItemBody.data.work_item.fields.title, 'Factory work item state');
    assert.equal(
      workItemBody.data.context_pack.hits[0].id,
      'plane:WorkItem:fixture-gateway-work-item',
    );
    assert.equal(workItemBody.data.context_pack.trace_id, 'trace-memory-gateway');

    const crossTenantHeaders = {
      ...projectionHeaders('context.read'),
      'x-tenant-id': 'tenant-other',
    };
    const crossTenant = await fetch(
      `${baseUrl}/v1/projects/${encodeURIComponent('fixture-gateway-state-project')}/state`,
      { headers: crossTenantHeaders },
    );
    assert.equal(crossTenant.status, 404);
  } finally {
    await app.stop();
  }
});
